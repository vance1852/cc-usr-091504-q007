import { Harness, STAFF, baseNamedReport, buildApp, call } from './helpers';

describe('保护性关切：记录、风险规则与访问范围', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildApp();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('记录原话/时间/现场安全/最小措施，常规信号给出 24 小时接管时限且仅保护负责人可见', async () => {
    const res = await call(h, STAFF.teacher1, 'post', '/concerns', baseNamedReport()).expect(201);
    expect(res.body.verbatim).toBeUndefined(); // 列表不回原话
    const detail = await call(h, STAFF.dsl, 'get', `/concerns/${res.body.id}`).expect(200);
    expect(detail.body.riskLevel).toBe('standard');
    expect(detail.body.takeoverDueAt - detail.body.createdAt).toBe(24 * 60 * 60 * 1000);
    expect(detail.body.riskReasons[0]).toContain('24 小时');

    const t0 = detail.body.timeline[0];
    expect(t0.verbatim).toBe('我不想回家。');
    expect(t0.sceneSafety.safeLocation).toBe(true);
    expect(t0.minimalAction).toContain('陪同');
    // 系统不对事实下结论：初始核实状态必须是未核实
    expect(t0.verificationState).toBe('unverified');
  });

  it('即时危险信号 → 30 分钟紧急时限，副保护负责人同步可见；普通老师仍不可见', async () => {
    const res = await call(
      h,
      STAFF.teacher1,
      'post',
      '/concerns',
      baseNamedReport({ indicators: ['imminent_danger'], sceneSafety: { dangerNow: true, safeLocation: false, narrative: '学生称回家就会挨打，坚持要离开。' } }),
    ).expect(201);

    expect(res.body.riskLevel).toBe('emergency');
    expect(res.body.takeoverDueAt - res.body.createdAt).toBe(30 * 60 * 1000);

    await call(h, STAFF.deputy, 'get', `/concerns/${res.body.id}`).expect(200);
    await call(h, STAFF.teacher3, 'get', `/concerns/${res.body.id}`).expect(403);
  });

  it('记录者只能看到自己提交及必须执行的动作，看不到升级链/授权细节', async () => {
    const res = await call(h, STAFF.teacher1, 'post', '/concerns', baseNamedReport()).expect(201);
    const mine = await call(h, STAFF.teacher1, 'get', `/concerns/${res.body.id}`).expect(200);
    expect(mine.body.viewProfile).toBe('reporter');
    expect(mine.body.studentId).toBeUndefined();
    expect(mine.body.accessGrants).toBeUndefined();
    expect(mine.body.assignments).toBeUndefined();
    expect(mine.body.timeline).toHaveLength(1);
    expect(mine.body.factsVerification[0].state).toBe('unverified');
    // 列表中也只出现自己提交的
    const list = await call(h, STAFF.teacher1, 'get', '/concerns').expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('匿名咨询不得携带学生身份，仅保护负责人可见，不启动接管时钟', async () => {
    const bad = await call(
      h,
      STAFF.teacher1,
      'post',
      '/concerns',
      { kind: 'anonymous_consultation', studentId: 'stu-x', verbatim: 'x', indicators: [], sceneSafety: { dangerNow: false, safeLocation: true, narrative: 'n' }, minimalAction: 'm' },
    ).expect(400);
    expect(bad.body.message).toContain('匿名');

    const res = await call(h, STAFF.teacher1, 'post', '/concerns', {
      kind: 'anonymous_consultation',
      verbatim: '听说有同学不敢回家',
      indicators: ['other'],
      sceneSafety: { dangerNow: false, safeLocation: true, narrative: '纸条' },
      minimalAction: '无',
    }).expect(201);
    expect(res.body.takeoverDueAt).toBeNull();
    expect(res.body.reviewDueAt - res.body.createdAt).toBe(7 * 24 * 60 * 60 * 1000);
    await call(h, STAFF.deputy, 'get', `/concerns/${res.body.id}`).expect(403);
    await call(h, STAFF.teacher3, 'get', `/concerns/${res.body.id}`).expect(403);
    // 阅看确认
    await call(h, STAFF.dsl, 'post', `/concerns/${res.body.id}/review-ack`).expect(201);
    const detail = await call(h, STAFF.dsl, 'get', `/concerns/${res.body.id}`).expect(200);
    expect(detail.body.assignments[0].status).toBe('acknowledged');
  });
});
