import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 匿名咨询的联系方式独立存放，与关切正文分离；
 * 记录者可随时撤回，撤回后内容被擦除，仅保留"曾提供/已撤回"的事实。
 */
@Entity('contact_channels')
export class ContactChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Index()
  concernId: string;

  @Column({ type: 'text' })
  contactInfo: string;

  @Column({ type: 'datetime', nullable: true })
  withdrawnAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
