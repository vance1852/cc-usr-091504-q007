import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Not, Repository } from 'typeorm';
import { Concern, ConcernStatus } from './concern.entity';

const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 重复报告检测：同一学生、时间相近且仍未结案的关切
 * 会被标记为疑似重复并交叉链接，但是否合并由保护负责人决定。
 */
@Injectable()
export class DuplicateDetectionService {
  constructor(
    @InjectRepository(Concern)
    private readonly concerns: Repository<Concern>,
  ) {}

  async findCandidates(input: {
    studentRef: string;
    occurredAt: Date;
    excludeId?: string;
  }): Promise<Concern[]> {
    const from = new Date(input.occurredAt.getTime() - DUPLICATE_WINDOW_MS);
    const to = new Date(input.occurredAt.getTime() + DUPLICATE_WINDOW_MS);
    return this.concerns.find({
      where: {
        studentRef: input.studentRef,
        occurredAt: Between(from, to),
        status: Not(ConcernStatus.Closed),
        mergedIntoId: IsNull(),
        ...(input.excludeId ? { id: Not(input.excludeId) } : {}),
      },
      order: { createdAt: 'ASC' },
    });
  }
}
