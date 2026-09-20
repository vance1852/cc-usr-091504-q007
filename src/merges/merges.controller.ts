import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { StaffUser } from '../users/staff-user.entity';
import { MergesService } from './merges.service';

class MergeDto {
  /** 合并到哪个主关切 */
  @IsString()
  @IsNotEmpty()
  intoConcernId: string;

  /** 合并依据 */
  @IsString()
  @IsNotEmpty()
  rationale: string;
}

class SplitDto {
  /** 拆分依据（误合并原因），永久保留 */
  @IsString()
  @IsNotEmpty()
  rationale: string;
}

@Controller('concerns')
export class MergesController {
  constructor(private readonly merges: MergesService) {}

  @Post(':id/merge')
  merge(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: MergeDto,
  ) {
    return this.merges.merge(user, id, dto.intoConcernId, dto.rationale);
  }

  @Post(':id/split')
  split(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: SplitDto,
  ) {
    return this.merges.split(user, id, dto.rationale);
  }

  @Get(':id/merges')
  history(@CurrentUser() user: StaffUser, @Param('id') id: string) {
    return this.merges.historyFor(user, id);
  }
}
