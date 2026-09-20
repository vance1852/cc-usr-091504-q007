import { ConcernsService } from '../src/concerns/concerns.service';
import { ClockService } from '../src/domain/clock.service';
import { Harness, STAFF, baseNamedReport, buildApp, call } from './helpers';

describe('接管确认与超时逐级升级', () => {
  let h: Harness;
  let clock: ClockService;

  beforeEach(async () => {
    h = await buildApp();
    clock = h.clock;
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('接管人确认已收到后状态变为 taken_over，记录接管人与确认时间', async () => {
    const created = await call(h, STAFF.teacher1, 'post', '/concerns', baseNamedReport()).expect(201);
    await call(h, STAFF.teacher3, 'post', `/concerns/${created.body.id}/takeover-ack`, {}).expect(403);

    const acked = await call(h, STAFF.dsl, 'post', `/concerns/${created.body.id}/takeover-ack`, {
      note: '已收到，已联系年级组',
    }).expect(201);
    expect(acked.body.status).toBe('taken_over');
    expect(acked.body.owner.id).toBe(STAFF.dsl);
    expect(acked.body.acknowledgedAt).toBeGreaterThan(acked.body.createdAt - 5);
    expect(acked.body.timeline.some((e: any) => e.type === 'takeover_ack')).toBe(true);

    // 不能重复接管
    await call(h, STAFF.dsl, 'post', `/concerns/${created.body.id}/takeover-ack`, {}).expect(400);
  });

  it('超时未接管 → 副保护负责人 → 校长逐级升级，每级授权与时限留痕', async () => {
    const created = await call(
      h,
      STAFF.teacher1,
      'post',
      '/concerns',
      baseNamedReport({ indicators: ['fear_of_person_at_home'] }), // urgent：4 小时
    ).expect(201);
    const id = created.body.id;
    expect(created.body.riskLevel).toBe('urgent');

    // 未超时：无升级
    clock.advance(3 * 60 * 60 * 1000);
    let svc = h.app.get(ConcernsService);
    expect(svc.tickEscalations()).toBe(0);

    // 超时：升级到副保护负责人
    clock.advance(2 * 60 * 60 * 1000); // 共 5h > 4h
    expect(svc.tickEscalations()).toBe(1);
    let detail = await call(h, STAFF.deputy, 'get', `/concerns/${id}`).expect(200);
    expect(detail.body.escalationLevel).toBe(1);
    expect(detail.body.accessGrants.some((g: any) => g.via === 'escalation' && g.role === 'deputy_safeguarding_lead')).toBe(true);
    const escEvent = detail.body.timeline.find((e: any) => e.type === 'escalation');
    expect(escEvent.metadata.toRole).toBe('deputy_safeguarding_lead');
    // 原保护负责人的 take_over 动作已标记 escalated
    expect(detail.body.assignments.find((a: any) => a.assignee.id === STAFF.dsl).status).toBe('escalated');

    // 副保护负责人确认接管：升级链终止，自己的动作确认、旧动作取消
    const acked = await call(h, STAFF.deputy, 'post', `/concerns/${id}/takeover-ack`, {}).expect(201);
    expect(acked.body.status).toBe('taken_over');
    expect(acked.body.owner.id).toBe(STAFF.deputy);
    clock.advance(100 * 60 * 60 * 1000);
    expect(svc.tickEscalations()).toBe(0);

    // 记录者视图能看到关切仍在处置，但看不到升级对象
    const reporter = await call(h, STAFF.teacher1, 'get', `/concerns/${id}`).expect(200);
    expect(reporter.body.status).toBe('taken_over');
    expect(reporter.body.accessGrants).toBeUndefined();
  });

  it('两级均超时 → 升级至校长；校长仍不接管则留下终局告警并不再外发', async () => {
    const created = await call(h, STAFF.teacher1, 'post', '/concerns', baseNamedReport()).expect(201);
    const id = created.body.id;
    const svc = h.app.get(ConcernsService);

    clock.advance(25 * 60 * 60 * 1000); // 超 24h：→ 副保护负责人
    expect(svc.tickEscalations()).toBe(1);
    clock.advance(25 * 60 * 60 * 1000); // 再超：→ 校长
    expect(svc.tickEscalations()).toBe(1);
    const head = await call(h, STAFF.head, 'get', `/concerns/${id}`).expect(200);
    expect(head.body.escalationLevel).toBe(2);

    clock.advance(25 * 60 * 60 * 1000);
    expect(svc.tickEscalations()).toBe(0); // 终局：不再产生新升级
    const detail = await call(h, STAFF.head, 'get', `/concerns/${id}`).expect(200);
    const finals = detail.body.timeline.filter((e: any) => e.type === 'escalation' && e.metadata.final);
    expect(finals).toHaveLength(1);
    expect(detail.body.takeoverDueAt).toBeNull();
  });

  it('重复扫描不会重复升级（幂等）', async () => {
    const created = await call(h, STAFF.teacher1, 'post', '/concerns', baseNamedReport()).expect(201);
    const svc = h.app.get(ConcernsService);
    clock.advance(25 * 60 * 60 * 1000);
    expect(svc.tickEscalations()).toBe(1);
    expect(svc.tickEscalations()).toBe(0);
    const detail = await call(h, STAFF.dsl, 'get', `/concerns/${created.body.id}`).expect(200);
    expect(detail.body.timeline.filter((e: any) => e.type === 'escalation')).toHaveLength(1);
  });
});
