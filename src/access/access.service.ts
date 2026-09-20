import { Injectable } from '@nestjs/common';
import { Database } from '../db/database';

export interface StaffUser {
  id: string;
  name: string;
  role: string;
  classId: string | null;
}

interface ConcernRow {
  id: string;
  reporter_id: string;
  merged_into: string | null;
}

export type ViewProfile = 'investigation' | 'reporter' | 'action' | 'disclosure';

export interface ConcernView {
  profile: ViewProfile;
  /** disclosure 视图下允许看到的字段（最小必要） */
  allowedFields?: string[];
}

/**
 * 访问控制：
 * - investigation：保护负责人等经规则/升级授权的角色，可见调查细节
 * - reporter：记录者本人，仅见自己提交的内容与接管状态
 * - action：被指派最小必要动作的普通老师，只见动作与执行上下文
 * - disclosure：经单次披露授权的人员，仅见披露字段
 */
@Injectable()
export class AccessService {
  constructor(private readonly database: Database) {}

  /** 若关切已被合并，沿链解析到存活关切 */
  resolve(concernId: string): ConcernRow | undefined {
    let current = this.get(concernId);
    const seen = new Set<string>();
    while (current && current.merged_into && !seen.has(current.id)) {
      seen.add(current.id);
      current = this.get(current.merged_into);
    }
    return current;
  }

  private get(id: string): ConcernRow | undefined {
    return this.database.db
      .prepare('SELECT id, reporter_id, merged_into FROM concerns WHERE id = ?')
      .get(id) as ConcernRow | undefined;
  }

  viewFor(staff: StaffUser, concernId: string): ConcernView | null {
    // 沿合并链解析；链上任一线索的记录者，对存活关切保有记录者视图
    const raw = this.get(concernId);
    if (!raw) return null;
    let current = raw;
    const seen = new Set<string>();
    let isChainReporter = current.reporter_id === staff.id;
    while (current.merged_into && !seen.has(current.id)) {
      seen.add(current.id);
      current = this.get(current.merged_into)!;
      if (current.reporter_id === staff.id) isChainReporter = true;
    }
    const concern = current;

    if (isChainReporter) {
      return { profile: 'reporter' };
    }

    // 经风险规则或逐级升级获得授权的角色 → 调查视图
    const privileged = this.database.db
      .prepare(
        `SELECT 1 FROM access_grants
         WHERE concern_id = ? AND via IN ('policy', 'escalation')
           AND (staff_id = ? OR role = ?) LIMIT 1`,
      )
      .get(concern.id, staff.id, staff.role);
    if (privileged) {
      return { profile: 'investigation' };
    }

    // 被指派最小必要动作 → 动作视图（不含调查细节）
    const assignment = this.database.db
      .prepare(
        `SELECT 1 FROM assignments
         WHERE concern_id = ? AND assignee_id = ? AND status != 'cancelled' LIMIT 1`,
      )
      .get(concern.id, staff.id);
    if (assignment) {
      return { profile: 'action' };
    }

    // 经单次披露 → 仅可见当次披露字段
    const disclosure = this.database.db
      .prepare(
        `SELECT disclosed_fields FROM disclosures
         WHERE concern_id = ? AND recipient_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(concern.id, staff.id) as { disclosed_fields: string } | undefined;
    if (disclosure) {
      const fields = JSON.parse(disclosure.disclosed_fields) as string[];
      return { profile: 'disclosure', allowedFields: fields };
    }

    return null;
  }

  /** 某教职员可见（未合并）关切 id 及视图级别列表 */
  visibleConcerns(staff: StaffUser): Array<{ id: string; view: ConcernView }> {
    const rows = this.database.db
      .prepare(
        `SELECT id, reporter_id FROM concerns WHERE merged_into IS NULL`,
      )
      .all() as Array<{ id: string; reporter_id: string }>;
    const out: Array<{ id: string; view: ConcernView }> = [];
    for (const row of rows) {
      const view = this.viewFor(staff, row.id);
      if (view) out.push({ id: row.id, view });
    }
    return out;
  }

  isDslRole(role: string): boolean {
    return role === 'safeguarding_lead' || role === 'deputy_safeguarding_lead';
  }
}
