import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { ESCALATION_CHAIN, ROLE_LABELS, StaffRole } from '../common/roles';
import { Concern, ConcernStatus } from '../concerns/concern.entity';
import {
  TimelineEntry,
  TimelineKind,
  VerificationStatus,
} from '../concerns/timeline-entry.entity';
import { DisclosuresService } from '../disclosures/disclosures.service';
import { StaffUser } from '../users/staff-user.entity';
import { UsersService } from '../users/users.service';
import {
  Assignment,
  AssignmentSource,
  AssignmentStatus,
} from './assignment.entity';

/**
 * 接管与升级：每条关切生成待接管指派，接管人必须确认收到；
 * 超时未确认则沿升级链逐级升级，并把摘要披露给下一级（登记披露理由）。
 */
@Injectable()
export class TakeoverService {
  private readonly logger = new Logger(TakeoverService.name);

  constructor(
    @InjectRepository(Assignment)
    private readonly assignments: Repository<Assignment>,
    @InjectRepository(Concern)
    private readonly concerns: Repository<Concern>,
    @InjectRepository(TimelineEntry)
    private readonly timeline: Repository<TimelineEntry>,
    private readonly users: UsersService,
    private readonly disclosures: DisclosuresService,
  ) {}

  /** 为关切创建某一升级级别的指派 */
  async createAssignment(
    concern: Concern,
    level: number,
    source: AssignmentSource,
    assigneeId?: string,
  ): Promise<Assignment> {
    const role = ESCALATION_CHAIN[level - 1];
    let assignee: StaffUser | null = null;
    if (assigneeId) {
      assignee = await this.users.findById(assigneeId);
    } else if (role) {
      assignee = await this.users.firstActiveByRole(role);
    }
    if (!assignee) {
      throw new NotFoundException(`升级级别 ${level} 没有可指派的员工`);
    }
    const minutes = this.minutesForLevel(concern, level);
    const assignment = await this.assignments.save(
      this.assignments.create({
        concernId: concern.id,
        assigneeId: assignee.id,
        assigneeRole: assignee.role,
        level,
        source,
        status: AssignmentStatus.Pending,
        dueAt: new Date(Date.now() + minutes * 60_000),
      }),
    );
    this.logger.log(
      `关切 ${concern.reference} 已指派给 ${assignee.name}（L${level}），截止 ${assignment.dueAt.toISOString()}`,
    );
    return assignment;
  }

  /** 接管时限随升级逐级收紧（基础时限的 1/level，至少 15 分钟） */
  private minutesForLevel(concern: Concern, level: number): number {
    const base = Math.max(
      0,
      Math.floor((concern.takeoverDueAt.getTime() - Date.now()) / 60_000),
    );
    const initial = base > 0 ? base : 60;
    return Math.max(15, Math.floor(initial / level));
  }

  /** 接管人确认收到 */
  async acknowledge(concernId: string, user: StaffUser): Promise<Assignment> {
    const current = await this.currentFor(concernId);
    if (!current || current.status !== AssignmentStatus.Pending) {
      throw new NotFoundException('当前没有待确认的接管指派');
    }
    if (current.assigneeId !== user.id) {
      throw new ForbiddenException('只有被指派的接管人可以确认收到');
    }
    current.status = AssignmentStatus.Acknowledged;
    current.acknowledgedAt = new Date();
    await this.assignments.save(current);
    await this.concerns.update(concernId, {
      status: ConcernStatus.TakenOver,
    });
    await this.systemEvent(concernId, `接管人已确认收到（L${current.level}）`);
    return current;
  }

  /** 当前生效的指派（待确认或已确认） */
  async currentFor(concernId: string): Promise<Assignment | null> {
    return this.assignments.findOne({
      where: {
        concernId,
        status: In([AssignmentStatus.Pending, AssignmentStatus.Acknowledged]),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async historyFor(concernId: string): Promise<Assignment[]> {
    return this.assignments.find({
      where: { concernId },
      order: { createdAt: 'ASC' },
    });
  }

  /** 合并/转交等场景下，作废旧指派 */
  async supersedeActive(concernId: string): Promise<void> {
    await this.assignments.update(
      {
        concernId,
        status: In([AssignmentStatus.Pending, AssignmentStatus.Acknowledged]),
      },
      { status: AssignmentStatus.Superseded },
    );
  }

  /** 转交被接受后：责任转移给接收人，登记为已确认的指派 */
  async recordTransferTakeover(
    concernId: string,
    assignee: StaffUser,
  ): Promise<Assignment> {
    await this.supersedeActive(concernId);
    const assignment = await this.assignments.save(
      this.assignments.create({
        concernId,
        assigneeId: assignee.id,
        assigneeRole: assignee.role,
        level: 1,
        source: AssignmentSource.Transfer,
        status: AssignmentStatus.Acknowledged,
        dueAt: new Date(Date.now() + 24 * 60 * 60_000),
        acknowledgedAt: new Date(),
      }),
    );
    await this.concerns.update(concernId, {
      status: ConcernStatus.TakenOver,
    });
    await this.systemEvent(
      concernId,
      `转交已被接受，责任由 ${assignee.name} 承担`,
    );
    return assignment;
  }

  /** 定时扫描入口（可用 ESCALATION_SCAN_DISABLED=1 关闭，测试时手动触发） */
  @Interval(30_000)
  async scheduledScan(): Promise<void> {
    if (process.env.ESCALATION_SCAN_DISABLED === '1') return;
    await this.processOverdue();
  }

  /** 超时未接管 → 逐级升级 */
  async processOverdue(now: Date = new Date()): Promise<Assignment[]> {
    const overdue = await this.assignments.find({
      where: { status: AssignmentStatus.Pending, dueAt: LessThan(now) },
    });
    const created: Assignment[] = [];
    for (const assignment of overdue) {
      const next = await this.escalate(assignment, now);
      if (next) created.push(next);
    }
    return created;
  }

  private async escalate(
    assignment: Assignment,
    now: Date,
  ): Promise<Assignment | null> {
    assignment.status = AssignmentStatus.Expired;
    await this.assignments.save(assignment);

    const concern = await this.concerns.findOneBy({ id: assignment.concernId });
    if (!concern || concern.status === ConcernStatus.Closed) return null;

    const nextLevel = assignment.level + 1;
    if (nextLevel > ESCALATION_CHAIN.length) {
      await this.systemEvent(
        concern.id,
        `已达最高升级级别（L${assignment.level}）仍未接管，需人工介入`,
      );
      this.logger.error(`关切 ${concern.reference} 升级链耗尽，仍未被接管`);
      return null;
    }

    const nextRole: StaffRole = ESCALATION_CHAIN[nextLevel - 1];
    const next = await this.createAssignment(concern, nextLevel, AssignmentSource.Escalation);
    await this.systemEvent(
      concern.id,
      `L${assignment.level} 超时未接管，已升级至 L${nextLevel}（${ROLE_LABELS[nextRole]}）`,
    );
    // 升级即披露：向下一级共享处置摘要，登记理由
    await this.disclosures.record({
      concernId: concern.id,
      toUserId: next.assigneeId,
      byUserId: null,
      reason: `L${assignment.level} 超时未接管，按升级链升级`,
      scope: '关切摘要、风险等级、接管时限',
    });
    return next;
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
