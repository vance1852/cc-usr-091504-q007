import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AccessControlService, ViewLevel } from '../access/access-control.service';
import { StaffRole } from '../common/roles';
import { DisclosuresService } from '../disclosures/disclosures.service';
import { MergeRecord, MergeStatus } from '../merges/merge-record.entity';
import { AssignmentSource } from '../takeover/assignment.entity';
import { TakeoverService } from '../takeover/takeover.service';
import { Transfer, TransferStatus } from '../transfers/transfer.entity';
import { StaffUser } from '../users/staff-user.entity';
import { UsersService } from '../users/users.service';
import { ContactChannel } from './contact-channel.entity';
import { Concern, ConcernStatus, ReportMode } from './concern.entity';
import { DuplicateDetectionService } from './duplicate-detection.service';
import {
  ActionRequestDto,
  AddEntryDto,
  AttachContactDto,
  CloseConcernDto,
  CreateConcernDto,
  ExternalDisclosureDto,
  VerifyEntryDto,
} from './dto';
import { RiskRulesService } from '../risk/risk-rules.service';
import {
  TimelineEntry,
  TimelineKind,
  VerificationStatus,
} from './timeline-entry.entity';

const CHAIN_ROLES = [StaffRole.SafeguardingLead, StaffRole.SeniorLead];

@Injectable()
export class ConcernsService {
  private readonly logger = new Logger(ConcernsService.name);

  constructor(
    @InjectRepository(Concern)
    private readonly concerns: Repository<Concern>,
    @InjectRepository(TimelineEntry)
    private readonly timeline: Repository<TimelineEntry>,
    @InjectRepository(ContactChannel)
    private readonly contacts: Repository<ContactChannel>,
    @InjectRepository(Transfer)
    private readonly transfers: Repository<Transfer>,
    @InjectRepository(MergeRecord)
    private readonly merges: Repository<MergeRecord>,
    private readonly riskRules: RiskRulesService,
    private readonly takeover: TakeoverService,
    private readonly duplicates: DuplicateDetectionService,
    private readonly disclosures: DisclosuresService,
    private readonly access: AccessControlService,
    private readonly users: UsersService,
  ) {}

  // ---------- 创建 ----------

  async create(user: StaffUser, dto: CreateConcernDto) {
    const decision = this.riskRules.evaluate({
      immediateDanger: dto.immediateDanger ?? false,
      verbatimWords: dto.verbatimWords,
      sceneSafety: dto.sceneSafety,
      reportMode: dto.reportMode,
    });

    const reference = await this.nextReference();
    const concern = await this.concerns.save(
      this.concerns.create({
        reference,
        reporterId: user.id,
        reportMode: dto.reportMode,
        studentRef: dto.studentRef,
        classCode: dto.classCode,
        verbatimWords: dto.verbatimWords,
        occurredAt: new Date(dto.occurredAt),
        sceneSafety: dto.sceneSafety,
        immediateDanger: dto.immediateDanger ?? false,
        minimalActionsTaken: dto.minimalActionsTaken,
        riskLevel: decision.riskLevel,
        takeoverDueAt: new Date(Date.now() + decision.takeoverMinutes * 60_000),
        visibleRoles: decision.visibleRoles,
        status: ConcernStatus.AwaitingTakeover,
      }),
    );

    if (dto.contactInfo && dto.reportMode === ReportMode.AnonymousConsultation) {
      await this.contacts.save(
        this.contacts.create({ concernId: concern.id, contactInfo: dto.contactInfo }),
      );
    }

    await this.systemEvent(
      concern.id,
      `关切已登记（${decision.appliedRules.join('；')}）`,
    );
    await this.takeover.createAssignment(concern, 1, AssignmentSource.Escalation);

    // 自动化：疑似重复报告 → 标记并交叉链接，合并与否由保护负责人决定
    const candidates = await this.duplicates.findCandidates({
      studentRef: concern.studentRef,
      occurredAt: concern.occurredAt,
      excludeId: concern.id,
    });
    if (candidates.length > 0) {
      const primary = candidates[0];
      await this.concerns.update(concern.id, { duplicateOfId: primary.id });
      concern.duplicateOfId = primary.id;
      await this.systemEvent(
        concern.id,
        `自动化检测：与 ${primary.reference} 疑似重复（同一学生、时间相近），待保护负责人确认`,
      );
      await this.systemEvent(
        primary.id,
        `自动化检测：新报告 ${concern.reference} 与本关切疑似重复，待确认是否合并`,
      );
      this.logger.warn(`疑似重复报告：${concern.reference} ↔ ${primary.reference}`);
    }

    return this.getOne(user, concern.id);
  }

