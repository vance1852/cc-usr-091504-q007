import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 披露记录：每一次把关切内容透露给某人/某方，
 * 都记录对象与理由，供责任视图审计。
 */
@Entity('disclosures')
export class Disclosure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  concernId: string;

  /** 披露给系统内用户时为 userId，否则为 null */
  @Column({ type: 'varchar', nullable: true })
  toUserId: string | null;

  /** 对外披露时的对象描述（如"区未保中心电话值班员"） */
  @Column({ type: 'varchar', nullable: true })
  toDescription: string | null;

  /** 披露人；系统触发（如自动升级）为 null */
  @Column({ type: 'varchar', nullable: true })
  byUserId: string | null;

  /** 披露理由（必填，审计核心） */
  @Column({ type: 'text' })
  reason: string;

  /** 披露范围：共享了哪些内容 */
  @Column({ type: 'text' })
  scope: string;

  @CreateDateColumn()
  createdAt: Date;
}
