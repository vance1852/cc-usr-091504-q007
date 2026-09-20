import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum MergeStatus {
  Active = 'active',
  /** 误合并后被拆分；拆分依据必须保留 */
  Split = 'split',
}

@Entity('merge_records')
export class MergeRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 主关切（保留） */
  @Column()
  @Index()
  primaryConcernId: string;

  /** 被合并的关切 */
  @Column()
  @Index()
  mergedConcernId: string;

  @Column()
  mergedById: string;

  /** 合并依据 */
  @Column({ type: 'text' })
  rationale: string;

  @Column({ type: 'varchar', default: MergeStatus.Active })
  status: MergeStatus;

  @Column({ type: 'varchar', nullable: true })
  splitById: string | null;

  @Column({ type: 'datetime', nullable: true })
  splitAt: Date | null;

  /** 拆分依据：误合并后必须填写并永久保留 */
  @Column({ type: 'text', nullable: true })
  splitRationale: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
