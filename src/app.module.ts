import { Module } from '@nestjs/common';
import { Database } from './db/database';
import { ClockService } from './domain/clock.service';
import { AccessService } from './access/access.service';
import { ConcernsService } from './concerns/concerns.service';
import { ConcernsController } from './concerns/concerns.controller';
import { EscalationScheduler } from './concerns/escalation.scheduler';

@Module({
  imports: [],
  controllers: [ConcernsController],
  providers: [Database, ClockService, AccessService, ConcernsService, EscalationScheduler],
})
export class AppModule {}
