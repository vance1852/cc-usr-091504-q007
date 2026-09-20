import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StaffRole } from '../common/roles';

export enum AssignmentStatus {
  /** 等待接管人确认收到 */
  Pending = 'pending',
  /** 接管人已确认收到 */
  Acknowledged = 'acknowledged',
  /** 超时未接管，已触发升级 */
  Expired = 'expired',
  /** 被合并、转交或更高级别取代 */
  Superseded = 'superseded',
}

export enum AssignmentSource {
  /** 按升级链自动分派 */
  Escalation = 'escalation',
  /** 由转交产生 */
  Transfer = 'transfer',
}

/**
 * 一次"待接管"指派。接管人必须确认收到；
 * 超时未确认则由调度器逐级升级。
 */
@Entity('assignments')
export class Assignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  concernId: string;

  @Column()
  assigneeId: string;

  @Column({ type: 'varchar' })
  assigneeRole: StaffRole;

  /** 升级级别：1 为保护负责人，逐级递增 */
  @Column()
  level: number;

  @Column({ type: 'varchar' })
  source: AssignmentSource;

  @Column({ type: 'varchar', default: AssignmentStatus.Pending })
  status: AssignmentStatus;

  @Column()
  dueAt: Date;

  @Column({ type: 'datetime', nullable: true })
  acknowledgedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
