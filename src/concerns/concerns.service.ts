import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Database } from '../db/database';
import { ClockService } from '../domain/clock.service';
import { evaluateRisk } from '../domain/risk-policy';
import {
  ActionStatus,
  ESCALATION_CHAIN,
  ESCALATION_WINDOW_MIN,
  RiskIndicator,
  TimelineType,
} from '../domain/enums';
import {
  AccessService,
  ConcernView,
  StaffUser,
} from '../access/access.service';
import {
  AssignFollowUpDto,
  CloseDto,
  CreateConcernDto,
  DisclosureDto,
  MergeDto,
  ReferralDto,
  RespondReferralDto,
  SupplementDto,
  TakeoverAckDto,
  UnmergeDto,
  VerifyFactDto,
} from './dto';

interface ConcernRow {
  id: string;
  ref: string;
  kind: string;
  status: string;
  risk_level: string;
  student_id: string | null;
  student_pseudonym: string | null;
  class_id: string | null;
  reporter_id: string;
  reporter_contact: string | null;
  contact_retracted: number;
  created_at: number;
  takeover_due_at: number | null;
  review_due_at: number | null;
  current_owner_id: string | null;
  takeover_ack_at: number | null;
  escalation_level: number;
  merged_into: string | null;
  risk_reasons: string;
  closure_summary: string | null;
}

interface TimelineRow {
  id: string;
  concern_id: string;
  origin_concern_id: string;
  seq: number;
  type: string;
  actor_id: string | null;
  created_at: number;
  verbatim: string | null;
  quote_occurred_at: number | null;
  indicators: string | null;
  scene_safety: string | null;
  minimal_action: string | null;
  body: string | null;
  verification_state: string;
  metadata: string;
}

const FACTUAL_TYPES = new Set<TimelineType>(['initial_report', 'supplement']);
const DISCLOSABLE_FIELDS = ['verbatim', 'indicators', 'scene_safety', 'minimal_action'];

@Injectable()
export class ConcernsService {
  constructor(
    private readonly database: Database,
    private readonly access: AccessService,
    private readonly clock: ClockService,
  ) {}

  // ────────────────────────── 初次记录 ──────────────────────────

