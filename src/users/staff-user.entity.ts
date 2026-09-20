import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StaffRole } from '../common/roles';

@Entity('staff_users')
export class StaffUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar' })
  role: StaffRole;

  /** 负责的班级范围（用于跨班转交）；空表示不限定班级 */
  @Column({ type: 'varchar', nullable: true })
  classScope: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
