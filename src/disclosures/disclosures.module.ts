import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Disclosure } from './disclosure.entity';
import { DisclosuresService } from './disclosures.service';

@Module({
  imports: [TypeOrmModule.forFeature([Disclosure])],
  providers: [DisclosuresService],
  exports: [DisclosuresService],
})
export class DisclosuresModule {}
