import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Concern } from '../concerns/concern.entity';
import { TimelineEntry } from '../concerns/timeline-entry.entity';
import { DisclosuresModule } from '../disclosures/disclosures.module';
import { UsersModule } from '../users/users.module';
import { Assignment } from './assignment.entity';
import { TakeoverService } from './takeover.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Assignment, Concern, TimelineEntry]),
    UsersModule,
    DisclosuresModule,
  ],
  providers: [TakeoverService],
  exports: [TakeoverService],
})
export class TakeoverModule {}
