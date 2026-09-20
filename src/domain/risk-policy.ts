import {
  ANONYMOUS_REVIEW_WINDOW_MIN,
  ESCALATION_CHAIN,
  RiskIndicator,
  RiskLevel,
  TAKEOVER_WINDOWS_MIN,
} from './enums';

export interface SceneSafety {
  /** 学生此刻是否处于即时危险中（记录者的现场判断，仍属待核实信息） */
  dangerNow: boolean;
  /** 学生当前是否在安全地点、有成人照看 */
  safeLocation: boolean;
  /** 现场安全情况的客观描述 */
  narrative: string;
}

export interface RiskDecision {
  level: RiskLevel;
  /** 接管截止时间（距提交的分钟数）；匿名咨询为阅看期限 */
  dueInMinutes: number;
  /** 依据风险规则即可见的角色（need-to-know） */
  visibleRoles: string[];
  /** 规则命中说明，便于责任视图展示「为什么这个角色能看到」 */
  reasons: string[];
}

/**
 * 风险规则：只根据记录者观察到的信号确定「操作时限与可见范围」，
 * 不推断伤害是否发生，也不对学生或家庭成员下任何结论。
 */
export function evaluateRisk(
  kind: 'named_report' | 'anonymous_consultation',
  indicators: RiskIndicator[],
  scene: SceneSafety,
): RiskDecision {
  // 匿名咨询：身份未识别，不启动接管时钟与升级链
  if (kind === 'anonymous_consultation') {
    return {
      level: 'standard',
      dueInMinutes: ANONYMOUS_REVIEW_WINDOW_MIN,
      visibleRoles: ['safeguarding_lead'],
      reasons: ['匿名咨询：仅保护负责人可见，限 7 日内阅看，不启动接管升级'],
    };
  }

  const set = new Set(indicators);
  let level: RiskLevel;
  const reasons: string[] = [];

  if (set.has('imminent_danger') || scene.dangerNow) {
    level = 'emergency';
    reasons.push('命中即时危险信号：30 分钟内接管，副保护负责人同步可见以备援');
  } else if (
    set.has('disclosure_of_harm') ||
    set.has('injury_observed') ||
    set.has('fear_of_person_at_home')
  ) {
    level = 'urgent';
    reasons.push('命中需尽快查明的风险信号：4 小时内接管，仅保护负责人可见');
  } else {
    level = 'standard';
    reasons.push('暂无更高风险信号：24 小时内接管，仅保护负责人可见');
  }

  // 紧急时副保护负责人一开始即拥有可见性，但首位接管责任人仍是保护负责人
  const visibleRoles =
    level === 'emergency'
      ? ['safeguarding_lead', 'deputy_safeguarding_lead']
      : ['safeguarding_lead'];

  return { level, dueInMinutes: TAKEOVER_WINDOWS_MIN[level], visibleRoles, reasons };
}

/** 升级链中下一个可见/接管角色；已到校长则返回 null（系统只标记，不再自动外发） */
export function nextEscalationRole(currentLevel: number): string | null {
  return ESCALATION_CHAIN[currentLevel + 1] ?? null;
}