  createConcern(staff: StaffUser, dto: CreateConcernDto) {
    if (dto.kind === 'anonymous_consultation' && dto.studentId) {
      throw new BadRequestException('匿名咨询不得携带可识别学生身份的信息');
    }

    const now = this.clock.now();
    const decision = evaluateRisk(dto.kind, dto.indicators ?? [], dto.sceneSafety);
    const id = randomUUID();
    const ref = this.generateRef(now);

    const takeoverDueAt = dto.kind === 'named_report' ? now + decision.dueInMinutes * 60000 : null;
    const reviewDueAt = dto.kind === 'anonymous_consultation' ? now + decision.dueInMinutes * 60000 : null;

    const tx = this.database.db.transaction(() => {
      this.database.db
        .prepare(
          `INSERT INTO concerns (
             id, ref, kind, status, risk_level, student_id, student_pseudonym, class_id,
             reporter_id, reporter_contact, created_at, takeover_due_at, review_due_at,
             escalation_level, risk_reasons
           ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
          id,
          ref,
          dto.kind,
          decision.level,
          dto.kind === 'named_report' ? dto.studentId ?? null : null,
          dto.studentPseudonym ?? null,
          dto.classId ?? null,
          staff.id,
          dto.reporterContact ?? null,
          now,
          takeoverDueAt,
          reviewDueAt,
          JSON.stringify(decision.reasons),
        );

      this.addEvent(id, id, 'initial_report', staff.id, now, {
        verbatim: dto.verbatim,
        quoteOccurredAt: dto.quoteOccurredAt ?? now,
        indicators: dto.indicators,
        sceneSafety: dto.sceneSafety,
        minimalAction: dto.minimalAction,
      });

      // 风险规则确定的可见角色（need-to-know），逐条留痕授权理由
      const grant = this.database.db.prepare(
        `INSERT INTO access_grants (id, concern_id, staff_id, role, via, reason, granted_by, created_at)
         VALUES (?, ?, NULL, ?, 'policy', ?, ?, ?)`,
      );
      for (const role of decision.visibleRoles) {
        grant.run(randomUUID(), id, role, `风险规则：${decision.reasons.join('；')}`, staff.id, now);
      }

      if (dto.kind === 'named_report') {
        // 首位接管责任人：保护负责人
        this.createAssignment(
          id,
          'take_over',
          this.staffIdByRole('safeguarding_lead')!,
          '确认接管该保护性关切',
          staff.id,
          now,
          takeoverDueAt!,
        );
      } else {
        // 匿名咨询：仅安排阅看，不启动接管时钟
        this.createAssignment(
          id,
          'review',
          this.staffIdByRole('safeguarding_lead')!,
          '阅看匿名咨询并判断是否需要进一步行动',
          staff.id,
          now,
          reviewDueAt!,
        );
      }
    });
    tx();

    return this.getOne(staff, id);
  }

  // ────────────────────────── 列表与责任视图 ──────────────────────────

  list(staff: StaffUser) {
    const visible = this.access.visibleConcerns(staff);
    return visible.map(({ id, view }) => ({ ...this.projectListItem(id, staff), viewProfile: view.profile }));
  }

  private projectListItem(concernId: string, staff: StaffUser) {
    const c = this.requireConcern(concernId);
    const owner = c.current_owner_id ? this.staffName(c.current_owner_id) : null;
    const now = this.clock.now();
    return {
      id: c.id,
      ref: c.ref,
      kind: c.kind,
      status: c.status,
      riskLevel: c.risk_level,
      createdAt: c.created_at,
      owner: owner ? { id: c.current_owner_id, ...owner } : null,
      takeoverDueAt: c.takeover_due_at,
      reviewDueAt: c.review_due_at,
      takeoverOverdue:
        c.kind === 'named_report' && c.status === 'open' && c.takeover_due_at !== null && c.takeover_due_at < now,
    };
  }

  getOne(staff: StaffUser, concernId: string) {
    const view = this.requireView(staff, concernId);
    const resolved = this.access.resolve(concernId)!;
    const c = this.requireConcern(resolved.id);
    const now = this.clock.now();

    const base = {
      ...this.projectListItem(c.id, staff),
      escalationLevel: c.escalation_level,
      riskReasons: JSON.parse(c.risk_reasons) as string[],
      acknowledgedAt: c.takeover_ack_at,
      reporterContactRetracted: c.contact_retracted === 1,
      viewProfile: view.profile,
    };

    if (view.profile === 'disclosure') {
      return { ...base, ...this.projectDisclosedFields(c, view) };
    }

    const events = this.orderedEvents(c.id);

    if (view.profile === 'reporter') {
      // 记录者只见自己提交的事实、其核实状态以及自己必须执行的动作；看不到升级对象等调查细节
      return {
        ...base,
        reporterContact: c.contact_retracted === 1 ? null : c.reporter_contact,
        timeline: events
          .filter((e) => e.actor_id === staff.id && ['initial_report', 'supplement', 'contact_retraction'].includes(e.type))
          .map((e) => this.projectEvent(e)),
        factsVerification: this.factsSummary(events, { ownOnly: true, staffId: staff.id }),
        myActions: this.assignmentsForStaff(c.id, staff.id),
      };
    }

    if (view.profile === 'action') {
      const myActions = this.assignmentsForStaff(c.id, staff.id);
      const myActionIds = new Set(myActions.map((a) => a.id));
      return {
        ...base,
        // 普通活动老师仅见与自己动作直接相关的时间线条目，不接触原话与调查细节
        timeline: events
          .filter((e) => e.type === 'follow_up_assigned' && myActionIds.has(JSON.parse(e.metadata).assignmentId))
          .map((e) => ({ ...this.projectEvent(e), metadata: {} })),
        myActions,
      };
    }

    // investigation：完整责任视图
    return {
      ...base,
      studentId: c.student_id,
      studentPseudonym: c.student_pseudonym,
      classId: c.class_id,
      reporter: { id: c.reporter_id, ...this.staffName(c.reporter_id) },
      reporterContact: c.contact_retracted === 1 ? null : c.reporter_contact,
      timeline: events.map((e) => this.projectEvent(e)),
      factsVerification: this.factsSummary(events, { ownOnly: false }),
      assignments: this.allAssignments(c.id),
      disclosures: this.database.db
        .prepare('SELECT * FROM disclosures WHERE concern_id = ? ORDER BY created_at')
        .all(c.id)
        .map((d: any) => ({
          id: d.id,
          recipientName: d.recipient_name,
          recipientRole: d.recipient_role,
          reason: d.reason,
          fields: JSON.parse(d.disclosed_fields),
          disclosedBy: this.staffName(d.disclosed_by),
          at: d.created_at,
        })),
      referrals: this.database.db
        .prepare('SELECT * FROM referrals WHERE concern_id = ? ORDER BY created_at')
        .all(c.id)
        .map((r: any) => ({
          id: r.id,
          externalOrg: r.external_org,
          externalRole: r.external_role,
          scopeSummary: r.scope_summary,
          responsibility: r.responsibility,
          status: r.status,
          at: r.created_at,
          acceptedAt: r.accepted_at,
        })),
      accessGrants: this.database.db
        .prepare('SELECT role, staff_id, via, reason, created_at FROM access_grants WHERE concern_id = ? ORDER BY created_at')
        .all(c.id),
      mergeTrail: this.mergeTrail(c.id),
      closureSummary: c.closure_summary,
    };
  }

  // ────────────────────────── 补充信息（连续时间线） ──────────────────────────

  supplement(staff: StaffUser, concernId: string, dto: SupplementDto) {
    const view = this.requireView(staff, concernId);
    const resolved = this.access.resolve(concernId)!;
    const c = this.requireConcern(resolved.id);
    if (c.status === 'closed') throw new BadRequestException('关切已关闭，不能再补充');
    if (view.profile !== 'reporter' && view.profile !== 'investigation') {
      throw new ForbiddenException('仅记录者本人或保护负责人可以补充信息');
    }

    const now = this.clock.now();
    const tx = this.database.db.transaction(() => {
      // 合并后补充仍进入同一条连续时间线，origin 保留其最初所属线索
      this.addEvent(c.id, this.originFor(concernId, c.id), 'supplement', staff.id, now, {
        body: dto.body,
      });
      if (dto.contactRetraction) {
        this.retractContact(c.id, staff, now);
      }
    });
    tx();
    return this.getOne(staff, concernId);
  }

  private retractContact(concernId: string, staff: StaffUser, now: number) {
    const c = this.requireConcern(concernId);
    if (c.reporter_id !== staff.id) {
      throw new ForbiddenException('仅记录者本人可以撤回自己的联系方式');
    }
    // 抹除联系方式本体，仅保留「已撤回」墓碑状态
    this.database.db
      .prepare('UPDATE concerns SET reporter_contact = NULL, contact_retracted = 1 WHERE id = ?')
      .run(concernId);
    this.addEvent(concernId, concernId, 'contact_retraction', staff.id, now, {
      body: '记录者撤回联系方式：联系方式已抹除；后续对外移交不得包含该联系方式，应通过机构渠道联系。',
    });
  }

  // ────────────────────────── 接管确认 ──────────────────────────

  acknowledgeTakeover(staff: StaffUser, concernId: string, dto: TakeoverAckDto) {
    const view = this.requireView(staff, concernId);
    if (view.profile !== 'investigation') {
      throw new ForbiddenException('仅被授权的保护人员可以确认接管');
    }
    const c = this.requireConcern(this.access.resolve(concernId)!.id);
    if (c.kind !== 'named_report') {
      throw new BadRequestException('匿名咨询为阅看制，不适用接管确认');
    }
    if (c.status !== 'open') {
      throw new BadRequestException('该关切已被接管或关闭');
    }

    const now = this.clock.now();
    const tx = this.database.db.transaction(() => {
      this.database.db
        .prepare(
          `UPDATE concerns SET status = 'taken_over', current_owner_id = ?, takeover_ack_at = ? WHERE id = ?`,
        )
        .run(staff.id, now, c.id);
      this.addEvent(c.id, c.id, 'takeover_ack', staff.id, now, {
        body: dto.note ? `确认已收到并接管。备注：${dto.note}` : '确认已收到并接管。',
      });
      // 接管人对应的待处理 take_over 动作一并确认；此前升级产生的待处理动作标记为已升级处置
      this.database.db
        .prepare(
          `UPDATE assignments SET status = 'acknowledged', ack_at = ?
           WHERE concern_id = ? AND type = 'take_over' AND status IN ('pending', 'escalated') AND assignee_id = ?`,
        )
        .run(now, c.id, staff.id);
      this.database.db
        .prepare(
          `UPDATE assignments SET status = 'cancelled'
           WHERE concern_id = ? AND type = 'take_over' AND status IN ('pending', 'escalated') AND assignee_id != ?`,
        )
        .run(c.id, staff.id);
    });
    tx();
    return this.getOne(staff, c.id);
  }

  acknowledgeReview(staff: StaffUser, concernId: string) {
    const view = this.requireView(staff, concernId);
    if (view.profile !== 'investigation') throw new ForbiddenException('无阅看权限');
    const c = this.requireConcern(this.access.resolve(concernId)!.id);
    if (c.kind !== 'anonymous_consultation') throw new BadRequestException('该接口仅用于匿名咨询阅看');
    const now = this.clock.now();
    const tx = this.database.db.transaction(() => {
      this.database.db
        .prepare(
          `UPDATE assignments SET status = 'acknowledged', ack_at = ?
           WHERE concern_id = ? AND type = 'review' AND status = 'pending' AND assignee_id = ?`,
        )
        .run(now, c.id, staff.id);
      this.addEvent(c.id, c.id, 'review_ack', staff.id, now, {
        body: '保护负责人已阅看该匿名咨询。',
      });
    });
    tx();
    return this.getOne(staff, c.id);
  }

  // ────────────────────────── 超时逐级升级 ──────────────────────────

  /**
   * 扫描超时未接管的实名报告：升级到链上的下一级，
   * 为其授权、建立新的接管动作与截止时间；旧动作标记为已升级。
   */
  tickEscalations(): number {
    const now = this.clock.now();
    const due = this.database.db
      .prepare(
        `SELECT * FROM concerns
         WHERE kind = 'named_report' AND status = 'open' AND takeover_due_at IS NOT NULL AND takeover_due_at < ?`,
      )
      .all(now) as ConcernRow[];

    let count = 0;
    for (const c of due) {
      const nextRole = ESCALATION_CHAIN[c.escalation_level + 1];
      if (!nextRole) {
        // 已到升级链顶端仍未接管：停止重排时钟，仅留下一次终局告警事件
        this.database.db.transaction(() => {
          this.addEvent(c.id, c.id, 'escalation', null, now, {
            body: '校长仍未接管：升级链已结束，系统持续标记为超时，需线下立即处置。',
            metadata: { final: true, level: c.escalation_level },
          });
          this.database.db.prepare('UPDATE concerns SET takeover_due_at = NULL WHERE id = ?').run(c.id);
        })();
        continue;
      }

      const nextAssignee = this.staffIdByRole(nextRole);
      if (!nextAssignee) continue;
      const windowMin = ESCALATION_WINDOW_MIN[c.risk_level as keyof typeof ESCALATION_WINDOW_MIN];
      const newDue = now + windowMin * 60000;

      this.database.db.transaction(() => {
        const exists = this.database.db
          .prepare(
            `SELECT 1 FROM access_grants WHERE concern_id = ? AND role = ? AND via = 'escalation' LIMIT 1`,
          )
          .get(c.id, nextRole);
        if (!exists) {
          this.database.db
            .prepare(
              `INSERT INTO access_grants (id, concern_id, staff_id, role, via, reason, granted_by, created_at)
               VALUES (?, ?, NULL, ?, 'escalation', ?, NULL, ?)`,
            )
            .run(
              randomUUID(),
              c.id,
              nextRole,
              `超时升级：前任责任人未在时限内确认接管（第 ${c.escalation_level + 2} 级）`,
              now,
            );
        }
        this.database.db
          .prepare(
            `UPDATE assignments SET status = 'escalated'
             WHERE concern_id = ? AND type = 'take_over' AND status = 'pending'`,
          )
          .run(c.id);
        this.createAssignment(c.id, 'take_over', nextAssignee, '确认接管该保护性关切（超时升级）', null, now, newDue);
        this.addEvent(c.id, c.id, 'escalation', null, now, {
          body: `超过接管时限未获确认，已逐级升级至 ${nextRole}。`,
          metadata: { toRole: nextRole, level: c.escalation_level + 1, newDueAt: newDue },
        });
        this.database.db
          .prepare('UPDATE concerns SET escalation_level = escalation_level + 1, takeover_due_at = ? WHERE id = ?')
          .run(newDue, c.id);
      })();
      count += 1;
    }
    return count;
  }

  // ────────────────────────── 指派最小必要动作（含跨班） ──────────────────────────

  assignFollowUp(staff: StaffUser, concernId: string, dto: AssignFollowUpDto) {
    const view = this.requireView(staff, concernId);
    if (view.profile !== 'investigation') throw new ForbiddenException('仅保护人员可以指派动作');
    const c = this.requireConcern(this.access.resolve(concernId)!.id);
    const assignee = this.requireStaff(dto.assigneeId);
    const now = this.clock.now();
    const dueAt = dto.dueInMinutes ? now + dto.dueInMinutes * 60000 : null;

    let assignmentId: string;
    const tx = this.database.db.transaction(() => {
      assignmentId = this.createAssignment(
        c.id,
        'follow_up',
        assignee.id,
        dto.description,
        staff.id,
        now,
        dueAt,
        dto.context ?? null,
      );
      this.addEvent(c.id, c.id, 'follow_up_assigned', staff.id, now, {
        body: `向 ${assignee.name} 指派最小必要动作：${dto.description}`,
        metadata: { assignmentId, assigneeId: assignee.id, crossClass: assignee.classId !== c.class_id },
      });
    });
    tx();
    return this.getOne(staff, c.id);
  }

  acknowledgeAction(staff: StaffUser, actionId: string, done: boolean) {
    const row = this.database.db.prepare('SELECT * FROM assignments WHERE id = ?').get(actionId) as
      | any
      | undefined;
    if (!row) throw new NotFoundException('动作不存在');
    if (row.assignee_id !== staff.id) throw new ForbiddenException('只能处理指派给自己的动作');
    if (!['pending', 'acknowledged', 'escalated'].includes(row.status)) {
      throw new BadRequestException('该动作已结束');
    }
    const now = this.clock.now();
    const status: ActionStatus = done ? 'done' : 'acknowledged';
    this.database.db
      .prepare(
        `UPDATE assignments SET status = ?, ack_at = COALESCE(ack_at, ?), done_at = ? WHERE id = ?`,
      )
      .run(status, now, done ? now : null, actionId);
    return this.getOne(staff, row.concern_id);
  }

  // ────────────────────────── 向外部专业人员移交 ──────────────────────────

  refer(staff: StaffUser, concernId: string, dto: ReferralDto) {
    const view = this.requireView(staff, concernId);
    if (view.profile !== 'investigation') throw new ForbiddenException('仅保护人员可以发起移交');
    const c = this.requireConcern(this.access.resolve(concernId)!.id);
    if (!c.current_owner_id) throw new BadRequestException('须在接管确认后才能向外部专业人员移交');
    if (c.contact_retracted === 1 && dto.externalContact) {
      throw new BadRequestException('记录者已撤回联系方式：移交不得包含其个人联系方式，请改用机构渠道');
    }

    const now = this.clock.now();
    const referralId = randomUUID();
    const tx = this.database.db.transaction(() => {
      this.database.db
        .prepare(
          `INSERT INTO referrals (
             id, concern_id, external_org, external_role, external_contact,
             scope_summary, responsibility, status, referred_by, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          referralId,
          c.id,
          dto.externalOrg,
          dto.externalRole,
          dto.externalContact ?? null,
          dto.scopeSummary,
          dto.responsibility,
          staff.id,
          now,
        );
      this.addEvent(c.id, c.id, 'referral', staff.id, now, {
        body: `移交至 ${dto.externalOrg}（${dto.externalRole}）。移交内容：${dto.scopeSummary}；责任划分：${dto.responsibility}`,
        metadata: { referralId },
      });
      this.database.db.prepare(`UPDATE concerns SET status = 'referred_out' WHERE id = ?`).run(c.id);
    });
    tx();
    return this.getOne(staff, c.id);
  }

  respondReferral(staff: StaffUser, referralId: string, dto: RespondReferralDto) {
    const row = this.database.db.prepare('SELECT * FROM referrals WHERE id = ?').get(referralId) as any;
    if (!row) throw new NotFoundException('移交记录不存在');
    const view = this.requireView(staff, row.concern_id);
    if (view.profile !== 'investigation') throw new ForbiddenException('无权限');
    const now = this.clock.now();
    this.database.db
      .prepare('UPDATE referrals SET status = ?, accepted_at = ? WHERE id = ?')
      .run(dto.decision, now, referralId);
    this.addEvent(row.concern_id, row.concern_id, 'referral', staff.id, now, {
      body:
        dto.decision === 'accepted'
          ? '外部专业人员已接受移交，按既定责任划分执行。'
          : '外部专业人员未接受移交，保护负责人需重新安排处置。',
      metadata: { referralId, decision: dto.decision },
    });
    return this.getOne(staff, row.concern_id);
  }

  // ────────────────────────── 单次披露（对象 + 理由 + 字段留痕） ──────────────────────────

  disclose(staff: StaffUser, concernId: string, dto: DisclosureDto) {
    const view = this.requireView(staff, concernId);
    if (view.profile !== 'investigation') throw new ForbiddenException('仅保护人员可以披露');
    const c = this.requireConcern(this.access.resolve(concernId)!.id);
    const recipient = this.requireStaff(dto.recipientId);
    if (recipient.id === staff.id) throw new BadRequestException('无需向自己披露');

    const fields = (dto.fields ?? ['verbatim', 'minimal_action']).filter((f) =>
      DISCLOSABLE_FIELDS.includes(f),
    );
    if (fields.length === 0) throw new BadRequestException('披露字段为空或不被允许');

    const now = this.clock.now();
    const disclosureId = randomUUID();
    const tx = this.database.db.transaction(() => {
      this.database.db
        .prepare(
          `INSERT INTO disclosures (id, concern_id, recipient_id, recipient_name, recipient_role, reason, disclosed_fields, disclosed_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          disclosureId,
          c.id,
          recipient.id,
          recipient.name,
          recipient.role,
          dto.reason,
          JSON.stringify(fields),
          staff.id,
          now,
        );
      this.addEvent(c.id, c.id, 'disclosure', staff.id, now, {
        body: `向 ${recipient.name}（${recipient.role}）披露：${dto.reason}`,
        metadata: { disclosureId, recipientId: recipient.id, fields },
      });
    });
    tx();
    return this.getOne(staff, c.id);
  }

  // ────────────────────────── 合并相关线索 / 误合并拆分 ──────────────────────────

  merge(staff: StaffUser, survivingConcernId: string, dto: MergeDto) {
    if (staff.role !== 'safeguarding_lead') {
      throw new ForbiddenException('仅保护负责人可以合并相关线索');
    }
    const target = this.requireConcern(this.access.resolve(survivingConcernId)!.id);
    const source = this.requireConcern(this.access.resolve(dto.sourceConcernId)!.id);
    if (target.id === source.id) throw new BadRequestException('不能与自身合并');

    const now = this.clock.now();
    const mergeId = randomUUID();
    const tx = this.database.db.transaction(() => {
      this.database.db
        .prepare('UPDATE concerns SET merged_into = ? WHERE id = ?')
        .run(target.id, source.id);
      this.database.db
        .prepare(
          `INSERT INTO merges (id, surviving_concern_id, merged_concern_id, reason, merged_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(mergeId, target.id, source.id, dto.reason, staff.id, now);

      // 授权并集：源线索的 policy/escalation 授权补到存活线索，保证接管不丢权限
      this.database.db
        .prepare(
          `INSERT OR IGNORE INTO access_grants (id, concern_id, staff_id, role, via, reason, granted_by, created_at)
           SELECT ?, ?, staff_id, role, via, reason, granted_by, ? FROM access_grants
           WHERE concern_id = ? AND via IN ('policy', 'escalation')`,
        )
        .run(randomUUID(), target.id, now, source.id);

      // 源线索上未完成的动作转挂到存活线索
      this.database.db
        .prepare(`UPDATE assignments SET concern_id = ? WHERE concern_id = ? AND status != 'cancelled'`)
        .run(target.id, source.id);

      // 连续时间线：源线索事实进入存活关切，但 origin_concern_id 保留事实来源，供拆分溯源
      this.database.db
        .prepare(`UPDATE timeline SET concern_id = ? WHERE concern_id = ?`)
        .run(target.id, source.id);

      this.addEvent(target.id, target.id, 'merge', staff.id, now, {
        body: `将线索 ${source.ref} 合并入本关切。合并理由：${dto.reason}`,
        metadata: { mergeId, sourceConcernId: source.id },
      });
    });
    tx();
    return this.getOne(staff, target.id);
  }

  unmerge(staff: StaffUser, survivingConcernId: string, dto: UnmergeDto) {
    if (staff.role !== 'safeguarding_lead') {
      throw new ForbiddenException('仅保护负责人可以拆分');
    }
    const target = this.requireConcern(this.access.resolve(survivingConcernId)!.id);
    const merge = this.database.db
      .prepare(
        `SELECT * FROM merges WHERE surviving_concern_id = ? AND merged_concern_id = ? AND undone_at IS NULL`,
      )
      .get(target.id, dto.mergedConcernId) as any;
    if (!merge) throw new NotFoundException('未找到对应的有效合并记录');

    const source = this.requireConcern(dto.mergedConcernId);
    const now = this.clock.now();
    const tx = this.database.db.transaction(() => {
      // 拆分依据永久保留：原合并理由 + 拆分理由与操作人
      this.database.db
        .prepare('UPDATE concerns SET merged_into = NULL WHERE id = ?')
        .run(source.id);
      this.database.db
        .prepare('UPDATE merges SET undone_at = ?, undo_reason = ?, undone_by = ? WHERE id = ?')
        .run(now, dto.reason, staff.id, merge.id);

      // 来源事实回到原线索时间线；合并期间产生的共享事实（核实/披露等）留在存活关切
      this.database.db
        .prepare(`UPDATE timeline SET concern_id = ? WHERE concern_id = ? AND origin_concern_id = ?`)
        .run(source.id, target.id, source.id);
      // 合并前已存在、随合并转挂的未完成动作归还原线索
      this.database.db
        .prepare(
          `UPDATE assignments SET concern_id = ? WHERE concern_id = ? AND created_at <= ? AND status != 'cancelled'`,
        )
        .run(source.id, target.id, merge.created_at);
      this.addEvent(target.id, target.id, 'unmerge', staff.id, now, {
        body: `误合并拆分：将 ${source.ref} 从本关切拆出。拆分理由：${dto.reason}（原合并理由：${merge.reason}）`,
        metadata: { mergeId: merge.id, mergedConcernId: source.id, originalMergeReason: merge.reason },
      });
    });
    tx();
    return this.getOne(staff, target.id);
  }

  // ────────────────────────── 事实核实（人工，禁止系统自动定性） ──────────────────────────

  verifyFact(staff: StaffUser, concernId: string, dto: VerifyFactDto) {
    const view = this.requireView(staff, concernId);
    if (view.profile !== 'investigation') throw new ForbiddenException('仅保护人员可以登记核实结果');
    const c = this.requireConcern(this.access.resolve(concernId)!.id);
    const event = this.database.db
      .prepare('SELECT * FROM timeline WHERE id = ? AND concern_id = ?')
      .get(dto.timelineEventId, c.id) as TimelineRow | undefined;
    if (!event) throw new NotFoundException('时间线事实不存在');
    if (!FACTUAL_TYPES.has(event.type as TimelineType)) {
      throw new BadRequestException('只能对原始陈述/补充信息登记核实结果');
    }
    const now = this.clock.now();
    const tx = this.database.db.transaction(() => {
      this.database.db
        .prepare('UPDATE timeline SET verification_state = ? WHERE id = ?')
        .run(dto.state, event.id);
      this.addEvent(c.id, c.id, 'verification', staff.id, now, {
        body: `事实核实：时间线 #${event.seq} 标记为「${dto.state === 'verified' ? '已核实' : '经查不成立'}」${
          dto.note ? `。说明：${dto.note}` : ''
        }`,
        metadata: { timelineEventId: event.id, state: dto.state },
      });
    });
    tx();
    return this.getOne(staff, c.id);
  }

  close(staff: StaffUser, concernId: string, dto: CloseDto) {
    const view = this.requireView(staff, concernId);
    if (view.profile !== 'investigation') throw new ForbiddenException('仅保护人员可以关闭');
    const c = this.requireConcern(this.access.resolve(concernId)!.id);
    const now = this.clock.now();
    const tx = this.database.db.transaction(() => {
      this.database.db
        .prepare(`UPDATE concerns SET status = 'closed', closure_summary = ? WHERE id = ?`)
        .run(dto.summary, c.id);
      this.database.db
        .prepare(`UPDATE assignments SET status = 'cancelled' WHERE concern_id = ? AND status IN ('pending','acknowledged','escalated')`)
        .run(c.id);
      this.addEvent(c.id, c.id, 'closure', staff.id, now, { body: `关切关闭：${dto.summary}` });
    });
    tx();
    return this.getOne(staff, c.id);
  }

  // ────────────────────────── 辅助方法 ──────────────────────────

  private requireView(staff: StaffUser, concernId: string): ConcernView {
    const view = this.access.viewFor(staff, concernId);
    if (!view) throw new ForbiddenException('该关切不在你的访问范围内（need-to-know）');
    return view;
  }

  private requireConcern(id: string): ConcernRow {
    const row = this.database.db.prepare('SELECT * FROM concerns WHERE id = ?').get(id) as
      | ConcernRow
      | undefined;
    if (!row) throw new NotFoundException('关切不存在');
    return row;
  }

  private requireStaff(id: string): StaffUser & { classId: string | null } {
    const row = this.database.db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as any;
    if (!row) throw new BadRequestException(`教职员不存在：${id}`);
    return { id: row.id, name: row.name, role: row.role, classId: row.class_id };
  }

  private staffIdByRole(role: string): string | null {
    const row = this.database.db.prepare('SELECT id FROM staff WHERE role = ? LIMIT 1').get(role) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  }

  private staffName(id: string): { name: string; role: string } {
    const row = this.database.db.prepare('SELECT name, role FROM staff WHERE id = ?').get(id) as
      | { name: string; role: string }
      | undefined;
    return row ?? { name: '（未知）', role: 'unknown' };
  }

  private generateRef(now: number): string {
    const d = new Date(now);
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const count = this.database.db
      .prepare(`SELECT COUNT(*) AS c FROM concerns WHERE ref LIKE ?`)
      .get(`SC-${ymd}-%`) as { c: number };
    return `SC-${ymd}-${String(count.c + 1).padStart(4, '0')}`;
  }

  private nextSeq(concernId: string): number {
    const row = this.database.db
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM timeline WHERE concern_id = ?')
      .get(concernId) as { s: number };
    return row.s;
  }

  private addEvent(
    concernId: string,
    originConcernId: string,
    type: TimelineType,
    actorId: string | null,
    now: number,
    fields: {
      verbatim?: string;
      quoteOccurredAt?: number;
      indicators?: RiskIndicator[];
      sceneSafety?: unknown;
      minimalAction?: string;
      body?: string;
      metadata?: Record<string, unknown>;
    },
  ): string {
    const id = randomUUID();
    this.database.db
      .prepare(
        `INSERT INTO timeline (
           id, concern_id, origin_concern_id, seq, type, actor_id, created_at,
           verbatim, quote_occurred_at, indicators, scene_safety, minimal_action, body, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        concernId,
        originConcernId,
        this.nextSeq(concernId),
        type,
        actorId,
        now,
        fields.verbatim ?? null,
        fields.quoteOccurredAt ?? null,
        fields.indicators ? JSON.stringify(fields.indicators) : null,
        fields.sceneSafety ? JSON.stringify(fields.sceneSafety) : null,
        fields.minimalAction ?? null,
        fields.body ?? null,
        JSON.stringify(fields.metadata ?? {}),
      );
    return id;
  }

  private createAssignment(
    concernId: string,
    type: 'take_over' | 'review' | 'follow_up',
    assigneeId: string,
    description: string,
    assignedBy: string | null,
    now: number,
    dueAt: number | null,
    context: string | null = null,
  ): string {
    const id = randomUUID();
    this.database.db
      .prepare(
        `INSERT INTO assignments (id, concern_id, type, assignee_id, description, context, status, assigned_by, created_at, due_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(id, concernId, type, assigneeId, description, context, assignedBy, now, dueAt);
    return id;
  }

  private orderedEvents(concernId: string): TimelineRow[] {
    return this.database.db
      .prepare('SELECT * FROM timeline WHERE concern_id = ? ORDER BY created_at, seq')
      .all(concernId) as TimelineRow[];
  }

  private projectEvent(e: TimelineRow) {
    return {
      id: e.id,
      seq: e.seq,
      originConcernId: e.origin_concern_id,
      type: e.type,
      at: e.created_at,
      actor: e.actor_id ? { id: e.actor_id, ...this.staffName(e.actor_id) } : null,
      verbatim: e.verbatim,
      quoteOccurredAt: e.quote_occurred_at,
      indicators: e.indicators ? JSON.parse(e.indicators) : undefined,
      sceneSafety: e.scene_safety ? JSON.parse(e.scene_safety) : undefined,
      minimalAction: e.minimal_action,
      body: e.body,
      verificationState: e.verification_state,
      metadata: JSON.parse(e.metadata),
    };
  }

  private projectDisclosedFields(c: ConcernRow, view: ConcernView) {
    const initial = this.database.db
      .prepare(`SELECT * FROM timeline WHERE concern_id = ? AND type = 'initial_report' ORDER BY seq LIMIT 1`)
      .get(c.id) as TimelineRow;
    const allowed = new Set(view.allowedFields ?? []);
    return {
      disclosedOnly: true,
      verbatim: allowed.has('verbatim') ? initial.verbatim : undefined,
      indicators: allowed.has('indicators') && initial.indicators ? JSON.parse(initial.indicators) : undefined,
      sceneSafety: allowed.has('scene_safety') && initial.scene_safety ? JSON.parse(initial.scene_safety) : undefined,
      minimalAction: allowed.has('minimal_action') ? initial.minimal_action : undefined,
    };
  }

  private factsSummary(
    events: TimelineRow[],
    opts: { ownOnly: boolean; staffId?: string },
  ): Array<{ timelineEventId: string; seq: number; type: string; state: string; at: number }> {
    return events
      .filter((e) => FACTUAL_TYPES.has(e.type as TimelineType))
      .filter((e) => !opts.ownOnly || e.actor_id === opts.staffId)
      .map((e) => ({
        timelineEventId: e.id,
        seq: e.seq,
        type: e.type,
        state: e.verification_state,
        at: e.created_at,
      }));
  }

  private assignmentsForStaff(concernId: string, staffId: string) {
    return (this.database.db
      .prepare('SELECT * FROM assignments WHERE concern_id = ? AND assignee_id = ? ORDER BY created_at')
      .all(concernId, staffId) as any[]).map((a) => this.projectAssignment(a));
  }

  private allAssignments(concernId: string) {
    return (this.database.db
      .prepare('SELECT * FROM assignments WHERE concern_id = ? ORDER BY created_at')
      .all(concernId) as any[]).map((a) => this.projectAssignment(a));
  }

  private projectAssignment(a: any) {
    return {
      id: a.id,
      type: a.type,
      status: a.status,
      description: a.description,
      context: a.context,
      assignee: { id: a.assignee_id, ...this.staffName(a.assignee_id) },
      dueAt: a.due_at,
      ackAt: a.ack_at,
      doneAt: a.done_at,
    };
  }

  private mergeTrail(concernId: string) {
    return (this.database.db
      .prepare('SELECT * FROM merges WHERE surviving_concern_id = ? OR merged_concern_id = ? ORDER BY created_at')
      .all(concernId, concernId) as any[]).map((m) => ({
      id: m.id,
      survivingConcernId: m.surviving_concern_id,
      mergedConcernId: m.merged_concern_id,
      reason: m.reason,
      mergedBy: this.staffName(m.merged_by),
      at: m.created_at,
      undoneAt: m.undone_at,
      undoReason: m.undo_reason,
      // 拆分依据 = 原合并理由 + 拆分理由，均保留可查
      basis: m.undone_at ? `原合并：${m.reason}；拆分：${m.undo_reason}` : `合并：${m.reason}`,
    }));
  }

  private originFor(requestedConcernId: string, resolvedId: string): string {
    // 记录者在已被合并走的原线索上补充：事实来源仍记为原线索
    return requestedConcernId === resolvedId ? resolvedId : requestedConcernId;
  }
}
