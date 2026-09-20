import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Concern } from '../concerns/concern.entity';
import { TimelineEntry } from '../concerns/timeline-entry.entity';
import { DisclosuresModule } from '../disclosures/disclosures.module';
import { TakeoverModule } from '../takeover/takeover.module';
import { UsersModule } from '../users/users.module';
import { Transfer } from './transfer.entity';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transfer, Concern, TimelineEntry]),
    UsersModule,
    TakeoverModule,
    DisclosuresModule,
  ],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
