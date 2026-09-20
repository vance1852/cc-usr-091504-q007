import { Harness, STAFF, baseAnonymousConsultation, baseNamedReport, buildApp, call } from './helpers';

describe('披露留痕、合并/拆分、事实核实与重复报告', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildApp();
  });
  afterEach(async () => {
    await h.app.close();
  });

  const createAndTakeOver = async (overrides: Record<string, unknown> = {}, reporter = STAFF.teacher1) => {
    const created = await call(h, reporter, 'post', '/concerns', baseNamedReport(overrides)).expect(201);
    await call(h, STAFF.dsl, 'post', `/concerns/${created.body.id}/takeover-ack`, {}).expect(201);
    return created.body.id;
  };

  it('每次披露都记录对象、理由与字段；接收方只见被披露字段', async () => {
    const id = await createAndTakeOver();

    const disclosed = await call(h, STAFF.dsl, 'post', `/concerns/${id}/disclosures`, {
      recipientId: STAFF.teacher2,
      reason: '需由该老师执行次日陪同，只需知道已采取的安全措施安排',
      fields: ['minimal_action'],
    }).expect(201);
    expect(disclosed.body.disclosures[0].recipientName).toContain('吴老师');
    expect(disclosed.body.disclosures[0].fields).toEqual(['minimal_action']);
    expect(disclosed.body.timeline.some((e: any) => e.type === 'disclosure')).toBe(true);

    const recipient = await call(h, STAFF.teacher2, 'get', `/concerns/${id}`).expect(200);
    expect(recipient.body.viewProfile).toBe('disclosure');
    expect(recipient.body.disclosedOnly).toBe(true);
    expect(recipient.body.minimalAction).toContain('陪同');
    expect(recipient.body.verbatim).toBeUndefined(); // 未披露原话
    expect(recipient.body.timeline).toBeUndefined(); // 调查时间线不开放

    // 无理由披露被拒
    await call(h, STAFF.dsl, 'post', `/concerns/${id}/disclosures`, {
      recipientId: STAFF.teacher3,
      reason: '',
    }).expect(400);
  });

  it('保护负责人合并重复报告，误合并后拆分且保留双向依据', async () => {
    // 同一学生的重复报告：两名老师分别提交
    const a = await createAndTakeOver({ classId: 'c-1' }, STAFF.teacher1);
    const b = await call(h, STAFF.teacher2, 'post', '/concerns', baseNamedReport({
      classId: 'c-2',
      verbatim: '她今天又说不想回那个家。',
      reporterContact: undefined,
    })).expect(201);
    const bId = b.body.id;

    // 普通老师不能合并
    await call(h, STAFF.teacher1, 'post', `/concerns/${a}/merges`, { sourceConcernId: bId, reason: 'x' }).expect(403);

    const merged = await call(h, STAFF.dsl, 'post', `/concerns/${a}/merges`, {
      sourceConcernId: bId,
      reason: '两条线索指向同一学生、同一时段表述，疑似重复报告',
    }).expect(201);
    // 两条原始事实进入同一连续时间线，且保留来源线索
    const initials = merged.body.timeline.filter((e: any) => e.type === 'initial_report');
    expect(initials).toHaveLength(2);
    expect(initials.map((e: any) => e.originConcernId).sort()).toEqual([a, bId].sort());

    // 通过被合并线索 id 访问会解析到存活关切（记录者仍可见）
    const reporterB = await call(h, STAFF.teacher2, 'get', `/concerns/${bId}`).expect(200);
    expect(reporterB.body.id).toBe(a);

    // 误合并：拆分
    const undone = await call(h, STAFF.dsl, 'post', `/concerns/${a}/unmerges`, {
      mergedConcernId: bId,
      reason: '经查两名学生并非同一人，班级与家庭情况均不同',
    }).expect(201);
    const trail = undone.body.mergeTrail[0];
    expect(trail.undoneAt).toBeGreaterThan(0);
    expect(trail.basis).toContain('原合并');
    expect(trail.basis).toContain('拆分');

    // 拆分后：源线索恢复独立访问与独立时间线
    const restoredB = await call(h, STAFF.dsl, 'get', `/concerns/${bId}`).expect(200);
    expect(restoredB.body.id).toBe(bId);
    expect(restoredB.body.timeline.filter((e: any) => e.type === 'initial_report')).toHaveLength(1);
    expect(restoredB.body.timeline[0].verbatim).toContain('不想回那个家');
    // 存活线索保留拆分事件与依据
    const survivingA = await call(h, STAFF.dsl, 'get', `/concerns/${a}`).expect(200);
    expect(survivingA.body.timeline.some((e: any) => e.type === 'unmerge')).toBe(true);
  });

  it('事实核实只能人工登记，未核实事实在责任视图中显式列出', async () => {
    const id = await createAndTakeOver();
    const detail = await call(h, STAFF.dsl, 'get', `/concerns/${id}`).expect(200);
    const fact = detail.body.factsVerification[0];
    expect(fact.state).toBe('unverified');

    const verified = await call(h, STAFF.dsl, 'post', `/concerns/${id}/verifications`, {
      timelineEventId: fact.timelineEventId,
      state: 'verified',
      note: '现场监控与另一名成人陈述一致',
    }).expect(201);
    expect(verified.body.factsVerification[0].state).toBe('verified');
    expect(verified.body.timeline.some((e: any) => e.type === 'verification')).toBe(true);

    // 系统流程性事件不能被当作事实核实
    const ackEvent = verified.body.timeline.find((e: any) => e.type === 'takeover_ack');
    await call(h, STAFF.dsl, 'post', `/concerns/${id}/verifications`, {
      timelineEventId: ackEvent.id,
      state: 'verified',
    }).expect(400);
    // 普通老师不能登记核实
    await call(h, STAFF.teacher3, 'post', `/concerns/${id}/verifications`, {
      timelineEventId: fact.timelineEventId,
      state: 'refuted',
    }).expect(403);
  });

  it('外部移交必须明确移交内容与责任，并可登记对方回执', async () => {
    const id = await createAndTakeOver();
    const ref = await call(h, STAFF.dsl, 'post', `/concerns/${id}/referrals`, {
      externalOrg: '区未成年人保护中心',
      externalRole: '社工督导',
      scopeSummary: '学生原话逐字记录、现场安全情况、学校已采取的陪同措施',
      responsibility: '对方负责家庭接触与需要性评估；学校负责在校安全观察，双方每周五书面互通一次',
    }).expect(201);
    const referral = ref.body.referrals[0];
    expect(referral.status).toBe('pending');
    expect(referral.scopeSummary).toContain('原话');

    await call(h, STAFF.dsl, 'post', `/concerns/referrals/${referral.id}/respond`, {
      decision: 'accepted',
    }).expect(201);
    const after = await call(h, STAFF.dsl, 'get', `/concerns/${id}`).expect(200);
    expect(after.body.referrals[0].status).toBe('accepted');

    // 未接管前不得移交
    const other = await call(h, STAFF.teacher1, 'post', '/concerns', baseNamedReport()).expect(201);
    await call(h, STAFF.dsl, 'post', `/concerns/${other.body.id}/referrals`, {
      externalOrg: 'x', externalRole: 'y', scopeSummary: 's', responsibility: 'r',
    }).expect(400);
  });

  it('匿名咨询与实名报告保持不同访问范围：同一保护负责人也只见匿名咨询的有限内容', async () => {
    const anon = await call(h, STAFF.teacher1, 'post', '/concerns', baseAnonymousConsultation()).expect(201);
    const named = await call(h, STAFF.teacher2, 'post', '/concerns', baseNamedReport()).expect(201);

    // 保护负责人列表同时可见两类，但风险级别/时限来源不同
    const list = await call(h, STAFF.dsl, 'get', '/concerns').expect(200);
    const refs = list.body.map((c: any) => ({ kind: c.kind, due: c.takeoverDueAt, review: c.reviewDueAt }));
    expect(refs).toContainEqual(expect.objectContaining({ kind: 'anonymous_consultation', due: null }));
    expect(refs).toContainEqual(expect.objectContaining({ kind: 'named_report' }));

    // 匿名咨询没有学生 id 与接管动作
    const anonDetail = await call(h, STAFF.dsl, 'get', `/concerns/${anon.body.id}`).expect(200);
    expect(anonDetail.body.studentId).toBeNull();
    expect(anonDetail.body.assignments.every((a: any) => a.type === 'review')).toBe(true);

    // 普通老师都不可见彼此的实名报告与对方提交的匿名咨询
    await call(h, STAFF.teacher3, 'get', `/concerns/${named.body.id}`).expect(403);
    await call(h, STAFF.teacher2, 'get', `/concerns/${anon.body.id}`).expect(403);
  });
});
