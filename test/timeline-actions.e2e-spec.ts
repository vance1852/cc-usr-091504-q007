import { Harness, STAFF, baseNamedReport, buildApp, call } from './helpers';

describe('连续时间线、跨班指派与撤回联系方式', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildApp();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('补充信息进入同一连续时间线并保留序号；无关老师不可见', async () => {
    const created = await call(h, STAFF.teacher1, 'post', '/concerns', baseNamedReport()).expect(201);
    const id = created.body.id;

    const supp = await call(h, STAFF.teacher1, 'post', `/concerns/${id}/supplements`, {
      body: '学生十分钟后又说“其实是家里最近气氛不好”，仍未说明具体原因。',
    }).expect(201);
    expect(supp.body.timeline).toHaveLength(2);
    expect(supp.body.timeline[1].type).toBe('supplement');
    expect(supp.body.timeline[1].seq).toBe(2);
    expect(supp.body.factsVerification.map((f: any) => f.state)).toEqual(['unverified', 'unverified']);

    // 保护负责人也可补充工作信息（进入同一条时间线）
    await call(h, STAFF.dsl, 'post', `/concerns/${id}/supplements`, {
      body: '已查阅，暂无新增外部信息。',
    }).expect(201);
    // 普通无关老师看不到
    await call(h, STAFF.teacher3, 'post', `/concerns/${id}/supplements`, { body: 'x' }).expect(403);
  });

  it('跨班转交：保护负责人把最小必要动作指派给其他班老师，该老师不接触调查细节', async () => {
    const created = await call(h, STAFF.teacher1, 'post', '/concerns', baseNamedReport()).expect(201);
    const id = created.body.id;

    const assigned = await call(h, STAFF.dsl, 'post', `/concerns/${id}/follow-ups`, {
      assigneeId: STAFF.teacher2, // c-2 班，跨班
      description: '明天活动结束后陪同该生到校门口等候指定接引人，不要询问家庭情况。',
      context: '只需执行陪同与交接，勿向学生或他人讨论原因。',
      dueInMinutes: 1200,
    }).expect(201);
    const assignment = assigned.body.assignments.find((a: any) => a.assignee.id === STAFF.teacher2);
    expect(assignment.status).toBe('pending');

    // 跨班老师的工作台出现该动作
    const list = await call(h, STAFF.teacher2, 'get', '/concerns').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].viewProfile).toBe('action');

    // 动作视图：只看到自己的动作与执行上下文，不见原话、不见调查细节
    const actionView = await call(h, STAFF.teacher2, 'get', `/concerns/${id}`).expect(200);
    expect(actionView.body.viewProfile).toBe('action');
    expect(actionView.body.myActions).toHaveLength(1);
    expect(actionView.body.myActions[0].context).toContain('陪同');
    expect(actionView.body.timeline).toHaveLength(1); // 仅见自己的指派事件
    const event = actionView.body.timeline[0];
    expect(event.verbatim).toBeNull();
    expect(event.metadata).toEqual({}); // 调查性元数据不下发
    expect(actionView.body.factsVerification).toBeUndefined();
    expect(actionView.body.reporter).toBeUndefined();

    // 被指派人确认收到并完成
    await call(h, STAFF.teacher2, 'post', `/concerns/actions/${assignment.id}/ack`, { done: false }).expect(201);
    await call(h, STAFF.teacher2, 'post', `/concerns/actions/${assignment.id}/ack`, { done: true }).expect(201);
    const dslView = await call(h, STAFF.dsl, 'get', `/concerns/${id}`).expect(200);
    const doneAction = dslView.body.assignments.find((a: any) => a.id === assignment.id);
    expect(doneAction.status).toBe('done');
    expect(doneAction.doneAt).toBeGreaterThan(0);

    // 不能代他人确认
    await call(h, STAFF.teacher3, 'post', `/concerns/actions/${assignment.id}/ack`, { done: true }).expect(403);
  });

  it('撤回联系方式：抹除本体、保留墓碑，移交时禁止再携带', async () => {
    const created = await call(h, STAFF.teacher1, 'post', '/concerns', baseNamedReport()).expect(201);
    const id = created.body.id;

    // 先由保护负责人接管（移交前置条件）
    await call(h, STAFF.dsl, 'post', `/concerns/${id}/takeover-ack`, {}).expect(201);

    // 带联系方式的移交可以进行（使用机构渠道信息）
    await call(h, STAFF.dsl, 'post', `/concerns/${id}/referrals`, {
      externalOrg: '区未成年人保护中心',
      externalRole: '驻校社工',
      scopeSummary: '学生原话、现场安全判断、已采取措施',
      responsibility: '由社工开展家庭情况评估；学校继续负责在校安全与每日接送核对',
    }).expect(201);

    // 记录者撤回联系方式
    const supp = await call(h, STAFF.teacher1, 'post', `/concerns/${id}/supplements`, {
      body: '希望不要再通过我的个人分机联系。',
      contactRetraction: true,
    }).expect(201);
    expect(supp.body.reporterContactRetracted).toBe(true);
    expect(supp.body.reporterContact).toBeNull();
    expect(supp.body.timeline.some((e: any) => e.type === 'contact_retraction')).toBe(true);

    // 撤回后再移交，若携带记录者个人联系方式 → 拒绝
    const second = await call(h, STAFF.dsl, 'post', `/concerns/${id}/referrals`, {
      externalOrg: '社区服务站',
      externalRole: '儿童主任',
      externalContact: '周老师分机 801',
      scopeSummary: '仅移交在校观察记录',
      responsibility: '社区侧走访；学校侧不分享记录者私人联系渠道',
    }).expect(400);
    expect(second.body.message).toContain('撤回');

    // 他人不能替记录者撤回
    const other = await call(h, STAFF.teacher2, 'post', `/concerns/${id}/supplements`, {
      body: '替周老师撤回',
      contactRetraction: true,
    });
    // teacher2 无任何访问权 → 403
    expect(other.status).toBe(403);
  });
});
