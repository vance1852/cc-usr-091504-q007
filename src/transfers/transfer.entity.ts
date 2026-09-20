import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TransferStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Declined = 'declined',
}

/**
 * 转交给其他专业人员：必须明确移交内容与责任边界，
 * 接收方确认后责任才转移。
 */
@Entity('transfers')
export class Transfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  concernId: string;

  @Column()
  fromUserId: string;

  @Column()
  toUserId: string;

  /** 移交内容：明确共享哪些材料 */
  @Column({ type: 'text' })
  contentScope: string;

  /** 移交责任：接收方承担什么 */
  @Column({ type: 'text' })
  responsibility: string;

  /** 是否跨班/跨范围转交 */
  @Column({ default: false })
  crossClass: boolean;

  @Column({ type: 'varchar', default: TransferStatus.Pending })
  status: TransferStatus;

  @Column({ type: 'datetime', nullable: true })
  respondedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  declineReason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
