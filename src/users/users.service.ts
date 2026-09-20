import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffRole } from '../common/roles';
import { StaffUser } from './staff-user.entity';

/** 演示/测试用种子账号（固定 id，便于自动化场景复现） */
export const SEED_USERS = {
  mentorA: 'u-mentor-a',
  mentorB: 'u-mentor-b',
  lead: 'u-lead',
  senior: 'u-senior',
  externalB: 'u-ext-b',
} as const;

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(StaffUser)
    private readonly users: Repository<StaffUser>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if ((await this.users.count()) > 0) return;
    await this.users.save([
      { id: SEED_USERS.mentorA, name: '导师甲', role: StaffRole.ActivityMentor, classScope: 'A', active: true },
      { id: SEED_USERS.mentorB, name: '导师乙', role: StaffRole.ActivityMentor, classScope: 'B', active: true },
      { id: SEED_USERS.lead, name: '保护负责人', role: StaffRole.SafeguardingLead, classScope: null, active: true },
      { id: SEED_USERS.senior, name: '校长', role: StaffRole.SeniorLead, classScope: null, active: true },
      { id: SEED_USERS.externalB, name: '驻校社工(B班)', role: StaffRole.ExternalProfessional, classScope: 'B', active: true },
    ]);
  }

  findById(id: string): Promise<StaffUser | null> {
    return this.users.findOne({ where: { id } });
  }

  /** 为某个角色挑选当前可指派的员工（取第一位在岗者） */
  async firstActiveByRole(role: StaffRole): Promise<StaffUser | null> {
    return this.users.findOne({ where: { role, active: true } });
  }
}
