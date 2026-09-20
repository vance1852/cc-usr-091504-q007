import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { StaffUser } from '../users/staff-user.entity';
import { ConcernsService } from './concerns.service';
import {
  ActionRequestDto,
  AddEntryDto,
  AttachContactDto,
  CloseConcernDto,
  CreateConcernDto,
  ExternalDisclosureDto,
  VerifyEntryDto,
} from './dto';

@Controller('concerns')
export class ConcernsController {
  constructor(private readonly concerns: ConcernsService) {}

  /** 教职员工登记保护性关切 */
  @Post()
  create(@CurrentUser() user: StaffUser, @Body() dto: CreateConcernDto) {
    return this.concerns.create(user, dto);
  }

  /** 记录者：自己的提交与必须执行的动作 */
  @Get('mine')
  mine(@CurrentUser() user: StaffUser) {
    return this.concerns.mine(user);
  }

  /** 保护链路/专业人员收件箱 */
  @Get('inbox')
  inbox(@CurrentUser() user: StaffUser) {
    return this.concerns.inbox(user);
  }

  @Get(':id')
  getOne(@CurrentUser() user: StaffUser, @Param('id') id: string) {
    return this.concerns.getOne(user, id);
  }

  /** 责任视图：谁在接管、何时到期、未核实事实、披露记录 */
  @Get(':id/responsibility')
  responsibility(@CurrentUser() user: StaffUser, @Param('id') id: string) {
    return this.concerns.getResponsibility(user, id);
  }

  /** 补充信息进入连续时间线 */
  @Post(':id/entries')
  addSupplement(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: AddEntryDto,
  ) {
    return this.concerns.addSupplement(user, id, dto);
  }

  /** 调查笔记（仅保护链路） */
  @Post(':id/notes')
  addNote(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: AddEntryDto,
  ) {
    return this.concerns.addNote(user, id, dto);
  }

  @Post('entries/:entryId/verify')
  verifyEntry(
    @CurrentUser() user: StaffUser,
    @Param('entryId') entryId: string,
    @Body() dto: VerifyEntryDto,
  ) {
    return this.concerns.verifyEntry(user, entryId, dto);
  }

  @Post(':id/action-requests')
  requestAction(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: ActionRequestDto,
  ) {
    return this.concerns.requestAction(user, id, dto);
  }

  @Post('entries/:entryId/complete')
  completeAction(
    @CurrentUser() user: StaffUser,
    @Param('entryId') entryId: string,
  ) {
    return this.concerns.completeAction(user, entryId);
  }

  /** 接管人确认收到 */
  @Post(':id/acknowledge')
  acknowledge(@CurrentUser() user: StaffUser, @Param('id') id: string) {
    return this.concerns.acknowledge(user, id);
  }

  /** 匿名咨询：登记/更新联系方式 */
  @Post(':id/contact')
  attachContact(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: AttachContactDto,
  ) {
    return this.concerns.attachContact(user, id, dto);
  }

  /** 撤回联系方式 */
  @Delete(':id/contact')
  withdrawContact(@CurrentUser() user: StaffUser, @Param('id') id: string) {
    return this.concerns.withdrawContact(user, id);
  }

  /** 登记对系统外的披露 */
  @Post(':id/disclosures')
  recordDisclosure(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: ExternalDisclosureDto,
  ) {
    return this.concerns.recordExternalDisclosure(user, id, dto);
  }

  @Post(':id/close')
  close(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: CloseConcernDto,
  ) {
    return this.concerns.close(user, id, dto);
  }
}
