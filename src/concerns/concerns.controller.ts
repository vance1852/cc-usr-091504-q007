import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { StaffUser } from '../access/access.service';
import { ConcernsService } from './concerns.service';
import {
  ActionAckDto,
  AssignFollowUpDto,
  CloseDto,
  CreateConcernDto,
  DisclosureDto,
  MergeDto,
  ReferralDto,
  RespondReferralDto,
  SupplementDto,
  TakeoverAckDto,
  UnmergeDto,
  VerifyFactDto,
} from './dto';

@Controller('concerns')
@UseGuards(StaffGuard)
export class ConcernsController {
  constructor(private readonly concerns: ConcernsService) {}

  /** 我的关切工作台：记录者只见自己提交；保护人员见授权范围；普通老师只见被指派动作 */
  @Get()
  list(@Req() req: { staff: StaffUser }) {
    return this.concerns.list(req.staff);
  }

  /** 责任视图：谁在接管、何时到期、哪些事实未核实、每次披露对象与理由 */
  @Get(':id')
  getOne(@Req() req: { staff: StaffUser }, @Param('id') id: string) {
    return this.concerns.getOne(req.staff, id);
  }

  /** 初次记录：原话、发生时间、现场安全情况、已采取的最小措施 */
  @Post()
  create(@Req() req: { staff: StaffUser }, @Body() dto: CreateConcernDto) {
    return this.concerns.createConcern(req.staff, dto);
  }

  /** 同一关切的补充信息，进入连续时间线；可同时撤回联系方式 */
  @Post(':id/supplements')
  supplement(
    @Req() req: { staff: StaffUser },
    @Param('id') id: string,
    @Body() dto: SupplementDto,
  ) {
    return this.concerns.supplement(req.staff, id, dto);
  }

  /** 接管人必须确认已收到 */
  @Post(':id/takeover-ack')
  ackTakeover(
    @Req() req: { staff: StaffUser },
    @Param('id') id: string,
    @Body() dto: TakeoverAckDto,
  ) {
    return this.concerns.acknowledgeTakeover(req.staff, id, dto ?? {});
  }

  /** 匿名咨询：保护负责人阅看确认（不启动接管时钟） */
  @Post(':id/review-ack')
  ackReview(@Req() req: { staff: StaffUser }, @Param('id') id: string) {
    return this.concerns.acknowledgeReview(req.staff, id);
  }

  /** 向其他教职员指派最小必要动作（可跨班，不暴露调查细节） */
  @Post(':id/follow-ups')
  assignFollowUp(
    @Req() req: { staff: StaffUser },
    @Param('id') id: string,
    @Body() dto: AssignFollowUpDto,
  ) {
    return this.concerns.assignFollowUp(req.staff, id, dto);
  }

  /** 被指派人确认收到 / 完成动作 */
  @Post('actions/:actionId/ack')
  ackAction(
    @Req() req: { staff: StaffUser },
    @Param('actionId') actionId: string,
    @Body() dto: ActionAckDto,
  ) {
    return this.concerns.acknowledgeAction(req.staff, actionId, dto?.done ?? false);
  }

  /** 转交外部专业人员：明确移交内容与责任 */
  @Post(':id/referrals')
  refer(
    @Req() req: { staff: StaffUser },
    @Param('id') id: string,
    @Body() dto: ReferralDto,
  ) {
    return this.concerns.refer(req.staff, id, dto);
  }

  /** 外部移交的接受/拒绝回执（由保护人员登记） */
  @Post('referrals/:referralId/respond')
  respondReferral(
    @Req() req: { staff: StaffUser },
    @Param('referralId') referralId: string,
    @Body() dto: RespondReferralDto,
  ) {
    return this.concerns.respondReferral(req.staff, referralId, dto);
  }

  /** 最小必要披露：每次记录披露对象、理由与实际披露字段 */
  @Post(':id/disclosures')
  disclose(
    @Req() req: { staff: StaffUser },
    @Param('id') id: string,
    @Body() dto: DisclosureDto,
  ) {
    return this.concerns.disclose(req.staff, id, dto);
  }

  /** 保护负责人合并相关线索 */
  @Post(':id/merges')
  merge(
    @Req() req: { staff: StaffUser },
    @Param('id') id: string,
    @Body() dto: MergeDto,
  ) {
    return this.concerns.merge(req.staff, id, dto);
  }

  /** 误合并拆分：原合并理由与拆分依据均永久保留 */
  @Post(':id/unmerges')
  unmerge(
    @Req() req: { staff: StaffUser },
    @Param('id') id: string,
    @Body() dto: UnmergeDto,
  ) {
    return this.concerns.unmerge(req.staff, id, dto);
  }

  /** 人工登记事实核实结果（系统不自动对学生或家庭下结论） */
  @Post(':id/verifications')
  verify(
    @Req() req: { staff: StaffUser },
    @Param('id') id: string,
    @Body() dto: VerifyFactDto,
  ) {
    return this.concerns.verifyFact(req.staff, id, dto);
  }

  @Post(':id/close')
  close(
    @Req() req: { staff: StaffUser },
    @Param('id') id: string,
    @Body() dto: CloseDto,
  ) {
    return this.concerns.close(req.staff, id, dto);
  }
}