  private async nextReference(): Promise<string> {
    const count = await this.concerns.count();
    return `SC-${String(count + 1).padStart(4, '0')}`;
  }

  // ---------- 查询 ----------

  /** 记录者：自己提交的关切 + 必须执行的动作 */
  async mine(user: StaffUser) {
    const own = await this.concerns.find({
      where: { reporterId: user.id },
      order: { createdAt: 'DESC' },
    });
    const views = [];
    for (const concern of own) {
      views.push(await this.reporterViewFor(user, concern));
    }
    return { concerns: views, openActions: await this.openActionsFor(user.id) };
  }

  private async openActionsFor(userId: string): Promise<TimelineEntry[]> {
    const all = await this.timeline.find({
      where: { addressedToId: userId, kind: TimelineKind.ActionRequest },
      order: { createdAt: 'DESC' },
    });
    return all.filter((e) => !e.completedAt);
  }

  /** 保护链路/专业人员收件箱：指派给我的 + 我可见的未结关切 */
  async inbox(user: StaffUser) {
    const all = await this.concerns.find({ order: { createdAt: 'DESC' } });
    const items = [];
    for (const concern of all) {
      if (concern.mergedIntoId || concern.status === ConcernStatus.Closed) continue;
      const level = await this.resolveViewLevel(user, concern);
      if (level === ViewLevel.Chain || level === ViewLevel.Assignee) {
        const current = await this.takeover.currentFor(concern.id);
        items.push({
          id: concern.id,
          reference: concern.reference,
          status: concern.status,
          riskLevel: concern.riskLevel,
          reportMode: concern.reportMode,
          classCode: concern.classCode,
          viewLevel: level,
          currentAssignment: current
            ? {
                assigneeId: current.assigneeId,
                level: current.level,
                status: current.status,
                dueAt: current.dueAt,
              }
            : null,
          unverifiedFacts: (await this.unverifiedFacts(concern.id)).length,
        });
      }
    }
    return items;
  }

  async getOne(user: StaffUser, concernId: string) {
    const concern = await this.mustFind(concernId);
    const level = await this.resolveViewLevel(user, concern);
    if (!level) throw new NotFoundException('关切不存在或无权查看');

    if (level === ViewLevel.Reporter) return this.reporterViewFor(user, concern);
    if (level === ViewLevel.Assignee) {
      const transfer = await this.transfers.findOne({
        where: { concernId, toUserId: user.id },
        order: { createdAt: 'DESC' },
      });
      return this.access.assigneeView(concern, {
        contentScope: transfer?.contentScope ?? '（升级指派）关切摘要与处置要求',
        responsibility: transfer?.responsibility ?? '按升级链接管处置',
      });
    }
    const reporter = await this.users.findById(concern.reporterId);
    const timeline = await this.timelineFor(concern.id);
    return this.access.chainView(
      concern,
      reporter?.name ?? null,
      timeline,
      await this.contactFlags(concern.id),
    );
  }

