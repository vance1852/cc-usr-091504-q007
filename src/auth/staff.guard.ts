import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Database } from '../db/database';

interface StaffRow {
  id: string;
  name: string;
  role: string;
  class_id: string | null;
}

/**
 * 极简身份认证：请求头 x-staff-id 对应当前操作教职员。
 * 真实部署应替换为学校 SSO / JWT；访问控制模型本身不依赖具体认证方式。
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly database: Database) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const staffId = req.headers['x-staff-id'] as string | undefined;
    if (!staffId) {
      throw new UnauthorizedException('缺少 x-staff-id 请求头');
    }
    const staff = this.database.db
      .prepare('SELECT id, name, role, class_id FROM staff WHERE id = ?')
      .get(staffId) as StaffRow | undefined;
    if (!staff) {
      throw new UnauthorizedException('教职员身份不存在');
    }
    req.staff = {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      classId: staff.class_id,
    };
    return true;
  }
}
