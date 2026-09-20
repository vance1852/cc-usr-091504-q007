import {
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateTransferDto {
  @IsString()
  @IsNotEmpty()
  toUserId: string;

  /** 移交内容：明确共享哪些材料（必填） */
  @IsString()
  @IsNotEmpty()
  contentScope: string;

  /** 移交责任：接收方承担什么（必填） */
  @IsString()
  @IsNotEmpty()
  responsibility: string;
}

export class DeclineTransferDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