  private async reporterViewFor(user: StaffUser, concern: Concern) {
    const entries = await this.timeline.find({
      where: { concernId: concern.id },
      order: { createdAt: 'ASC' },
    });
    const ownEntries = entries.filter((e) => e.authorId === user.id);
    const actions = entries.filter(
      (e) => e.kind === TimelineKind.ActionRequest && e.addressedToId === user.id,
    );
    return this.access.reporterView(
      concern,
      ownEntries,
      actions,
      await this.contactFlags(concern.id),
    );
  }

  /** 视角判定：记录者 / 保护链路 / 被转交人 / 无权限 */
  private async resolveViewLevel(
    user: StaffUser,
    concern: Concern,
  ): Promise<ViewLevel | null> {
    if (concern.reporterId === user.id) return ViewLevel.Reporter;
    const current = await this.takeover.currentFor(concern.id);
    if (
      CHAIN_ROLES.includes(user.role) &&
      (concern.visibleRoles.includes(user.role) ||
        current?.assigneeId === user.id)
    ) {
      return ViewLevel.Chain;
    }
    if (current?.assigneeId === user.id) return ViewLevel.Assignee;
    const transfer = await this.transfers.findOne({
      where: {
        concernId: concern.id,
        toUserId: user.id,
        status: In([TransferStatus.Pending, TransferStatus.Accepted]),
      },
    });
    if (transfer) return ViewLevel.Assignee;
    return null;
  }

  /** 连续时间线：主关切 + 被合并进来的关切，按时间排序 */
  async timelineFor(concernId: string): Promise<TimelineEntry[]> {
    const activeMerges = await this.merges.find({
      where: { primaryConcernId: concernId, status: MergeStatus.Active },
    });
    const ids = [concernId, ...activeMerges.map((m) => m.mergedConcernId)];
    return this.timeline.find({
      where: { concernId: In(ids) },
      order: { createdAt: 'ASC' },
    });
  }

  // ---------- 时间线 ----------

  /** 同一关切的补充信息进入连续时间线 */
  async addSupplement(user: StaffUser, concernId: string, dto: AddEntryDto) {
    const concern = await this.mustFind(concernId);
    const level = await this.resolveViewLevel(user, concern);
    if (level !== ViewLevel.Reporter && level !== ViewLevel.Chain) {
      throw new ForbiddenException('只有记录者或保护链路可以补充信息');
    }
    const entry = await this.timeline.save(
      this.timeline.create({
        concernId,
        authorId: user.id,
        kind: TimelineKind.Supplement,
        body: dto.body,
        verificationStatus: VerificationStatus.Unverified,
      }),
    );
    return entry;
  }

  /** 调查笔记：仅保护链路可见 */
  async addNote(user: StaffUser, concernId: string, dto: AddEntryDto) {
    await this.assertChain(user, concernId);
    return this.timeline.save(
      this.timeline.create({
        concernId,
        authorId: user.id,
        kind: TimelineKind.Note,
        body: dto.body,
        verificationStatus: VerificationStatus.NotApplicable,
      }),
    );
  }

  /** 核实/证伪一条补充信息 */
  async verifyEntry(user: StaffUser, entryId: string, dto: VerifyEntryDto) {
    const entry = await this.timeline.findOneBy({ id: entryId });
    if (!entry) throw new NotFoundException('时间线条目不存在');
    await this.assertChain(user, entry.concernId);
    if (entry.kind !== TimelineKind.Supplement) {
      throw new BadRequestException('只有补充信息可以核实');
    }
    entry.verificationStatus = dto.status;
    entry.verifiedById = user.id;
    entry.verifiedAt = new Date();
    return this.timeline.save(entry);
  }

  /** 要求记录者执行的动作（如补充某段时间的细节） */
  async requestAction(user: StaffUser, concernId: string, dto: ActionRequestDto) {
    await this.assertChain(user, concernId);
    const target = await this.users.findById(dto.toUserId);
    if (!target) throw new NotFoundException('动作接收人不存在');
    return this.timeline.save(
      this.timeline.create({
        concernId,
        authorId: user.id,
        kind: TimelineKind.ActionRequest,
        body: dto.body,
        verificationStatus: VerificationStatus.NotApplicable,
        addressedToId: dto.toUserId,
      }),
    );
  }

