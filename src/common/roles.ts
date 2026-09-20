/**
 * 教职员工角色。访问范围、接管链路与升级顺序都以此为基础。
 */
export enum StaffRole {
  /** 课后活动导师：只能提交关切、查看自己的提交与必须执行的动作 */
  ActivityMentor = 'activity_mentor',
  /** 学校保护负责人（DSL）：第一级接管人，可合并/拆分线索 */
  SafeguardingLead = 'safeguarding_lead',
  /** 高级负责人（如校长）：升级链第二级 */
  SeniorLead = 'senior_lead',
  /** 外部/驻校专业人员（如驻校社工）：转交对象或升级链末级 */
  ExternalProfessional = 'external_professional',
}

/** 升级链：超时未接管时逐级升级的角色顺序 */
export const ESCALATION_CHAIN: StaffRole[] = [
  StaffRole.SafeguardingLead,
  StaffRole.SeniorLead,
  StaffRole.ExternalProfessional,
];

export const ROLE_LABELS: Record<StaffRole, string> = {
  [StaffRole.ActivityMentor]: '课后活动导师',
  [StaffRole.SafeguardingLead]: '保护负责人',
  [StaffRole.SeniorLead]: '高级负责人',
  [StaffRole.ExternalProfessional]: '专业人员',
};
