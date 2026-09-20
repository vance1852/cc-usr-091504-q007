import { Module } from '@nestjs/common';
import { RiskRulesService } from './risk-rules.service';

@Module({
  providers: [RiskRulesService],
  exports: [RiskRulesService],
})
export class RiskModule {}
