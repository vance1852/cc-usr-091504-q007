import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** 标记无需身份识别的端点（如健康检查） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
