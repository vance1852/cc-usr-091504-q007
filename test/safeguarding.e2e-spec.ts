import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ContactChannel } from '../src/concerns/contact-channel.entity';
import { Assignment, AssignmentStatus } from '../src/takeover/assignment.entity';
import { TakeoverService } from '../src/takeover/takeover.service';
import { SEED_USERS as U } from '../src/users/users.service';

/**
 * 端到端场景：课后导师听到学生说"不想回家"后的完整保护性交接，
 * 以及重复报告、跨班转交、撤回联系方式三个自动化场景。
 */
describe('保护性关切交接（e2e）', () => {
  let app: INestApplication;
  let takeover: TakeoverService;
  let assignments: Repository<Assignment>;
  let contacts: Repository<ContactChannel>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    takeover = moduleRef.get(TakeoverService);
    assignments = moduleRef.get(getRepositoryToken(Assignment));
    contacts = moduleRef.get(getRepositoryToken(ContactChannel));
  });

  afterEach(async () => {
    await app?.close();
  });

  const get = (path: string, user?: string) => {
    const r = request(app.getHttpServer()).get(path);
    return user ? r.set('x-user-id', user) : r;
  };
  const post = (path: string, user: string, body: object = {}) =>
    request(app.getHttpServer()).post(path).set('x-user-id', user).send(body);
  const del = (path: string, user: string) =>
    request(app.getHttpServer()).delete(path).set('x-user-id', user);

  function concernBody(overrides: Record<string, unknown> = {}) {
    return {
      reportMode: 'named_report',
      studentRef: 'S-001',
      classCode: 'A',
      verbatimWords: '我不想回家。',
      occurredAt: new Date().toISOString(),
      sceneSafety: '放学时学生在教室门口停留，现场无即时危险',
      immediateDanger: false,
      minimalActionsTaken: '陪伴学生，未让其单独离开',
      ...overrides,
    };
  }

  async function createConcern(
    user: string = U.mentorA,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await post('/concerns', user, concernBody(overrides)).expect(201);
    return res.body.id as string;
  }

  async function expireCurrentAssignment(concernId: string) {
    const current = await assignments.findOne({
      where: { concernId, status: AssignmentStatus.Pending },
      order: { createdAt: 'DESC' },
    });
    expect(current).toBeTruthy();
    await assignments.update(current!.id, {
      dueAt: new Date(Date.now() - 60_000),
    });
  }

  // ---------- 基本交接 ----------

  describe('基本交接与接管确认', () => {
    it('导师记录原话/时间/现场/最小措施后，系统按时限指派负责人接管', async () => {
      const res = await post('/concerns', U.mentorA, concernBody()).expect(201);
      expect(res.body.level).toBe('reporter');
      expect(res.body.verbatimWords).toBe('我不想回家。');
      expect(res.body.riskLevel).toBe('high'); // 含"不想回家"紧迫措辞

      const inbox = await get('/concerns/inbox', U.lead).expect(200);
      const item = inbox.body.find((i: any) => i.id === res.body.id);
      expect(item.currentAssignment.assigneeId).toBe(U.lead);
      expect(item.currentAssignment.status).toBe('pending');

      const ack = await post(`/concerns/${res.body.id}/acknowledge`, U.lead).expect(201);
      expect(ack.body.status).toBe('acknowledged');

      const view = await get(`/concerns/${res.body.id}/responsibility`, U.lead).expect(200);
      expect(view.body.currentAssignment.assigneeId).toBe(U.lead);
      expect(view.body.currentAssignment.status).toBe('acknowledged');
      expect(view.body.currentAssignment.dueAt).toBeTruthy();
    });

    it('非指派接管人不能确认收到；未认证请求被拒绝', async () => {
      const id = await createConcern();
      await post(`/concerns/${id}/acknowledge`, U.senior).expect(403);
      await get('/concerns/mine').expect(401);
    });
  });

  // ---------- 超时逐级升级 ----------

  describe('超时逐级升级', () => {
    it('未接管沿 负责人→高级负责人→专业人员 逐级升级，并登记披露', async () => {
      const id = await createConcern();

      await expireCurrentAssignment(id);
      await takeover.processOverdue();
      let view = (await get(`/concerns/${id}/responsibility`, U.lead)).body;
      expect(view.escalationTrail.map((a: any) => a.status)).toEqual(['expired', 'pending']);
      expect(view.currentAssignment.assigneeId).toBe(U.senior);
      expect(view.currentAssignment.level).toBe(2);

      await expireCurrentAssignment(id);
      await takeover.processOverdue();
      view = (await get(`/concerns/${id}/responsibility`, U.lead)).body;
      expect(view.currentAssignment.assigneeId).toBe(U.externalB);
      expect(view.currentAssignment.level).toBe(3);

      // 升级链耗尽后不再产生新指派
      await expireCurrentAssignment(id);
      await takeover.processOverdue();
      view = (await get(`/concerns/${id}/responsibility`, U.lead)).body;
      expect(view.escalationTrail).toHaveLength(3);
      expect(view.escalationTrail.every((a: any) => a.status === 'expired')).toBe(true);

      // 每次升级都登记了披露对象与理由
      const escalationDisclosures = view.disclosures.filter((d: any) =>
        d.reason.includes('超时'),
      );
      expect(escalationDisclosures).toHaveLength(2);
      expect(escalationDisclosures[0].to).toBe('校长');
    });
  });

  // ---------- 匿名咨询 vs 实名报告 ----------

  describe('匿名咨询与实名报告的访问范围', () => {
    it('匿名咨询屏蔽记录者身份，联系方式不外泄，范围收窄', async () => {
      const id = await createConcern(U.mentorA, {
        reportMode: 'anonymous_consultation',
        contactInfo: '13800001234',
      });

      const leadView = (await get(`/concerns/${id}`, U.lead).expect(200)).body;
      expect(leadView.reporter.masked).toBe(true);
      expect(leadView.contact).toEqual({ provided: true, withdrawn: false });
      expect(JSON.stringify(leadView)).not.toContain('13800001234');

      // 收窄：高级负责人与其他导师都看不到
      await get(`/concerns/${id}`, U.senior).expect(404);
      await get(`/concerns/${id}`, U.mentorB).expect(404);
    });

    it('实名报告对保护链路显示记录者身份', async () => {
      const id = await createConcern();
      const view = (await get(`/concerns/${id}`, U.lead).expect(200)).body;
      expect(view.reporter.masked).toBe(false);
      expect(view.reporter.id).toBe(U.mentorA);
    });
  });

  // ---------- 记录者访问限制 ----------

  describe('记录者访问限制', () => {
    it('普通活动老师不接触调查细节，只看自己提交与待办动作', async () => {
      const id = await createConcern();
      await post(`/concerns/${id}/acknowledge`, U.lead).expect(201);
      await post(`/concerns/${id}/notes`, U.lead, {
        body: '已联系班主任核实家庭情况（调查细节）',
      }).expect(201);

      const mine = (await get('/concerns/mine', U.mentorA).expect(200)).body;
      expect(mine.concerns).toHaveLength(1);
      expect(JSON.stringify(mine)).not.toContain('调查细节');

      await get(`/concerns/${id}/responsibility`, U.mentorA).expect(403);
      await post(`/concerns/${id}/notes`, U.mentorA, { body: 'x' }).expect(403);
      await get(`/concerns/${id}`, U.mentorB).expect(404);
    });
  });

  // ---------- 连续时间线与事实核实 ----------

  describe('连续时间线与事实核实', () => {
    it('补充信息进入时间线；未核实事实列入责任视图，核实后移除', async () => {
      const id = await createConcern();
      const entry = await post(`/concerns/${id}/entries`, U.mentorA, {
        body: '学生补充说上周也有类似情绪',
      }).expect(201);
      expect(entry.body.verificationStatus).toBe('unverified');

      let view = (await get(`/concerns/${id}/responsibility`, U.lead)).body;
      expect(view.unverifiedFacts).toHaveLength(1);
      expect(view.unverifiedFacts[0].excerpt).toContain('上周');

      await post(`/concerns/entries/${entry.body.id}/verify`, U.lead, {
        status: 'verified',
      }).expect(201);
      view = (await get(`/concerns/${id}/responsibility`, U.lead)).body;
      expect(view.unverifiedFacts).toHaveLength(0);
    });

    it('记录者不能核实事实，也不能给无关关切补充', async () => {
      const id = await createConcern();
      const entry = (
        await post(`/concerns/${id}/entries`, U.mentorA, { body: '补充' }).expect(201)
      ).body;
      await post(`/concerns/entries/${entry.id}/verify`, U.mentorA, {
        status: 'verified',
      }).expect(403);
      await post(`/concerns/${id}/entries`, U.mentorB, { body: '无关补充' }).expect(403);
    });
  });

  // ---------- 自动化：重复报告 ----------

  describe('自动化：重复报告', () => {
    it('同一学生相近时间的报告被标记疑似重复并交叉链接，但仍各自待命', async () => {
      const first = await createConcern(U.mentorA, { studentRef: 'S-DUP' });
      const second = await createConcern(U.mentorB, { studentRef: 'S-DUP' });

      const secondView = (await get(`/concerns/${second}`, U.lead).expect(200)).body;
      expect(secondView.duplicateOfId).toBe(first);

      const firstView = (await get(`/concerns/${first}`, U.lead).expect(200)).body;
      expect(
        firstView.timeline.some(
          (e: any) => e.kind === 'system' && e.body.includes('疑似重复'),
        ),
      ).toBe(true);

      // 安全优先：合并前两条都保持待接管
      const inbox = (await get('/concerns/inbox', U.lead)).body;
      expect(inbox.find((i: any) => i.id === first)).toBeTruthy();
      expect(inbox.find((i: any) => i.id === second)).toBeTruthy();
    });
  });

  // ---------- 自动化：跨班转交 ----------

  describe('自动化：跨班转交', () => {
    it('转交必须明确内容与责任；跨班自动标记；接受后责任转移并登记披露', async () => {
      const id = await createConcern(U.mentorA, { classCode: 'A' });
      await post(`/concerns/${id}/acknowledge`, U.lead).expect(201);

      // 缺少移交内容 → 拒绝
      await post(`/concerns/${id}/transfer`, U.lead, {
        toUserId: U.externalB,
        responsibility: '初步跟进',
      }).expect(400);

      const transfer = (
        await post(`/concerns/${id}/transfer`, U.lead, {
          toUserId: U.externalB,
          contentScope: '学生原话记录与连续时间线',
          responsibility: '驻校社工在校内初步跟进，重大判断仍由保护负责人作出',
        }).expect(201)
      ).body;
      expect(transfer.crossClass).toBe(true); // B班社工接管A班关切

      const incoming = (await get('/transfers/incoming', U.externalB).expect(200)).body;
      expect(incoming).toHaveLength(1);

      await post(`/transfers/${transfer.id}/accept`, U.externalB).expect(201);

      // 专业人员只看到转交范围内的信息
      const extView = (await get(`/concerns/${id}`, U.externalB).expect(200)).body;
      expect(extView.level).toBe('assignee');
      expect(extView.transfer.contentScope).toContain('原话');
      expect(extView.verbatimWords).toBeUndefined();

      // 责任视图：接管人变为专业人员，披露已登记
      const view = (await get(`/concerns/${id}/responsibility`, U.lead)).body;
      expect(view.currentAssignment.assigneeId).toBe(U.externalB);
      const d = view.disclosures.find((x: any) => x.to === '驻校社工(B班)');
      expect(d.reason).toContain('跨班转交');
      expect(d.scope).toContain('原话');
    });

    it('接收人谢绝则责任不转移', async () => {
      const id = await createConcern();
      await post(`/concerns/${id}/acknowledge`, U.lead).expect(201);
      const transfer = (
        await post(`/concerns/${id}/transfer`, U.lead, {
          toUserId: U.externalB,
          contentScope: '摘要',
          responsibility: '跟进',
        }).expect(201)
      ).body;
      await post(`/transfers/${transfer.id}/decline`, U.externalB, {
        reason: '超出专业范围',
      }).expect(201);

      const view = (await get(`/concerns/${id}/responsibility`, U.lead)).body;
      expect(view.currentAssignment.assigneeId).toBe(U.lead);
    });
  });

  // ---------- 自动化：撤回联系方式 ----------

  describe('自动化：撤回联系方式', () => {
    it('记录者撤回后内容被擦除，仅保留撤回事实', async () => {
      const id = await createConcern(U.mentorA, {
        reportMode: 'anonymous_consultation',
        contactInfo: '13800001234',
      });

      const res = await del(`/concerns/${id}/contact`, U.mentorA).expect(200);
      expect(res.body.withdrawn).toBe(true);

      const view = (await get(`/concerns/${id}`, U.lead).expect(200)).body;
      expect(view.contact).toEqual({ provided: true, withdrawn: true });
      expect(view.timeline.some((e: any) => e.body.includes('撤回联系方式'))).toBe(true);
      expect(JSON.stringify(view)).not.toContain('13800001234');

      // 数据库层面内容已被擦除
      const stored = await contacts.findOneBy({ concernId: id });
      expect(stored!.contactInfo).toBe('');
      expect(stored!.withdrawnAt).toBeTruthy();

      await del(`/concerns/${id}/contact`, U.mentorA).expect(404);
    });

    it('他人不能撤回记录者的联系方式', async () => {
      const id = await createConcern(U.mentorA, {
        reportMode: 'anonymous_consultation',
        contactInfo: '13800001234',
      });
      await del(`/concerns/${id}/contact`, U.mentorB).expect(403);
      await del(`/concerns/${id}/contact`, U.lead).expect(403);
    });
  });

  // ---------- 合并与误合并拆分 ----------

  describe('合并与误合并拆分', () => {
    it('负责人可合并相关线索；拆分必须留依据且记录可审计', async () => {
      const c1 = await createConcern(U.mentorA, { studentRef: 'S-M1' });
      const c2 = await createConcern(U.mentorB, { studentRef: 'S-M2' });
      await post(`/concerns/${c2}/entries`, U.mentorB, { body: 'c2 的补充' }).expect(201);

      await post(`/concerns/${c2}/merge`, U.lead, {
        intoConcernId: c1,
        rationale: '两条报告指向同一事件',
      }).expect(201);

      // 主关切的连续时间线包含被合并关切的条目
      const c1View = (await get(`/concerns/${c1}`, U.lead).expect(200)).body;
      expect(c1View.timeline.some((e: any) => e.body === 'c2 的补充')).toBe(true);

      // 被合并关切的指派被取代
      const c2Assignments = await assignments.find({ where: { concernId: c2 } });
      expect(c2Assignments.every((a) => a.status === AssignmentStatus.Superseded)).toBe(true);

      // 误合并拆分：必须填写依据
      await post(`/concerns/${c2}/split`, U.lead, { rationale: '' }).expect(400);
      const split = (
        await post(`/concerns/${c2}/split`, U.lead, {
          rationale: '核实后确认是两起独立事件，原合并为误合并',
        }).expect(201)
      ).body;
      expect(split.status).toBe('split');

      // 拆分依据永久保留
      const history = (await get(`/concerns/${c2}/merges`, U.lead).expect(200)).body;
      expect(history[0].rationale).toContain('同一事件');
      expect(history[0].splitRationale).toContain('误合并');

      // 拆分后重新进入接管流程
      const c2Current = await assignments.findOne({
        where: { concernId: c2, status: AssignmentStatus.Pending },
      });
      expect(c2Current).toBeTruthy();
    });

    it('普通活动老师不能合并线索', async () => {
      const c1 = await createConcern(U.mentorA, { studentRef: 'S-X1' });
      const c2 = await createConcern(U.mentorA, { studentRef: 'S-X2' });
      await post(`/concerns/${c2}/merge`, U.mentorA, {
        intoConcernId: c1,
        rationale: '试图合并',
      }).expect(403);
      await get(`/concerns/${c1}/merges`, U.mentorA).expect(403);
    });
  });

  // ---------- 必须执行的动作 ----------

  describe('必须执行的动作', () => {
    it('负责人指派的动作出现在记录者待办中，完成后消失', async () => {
      const id = await createConcern();
      await post(`/concerns/${id}/action-requests`, U.lead, {
        toUserId: U.mentorA,
        body: '请补充事发前后学生的原话',
      }).expect(201);

      let mine = (await get('/concerns/mine', U.mentorA).expect(200)).body;
      expect(mine.openActions).toHaveLength(1);
      expect(mine.openActions[0].body).toContain('补充');

      await post(`/concerns/entries/${mine.openActions[0].id}/complete`, U.mentorA).expect(201);
      mine = (await get('/concerns/mine', U.mentorA).expect(200)).body;
      expect(mine.openActions).toHaveLength(0);
    });
  });

  // ---------- 结案 ----------

  describe('结案', () => {
    it('结案后从收件箱消失，责任视图保留结案状态', async () => {
      const id = await createConcern();
      await post(`/concerns/${id}/acknowledge`, U.lead).expect(201);
      await post(`/concerns/${id}/close`, U.lead, {
        reason: '已按流程完成跟进并记录',
      }).expect(201);

      const inbox = (await get('/concerns/inbox', U.lead).expect(200)).body;
      expect(inbox.find((i: any) => i.id === id)).toBeUndefined();

      const view = (await get(`/concerns/${id}/responsibility`, U.lead).expect(200)).body;
      expect(view.concern.status).toBe('closed');
    });
  });
});
