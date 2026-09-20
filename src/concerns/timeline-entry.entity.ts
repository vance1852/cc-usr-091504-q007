import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TimelineKind {
  /** 补充信息（同一关切的连续时间线） */
  Supplement = 'supplement',
  /** 调查笔记：仅保护链路可见，普通活动老师不可见 */
  Note = 'note',
  /** 要求记录者执行的动作 */
  ActionRequest = 'action_request',
  /** 系统事件（升级、合并、转交、撤回联系方式等） */
  System = 'system',
}

export enum VerificationStatus {
  Unverified = 'unverified',
  Verified = 'verified',
  Refuted = 'refuted',
  NotApplicable = 'not_applicable',
}

@Entity('timeline_entries')
export class TimelineEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  concernId: string;

  /** 作者；系统事件为 null */
  @Column({ type: 'varchar', nullable: true })
  authorId: string | null;

  @Column({ type: 'varchar' })
  kind: TimelineKind;

  @Column({ type: 'text' })
  body: string;

  /** 事实核实状态：责任视图据此列出"尚未核实的事实" */
  @Column({ type: 'varchar', default: VerificationStatus.Unverified })
  verificationStatus: VerificationStatus;

  @Column({ type: 'varchar', nullable: true })
  verifiedById: string | null;

  @Column({ type: 'datetime', nullable: true })
  verifiedAt: Date | null;

  /** action_request 专用：动作指向谁 */
  @Column({ type: 'varchar', nullable: true })
  addressedToId: string | null;

  @Column({ type: 'datetime', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
