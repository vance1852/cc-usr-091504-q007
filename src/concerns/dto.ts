import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReportMode } from './concern.entity';
import { VerificationStatus } from './timeline-entry.entity';

export class CreateConcernDto {
  @IsEnum(ReportMode)
  reportMode: ReportMode;

  /** 学生化名/内部编号 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  studentRef: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  classCode: string;

  /** 学生原话，逐字记录 */
  @IsString()
  @IsNotEmpty()
  verbatimWords: string;

  @IsDateString()
  occurredAt: string;

  /** 现场安全情况 */
  @IsString()
  @IsNotEmpty()
  sceneSafety: string;

  @IsBoolean()
  @IsOptional()
  immediateDanger?: boolean;

  /** 已经采取的最小措施 */
  @IsString()
  @IsNotEmpty()
  minimalActionsTaken: string;

  /** 匿名咨询时可附联系方式（独立封存，可撤回） */
  @IsString()
  @IsOptional()
  contactInfo?: string;
}

export class AddEntryDto {
  @IsString()
  @IsNotEmpty()
  body: string;
}

export class ActionRequestDto {
  @IsString()
  @IsNotEmpty()
  toUserId: string;

  @IsString()
  @IsNotEmpty()
  body: string;
}

export class VerifyEntryDto {
  @IsIn([VerificationStatus.Verified, VerificationStatus.Refuted])
  status: VerificationStatus.Verified | VerificationStatus.Refuted;
}

export class AttachContactDto {
  @IsString()
  @IsNotEmpty()
  contactInfo: string;
}

export class CloseConcernDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ExternalDisclosureDto {
  /** 披露对象（系统外） */
  @IsString()
  @IsNotEmpty()
  toDescription: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsNotEmpty()
  scope: string;
}
