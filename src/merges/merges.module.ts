import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Concern } from '../concerns/concern.entity';
import { TimelineEntry } from '../concerns/timeline-entry.entity';
import { TakeoverModule } from '../takeover/takeover.module';
import { MergeRecord } from './merge-record.entity';
import { MergesController } from './merges.controller';
import { MergesService } from './merges.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MergeRecord, Concern, TimelineEntry]),
    TakeoverModule,
  ],
  controllers: [MergesController],
  providers: [MergesService],
})
export class MergesModule {}