  async completeAction(user: StaffUser, entryId: string) {
    const entry = await this.timeline.findOneBy({ id: entryId });
    if (!entry || entry.kind !== TimelineKind.ActionRequest) {
      throw new NotFoundException('动作不存在');
    }
    if (entry.addressedToId !== user.id) {
      throw new ForbiddenException('只有被指派人可以完成该动作');
    }
    entry.completedAt = new Date();
    return this.timeline.save(entry);
  }

  /** 接管人确认收到（责任视图据此更新接管状态） */
  async acknowledge(user: StaffUser, concernId: string) {
    await this.mustFind(concernId);
    return this.takeover.acknowledge(concernId, user);
  }

  // ---------- 匿名咨询联系方式 ----------

  async attachContact(user: StaffUser, concernId: string, dto: AttachContactDto) {
    const concern = await this.mustFind(concernId);
    if (concern.reporterId !== user.id) {
      throw new ForbiddenException('只有记录者本人可以登记联系方式');
    }
    if (concern.reportMode !== ReportMode.AnonymousConsultation) {
      throw new BadRequestException('实名报告无需独立联系渠道');
    }
    const existing = await this.contacts.findOneBy({ concernId });
    if (existing && !existing.withdrawnAt) {
      throw new ConflictException('联系方式已存在');
    }
    if (existing) {
      existing.contactInfo = dto.contactInfo;
      existing.withdrawnAt = null;
      return this.contacts.save(existing);
    }
    return this.contacts.save(
      this.contacts.create({ concernId, contactInfo: dto.contactInfo }),
    );
  }

  /** 撤回联系方式：内容立即擦除，仅保留"曾提供、已撤回"的事实 */
  async withdrawContact(user: StaffUser, concernId: string) {
    const concern = await this.mustFind(concernId);
    if (concern.reporterId !== user.id) {
      throw new ForbiddenException('只有记录者本人可以撤回联系方式');
    }
    const contact = await this.contacts.findOneBy({ concernId });
    if (!contact || contact.withdrawnAt) {
      throw new NotFoundException('没有可撤回的联系方式');
    }
    contact.contactInfo = '';
    contact.withdrawnAt = new Date();
    await this.contacts.save(contact);
    await this.systemEvent(concernId, '记录者已撤回联系方式，内容已擦除');
    return { withdrawn: true, concernId };
  }

  // ---------- 责任视图 ----------

