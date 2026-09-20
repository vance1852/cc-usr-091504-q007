import {
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { StaffUser } from '../users/staff-user.entity';
import { AuthenticatedRequest } from './auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StaffUser => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
