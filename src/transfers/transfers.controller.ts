import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { StaffUser } from '../users/staff-user.entity';
import { CreateTransferDto, DeclineTransferDto } from './dto';
import { TransfersService } from './transfers.service';

@Controller()
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  /** 发起转交（必须给出移交内容与责任） */
  @Post('concerns/:id/transfer')
  create(
    @CurrentUser() user: StaffUser,
    @Param('id') concernId: string,
    @Body() dto: CreateTransferDto,
  ) {
    return this.transfers.create(user, concernId, dto);
  }

  @Get('transfers/incoming')
  incoming(@CurrentUser() user: StaffUser) {
    return this.transfers.incoming(user);
  }

  @Post('transfers/:id/accept')
  accept(@CurrentUser() user: StaffUser, @Param('id') id: string) {
    return this.transfers.accept(user, id);
  }

  @Post('transfers/:id/decline')
  decline(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: DeclineTransferDto,
  ) {
    return this.transfers.decline(user, id, dto.reason);
  }
}
