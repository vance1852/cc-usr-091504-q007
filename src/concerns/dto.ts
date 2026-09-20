import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RiskIndicator } from '../domain/enums';

export class SceneSafetyDto {
  @IsBoolean()
  dangerNow!: boolean;

  @IsBoolean()
  safeLocation!: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  narrative!: string;
}

export class CreateConcernDto {
  @IsIn(['named_report', 'anonymous_consultation'])
  kind!: 'named_report' | 'anonymous_consultation';

  /** 实名报告须有学生标识；匿名咨询必须为空（身份未识别） */
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  studentPseudonym?: string;

  @IsOptional()
  @IsString()
  classId?: string;

  /** 学生原话逐字记录，不得改写为结论性语言 */
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  verbatim!: string;

  /** 学生讲话发生时间（epoch ms）；缺省取提交时刻 */
  @IsOptional()
  @IsInt()
  quoteOccurredAt?: number;

  @IsArray()
  @ArrayMaxSize(10)
  @IsIn([
    'unwilling_to_go_home',
    'fear_of_person_at_home',
    'injury_observed',
    'disclosure_of_harm',
    'imminent_danger',
    'other',
  ] satisfies RiskIndicator[], { each: true })
  indicators!: RiskIndicator[];

  @ValidateNested()
  @Type(() => SceneSafetyDto)
  sceneSafety!: SceneSafetyDto;

  /** 已经采取的最小措施（如：陪同至明亮教室、未让其独自离校） */
  @IsString()
  @MaxLength(2000)
  minimalAction!: string;

  /** 记录者联系方式，可在之后撤回并抹除 */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reporterContact?: string;
}

export class SupplementDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  contactRetraction?: boolean;
}

export class TakeoverAckDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class AssignFollowUpDto {
  @IsString()
  assigneeId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description!: string;

  /** 执行动作所必需的最小上下文；调查细节不得放入 */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  context?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  dueInMinutes?: number;
}

export class ActionAckDto {
  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class ReferralDto {
  @IsString()
  @MinLength(1)
  externalOrg!: string;

  @IsString()
  @MinLength(1)
  externalRole!: string;

  @IsOptional()
  @IsString()
  externalContact?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  scopeSummary!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  responsibility!: string;
}

export class RespondReferralDto {
  @IsIn(['accepted', 'declined'])
  decision!: 'accepted' | 'declined';
}

export class DisclosureDto {
  @IsString()
  recipientId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  /** 本次披露实际需要让对方看到的字段，默认只给最小集合 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fields?: string[];
}

export class MergeDto {
  @IsString()
  sourceConcernId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class UnmergeDto {
  @IsString()
  mergedConcernId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class VerifyFactDto {
  @IsString()
  timelineEventId!: string;

  @IsIn(['verified', 'refuted'])
  state!: 'verified' | 'refuted';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CloseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  summary!: string;
}
