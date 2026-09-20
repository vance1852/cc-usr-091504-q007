/**
 * 领域枚举与常量。
 * 系统只记录「事实陈述」与「操作状态」，不对学生或家庭作任何定性结论。
 */

/** 关切种类：实名报告 / 匿名咨询 —— 两者访问范围不同 */
export type ConcernKind = 'named_report' | 'anonymous_consultation';

/** 操作层面的紧急程度，由风险规则推导，仅用于确定接管时限，不是对事实的认定 */
export type RiskLevel = 'emergency' | 'urgent' | 'standard';

export type ConcernStatus = 'open' | 'taken_over' | 'referred_out' | 'closed';

/** 风险信号：由记录者勾选其「观察到/听到」的内容，全部属于待核实事实 */
export type RiskIndicator =
  | 'unwilling_to_go_home' // 学生表示不愿回家（原因不明）
  | 'fear_of_person_at_home' // 学生表现出害怕家中某人
  | 'injury_observed' // 发现不明原因伤痕
  | 'disclosure_of_harm' // 学生述称受到伤害
  | 'imminent_danger' // 学生称回家将立即面临危险
  | 'other';

/** 时间线事件类型（同一关切的连续时间线） */
export type TimelineType =
  | 'initial_report' // 初次记录：原话、时间、现场安全、已采取的最小措施
  | 'supplement' // 补充信息
  | 'dsl_note' // 保护负责人工作备注（非事实主张）
  | 'takeover_ack' // 接管人确认收到
  | 'review_ack' // 匿名咨询阅看确认
  | 'escalation' // 超时逐级升级
  | 'referral' // 转介外部专业人员
  | 'disclosure' // 在最小必要范围内披露
  | 'merge' // 合并相关线索
  | 'unmerge' // 误合并后拆分（保留依据）
  | 'contact_retraction' // 撤回联系方式
  | 'verification' // 事实核实结论（人工）
  | 'follow_up_assigned' // 向其他教职员指派最小必要动作
  | 'closure'; // 关闭

export type VerificationState = 'unverified' | 'verified' | 'refuted';

export type ActionType = 'take_over' | 'review' | 'follow_up';
export type ActionStatus = 'pending' | 'acknowledged' | 'done' | 'escalated' | 'cancelled';

/** 升级链：保护负责人 → 副保护负责人 → 校长 */
export const ESCALATION_CHAIN = [
  'safeguarding_lead',
  'deputy_safeguarding_lead',
  'headteacher',
] as const;
export type EscalationRole = (typeof ESCALATION_CHAIN)[number];

/** 接管时限（分钟）：紧急 30 分钟 / 急件 4 小时 / 常规 24 小时 */
export const TAKEOVER_WINDOWS_MIN: Record<RiskLevel, number> = {
  emergency: 30,
  urgent: 240,
  standard: 1440,
};

/** 匿名咨询仅要求保护负责人 7 日内阅看，不触发升级 */
export const ANONYMOUS_REVIEW_WINDOW_MIN = 7 * 24 * 60;

/** 每一级超时后再给下一级的处置窗口（分钟） */
export const ESCALATION_WINDOW_MIN: Record<RiskLevel, number> = {
  emergency: 30,
  urgent: 240,
  standard: 1440,
};