  /** 责任视图：谁在接管、何时到期、哪些事实未核实、每次披露的对象与理由 */
  async getResponsibility(user: StaffUser, concernId: string) {
    const concern = await this.mustFind(concernId);
    const level = await this.resolveViewLevel(user, concern);
    if (level !== ViewLevel.Chain) {
      throw new ForbiddenException('责任视图仅对保护链路开放');
    }
    const [current, history, unverified, disclosures, transfers, merges] =
      await Promise.all([
        this.takeover.currentFor(concernId),
        this.takeover.historyFor(concernId),
        this.unverifiedFacts(concernId),
        this.disclosures.listForConcern(concernId),
        this.transfers.find({ where: { concernId }, order: { createdAt: 'ASC' } }),
        this.merges.find({
          where: [
            { primaryConcernId: concernId },
            { mergedConcernId: concernId },
          ],
        }),
      ]);

    const nameOf = async (id: string | null) =>
      id ? (await this.users.findById(id))?.name ?? id : '系统';

    return {
      concern: {
        id: concern.id,
        reference: concern.reference,
        status: concern.status,
        riskLevel: concern.riskLevel,
        reportMode: concern.reportMode,
      },
      currentAssignment: current
        ? {
            assigneeId: current.assigneeId,
            assigneeName: await nameOf(current.assigneeId),
            level: current.level,
            status: current.status,
            dueAt: current.dueAt,
            acknowledgedAt: current.acknowledgedAt,
          }
        : null,
      escalationTrail: await Promise.all(
        history.map(async (a) => ({
          level: a.level,
          assigneeId: a.assigneeId,
          assigneeName: await nameOf(a.assigneeId),
          status: a.status,
          dueAt: a.dueAt,
          acknowledgedAt: a.acknowledgedAt,
        })),
      ),
      unverifiedFacts: unverified.map((e) => ({
        entryId: e.id,
        concernId: e.concernId,
        excerpt: e.body.slice(0, 120),
        createdAt: e.createdAt,
      })),
      disclosures: await Promise.all(
        disclosures.map(async (d) => ({
          to: d.toUserId ? await nameOf(d.toUserId) : d.toDescription,
          by: await nameOf(d.byUserId),
          reason: d.reason,
          scope: d.scope,
          at: d.createdAt,
        })),
      ),
      transfers: transfers.map((t) => ({
        id: t.id,
        toUserId: t.toUserId,
        contentScope: t.contentScope,
        responsibility: t.responsibility,
        crossClass: t.crossClass,
        status: t.status,
      })),
      merges: merges.map((m) => ({
        id: m.id,
        primaryConcernId: m.primaryConcernId,
        mergedConcernId: m.mergedConcernId,
        rationale: m.rationale,
        status: m.status,
        splitRationale: m.splitRationale,
      })),
    };
  }

  private async unverifiedFacts(concernId: string): Promise<TimelineEntry[]> {
    const entries = await this.timelineFor(concernId);
    return entries.filter(
      (e) =>
        e.kind === TimelineKind.Supplement &&
        e.verificationStatus === VerificationStatus.Unverified,
    );
  }

  /** 登记一次对系统外的披露（如电话告知未保机构） */
  async recordExternalDisclosure(
    user: StaffUser,
    concernId: string,
    dto: ExternalDisclosureDto,
  ) {
    await this.assertChain(user, concernId);
    const disclosure = await this.disclosures.record({
      concernId,
      toDescription: dto.toDescription,
      byUserId: user.id,
      reason: dto.reason,
      scope: dto.scope,
    });
    await this.systemEvent(concernId, `对外披露已登记：${dto.toDescription}`);
    return disclosure;
  }

  async close(user: StaffUser, concernId: string, dto: CloseConcernDto) {
    const concern = await this.mustFind(concernId);
    await this.assertChain(user, concernId);
    concern.status = ConcernStatus.Closed;
    concern.closedAt = new Date();
    concern.closeReason = dto.reason;
    await this.concerns.save(concern);
    await this.takeover.supersedeActive(concernId);
    await this.systemEvent(concernId, `关切已结案：${dto.reason}`);
    return { id: concernId, status: concern.status };
  }

  // ---------- 工具 ----------

  async mustFind(concernId: string): Promise<Concern> {
    const concern = await this.concerns.findOneBy({ id: concernId });
    if (!concern) throw new NotFoundException('关切不存在');
    return concern;
  }

  private async assertChain(user: StaffUser, concernId: string): Promise<void> {
    const concern = await this.mustFind(concernId);
    const level = await this.resolveViewLevel(user, concern);
    if (level !== ViewLevel.Chain) {
      throw new ForbiddenException('该操作仅对保护链路开放');
    }
  }

  private async contactFlags(concernId: string) {
    const contact = await this.contacts.findOneBy({ concernId });
    return {
      provided: !!contact,
      withdrawn: !!contact?.withdrawnAt,
    };
  }

  private async systemEvent(concernId: string, body: string): Promise<void> {
    await this.timeline.save(
      this.timeline.create({
        concernId,
        authorId: null,
        kind: TimelineKind.System,
        body,
        verificationStatus: VerificationStatus.NotApplicable,
      }),
    );
  }
}
