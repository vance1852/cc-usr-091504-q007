import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffRole } from '../common/roles';
import { Concern, ConcernStatus } from '../concerns/concern.entity';
import {
  TimelineEntry,
  TimelineKind,
  VerificationStatus,
} from '../concerns/timeline-entry.entity';
import { AssignmentSource, AssignmentStatus } from '../takeover/assignment.entity';
import { TakeoverService } from '../takeover/takeover.service';
import { StaffUser } from '../users/staff-user.entity';
import { MergeRecord, MergeStatus } from './merge-record.entity';

/**
 * 线索合并与拆分：保护负责人可合并相关线索；
 * 误合并拆分时必须填写拆分依据，且合并/拆分记录永久保留。
 */
@Injectable()
export class MergesService {
  constructor(
    @InjectRepository(MergeRecord)
    private readonly merges: Repository<MergeRecord>,
    @InjectRepository(Concern)
    private readonly concerns: Repository<Concern>,
    @InjectRepository(TimelineEntry)
    private readonly timeline: Repository<TimelineEntry>,
    private readonly takeover: TakeoverService,
  ) {}

  /** 把 concernId 合并进 primaryId */
  async merge(
    user: StaffUser,
    concernId: string,
    primaryId: string,
    rationale: string,
  ): Promise<MergeRecord> {
    this.assertLead(user);
    if (!rationale?.trim()) {
      throw new BadRequestException('合并必须填写依据');
    }
    if (concernId === primaryId) {
      throw new BadRequestException('不能将关切合并到自身');
    }
    const [concern, primary] = await Promise.all([
      this.concerns.findOneBy({ id: concernId }),
      this.concerns.findOneBy({ id: primaryId }),
    ]);
    if (!concern || !primary) throw new NotFoundException('关切不存在');
    if (concern.status === ConcernStatus.Closed || primary.status === ConcernStatus.Closed) {
      throw new BadRequestException('已结案的关切不能参与合并');
    }
    if (concern.mergedIntoId) {
      throw new BadRequestException('该关切已被合并，请先拆分');
    }
    if (primary.mergedIntoId) {
      throw new BadRequestException('目标关切本身已被合并，请合并到主关切');
    }

    concern.mergedIntoId = primaryId;
    await this.concerns.save(concern);
    await this.takeover.supersedeActive(concernId);

    const record = await this.merges.save(
      this.merges.create({
        primaryConcernId: primaryId,
        mergedConcernId: concernId,
        mergedById: user.id,
        rationale,
        status: MergeStatus.Active,
      }),
    );
    await this.systemEvent(concernId, `已合并到 ${primary.reference}：${rationale}`);
    await this.systemEvent(primaryId, `已并入 ${concern.reference}：${rationale}`);
    return record;
  }

  /** 误合并后的拆分：必须填写拆分依据，原合并记录保留 */
  async split(
    user: StaffUser,
    concernId: string,
    splitRationale: string,
  ): Promise<MergeRecord> {
    this.assertLead(user);
    if (!splitRationale?.trim()) {
      throw new BadRequestException('拆分必须填写依据（误合并原因）');
    }
    const concern = await this.concerns.findOneBy({ id: concernId });
    if (!concern || !concern.mergedIntoId) {
      throw new NotFoundException('该关切当前未处于合并状态');
    }
    const record = await this.merges.findOne({
      where: { mergedConcernId: concernId, status: MergeStatus.Active },
    });
    if (!record) throw new NotFoundException('未找到有效的合并记录');

    record.status = MergeStatus.Split;
    record.splitById = user.id;
    record.splitAt = new Date();
    record.splitRationale = splitRationale;
    await this.merges.save(record);

    concern.mergedIntoId = null;
    await this.concerns.save(concern);

    // 拆分后重新进入接管流程
    const fresh = await this.concerns.findOneBy({ id: concernId });
    await this.takeover.createAssignment(fresh!, 1, AssignmentSource.Escalation);
    await this.systemEvent(
      concernId,
      `已从 ${record.primaryConcernId} 拆分（误合并）：${splitRationale}`,
    );
    return record;
  }

  /** 某关切相关的全部合并/拆分历史（仅保护链路） */
  historyFor(user: StaffUser, concernId: string): Promise<MergeRecord[]> {
    this.assertLead(user);
    return this.merges.find({
      where: [{ primaryConcernId: concernId }, { mergedConcernId: concernId }],
      order: { createdAt: 'ASC' },
    });
  }

  private assertLead(user: StaffUser): void {
    if (user.role !== StaffRole.SafeguardingLead && user.role !== StaffRole.SeniorLead) {
      throw new ForbiddenException('只有保护负责人可以合并/拆分线索');
    }
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
