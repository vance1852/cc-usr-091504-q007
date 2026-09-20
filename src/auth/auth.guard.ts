import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../users/users.service';
import { StaffUser } from '../users/staff-user.entity';
import { IS_PUBLIC_KEY } from './public.decorator';

export interface AuthenticatedRequest {
  user: StaffUser;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * 演示用身份识别：通过 `x-user-id` 头定位员工账号。
 * 生产环境应替换为正式 SSO/会话机制，角色判定逻辑不变。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly users: UsersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = req.headers['x-user-id'];
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('缺少 x-user-id 请求头');
    }
    const user = await this.users.findById(userId);
    if (!user || !user.active) {
      throw new UnauthorizedException('无效或已停用的员工账号');
    }
    req.user = user;
    return true;
  }
}
