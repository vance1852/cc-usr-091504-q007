import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessModule } from '../access/access.module';
import { DisclosuresModule } from '../disclosures/disclosures.module';
import { MergeRecord } from '../merges/merge-record.entity';
import { RiskModule } from '../risk/risk.module';
import { TakeoverModule } from '../takeover/takeover.module';
import { Transfer } from '../transfers/transfer.entity';
import { UsersModule } from '../users/users.module';
import { Concern } from './concern.entity';
import { ConcernsController } from './concerns.controller';
import { ConcernsService } from './concerns.service';
import { ContactChannel } from './contact-channel.entity';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { TimelineEntry } from './timeline-entry.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Concern,
      TimelineEntry,
      ContactChannel,
      Transfer,
      MergeRecord,
    ]),
    RiskModule,
    TakeoverModule,
    DisclosuresModule,
    AccessModule,
    UsersModule,
  ],
  controllers: [ConcernsController],
  providers: [ConcernsService, DuplicateDetectionService],
  exports: [ConcernsService],
})
export class ConcernsModule {}
