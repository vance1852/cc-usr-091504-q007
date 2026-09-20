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
import { DisclosuresService } from '../disclosures/disclosures.service';
import { TakeoverService } from '../takeover/takeover.service';
import { StaffUser } from '../users/staff-user.entity';
import { UsersService } from '../users/users.service';
import { CreateTransferDto } from './dto';
import { Transfer, TransferStatus } from './transfer.entity';

const CHAIN_ROLES = [StaffRole.SafeguardingLead, StaffRole.SeniorLead];

/**
 * 转交：必须明确移交内容与责任，接收方确认后责任才转移；
 * 跨班转交自动识别并标记。每次转交都登记披露记录。
 */
@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transfers: Repository<Transfer>,
    @InjectRepository(Concern)
    private readonly concerns: Repository<Concern>,
    @InjectRepository(TimelineEntry)
    private readonly timeline: Repository<TimelineEntry>,
    private readonly users: UsersService,
    private readonly takeover: TakeoverService,
    private readonly disclosures: DisclosuresService,
  ) {}

  async create(user: StaffUser, concernId: string, dto: CreateTransferDto) {
    const concern = await this.concerns.findOneBy({ id: concernId });
    if (!concern) throw new NotFoundException('关切不存在');
    if (concern.status === ConcernStatus.Closed) {
      throw new BadRequestException('已结案的关切不能转交');
    }
    if (!CHAIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('只有保护链路可以发起转交');
    }
    const target = await this.users.findById(dto.toUserId);
    if (!target || !target.active) {
      throw new NotFoundException('接收人不存在或已停用');
    }
    if (target.id === user.id) {
      throw new BadRequestException('不能转交给自己');
    }

    // 自动化场景：接收人负责的班级与关切班级不同 → 跨班转交
    const crossClass =
      !!target.classScope && target.classScope !== concern.classCode;

    const transfer = await this.transfers.save(
      this.transfers.create({
        concernId,
        fromUserId: user.id,
        toUserId: target.id,
        contentScope: dto.contentScope,
        responsibility: dto.responsibility,
        crossClass,
        status: TransferStatus.Pending,
      }),
    );

    await this.disclosures.record({
      concernId,
      toUserId: target.id,
      byUserId: user.id,
      reason: crossClass ? '跨班转交：接收人负责该学生所在班级' : '转交给专业人员',
      scope: dto.contentScope,
    });
    await this.systemEvent(
      concernId,
      `已发起${crossClass ? '跨班' : ''}转交 → ${target.name}，待对方确认`,
    );
    return transfer;
  }

  async accept(user: StaffUser, transferId: string) {
    const transfer = await this.mustFindPending(transferId, user);
    transfer.status = TransferStatus.Accepted;
    transfer.respondedAt = new Date();
    await this.transfers.save(transfer);
    await this.takeover.recordTransferTakeover(transfer.concernId, user);
    return transfer;
  }

  async decline(user: StaffUser, transferId: string, reason?: string) {
    const transfer = await this.mustFindPending(transferId, user);
    transfer.status = TransferStatus.Declined;
    transfer.respondedAt = new Date();
    transfer.declineReason = reason ?? null;
    await this.transfers.save(transfer);
    await this.systemEvent(
      transfer.concernId,
      `转交被 ${user.name} 谢绝${reason ? `：${reason}` : ''}`,
    );
    return transfer;
  }

  /** 发给我的待处理转交 */
  incoming(user: StaffUser) {
    return this.transfers.find({
      where: { toUserId: user.id, status: TransferStatus.Pending },
      order: { createdAt: 'DESC' },
    });
  }

  private async mustFindPending(
    transferId: string,
    user: StaffUser,
  ): Promise<Transfer> {
    const transfer = await this.transfers.findOneBy({ id: transferId });
    if (!transfer) throw new NotFoundException('转交不存在');
    if (transfer.toUserId !== user.id) {
      throw new ForbiddenException('只有接收人可以处理该转交');
    }
    if (transfer.status !== TransferStatus.Pending) {
      throw new BadRequestException('该转交已被处理');
    }
    return transfer;
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
