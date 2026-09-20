import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Disclosure } from './disclosure.entity';

export interface RecordDisclosureInput {
  concernId: string;
  toUserId?: string | null;
  toDescription?: string | null;
  byUserId?: string | null;
  reason: string;
  scope: string;
}

@Injectable()
export class DisclosuresService {
  constructor(
    @InjectRepository(Disclosure)
    private readonly disclosures: Repository<Disclosure>,
  ) {}

  /** 每次披露都必须登记对象与理由 */
  async record(input: RecordDisclosureInput): Promise<Disclosure> {
    return this.disclosures.save(this.disclosures.create(input));
  }

  listForConcern(concernId: string): Promise<Disclosure[]> {
    return this.disclosures.find({
      where: { concernId },
      order: { createdAt: 'ASC' },
    });
  }
}
