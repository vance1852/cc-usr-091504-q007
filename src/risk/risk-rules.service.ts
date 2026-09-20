import { Injectable } from '@nestjs/common';
import { StaffRole } from '../common/roles';
import { ReportMode, RiskLevel } from '../concerns/concern.entity';

export interface RiskInput {
  immediateDanger: boolean;
  verbatimWords: string;
  sceneSafety: string;
  reportMode: ReportMode;
}

export interface RiskDecision {
  riskLevel: RiskLevel;
  /** 接管时限（分钟） */
  takeoverMinutes: number;
  /** 允许查看该关切详情的角色 */
  visibleRoles: StaffRole[];
  /** 命中的规则说明，供审计（不含任何对学生的判断） */
  appliedRules: string[];
}

/**
 * 保护性关切的风险规则。
 *
 * 设计红线：规则只决定"多快必须有人接管、谁可以看"，
 * 不推断学生处境、不给家庭贴标签、不生成任何结论性文字。
 */
@Injectable()
export class RiskRulesService {
  /** 提示可能存在伤害风险的措辞（仅用于提速处置，不构成事实认定） */
  private static readonly URGENCY_MARKERS = [
    '不想回家',
    '不愿回家',
    '害怕回家',
    '不敢回家',
    '打我',
    '伤害',
    '威胁',
    '不许说',
    '保密',
  ];

  evaluate(input: RiskInput): RiskDecision {
    const appliedRules: string[] = [];
    let riskLevel: RiskLevel;
    let takeoverMinutes: number;
    let visibleRoles: StaffRole[];

    const text = `${input.verbatimWords}\n${input.sceneSafety}`;
    const hitMarker = RiskRulesService.URGENCY_MARKERS.find((m) =>
      text.includes(m),
    );

    if (input.immediateDanger) {
      riskLevel = RiskLevel.Critical;
      takeoverMinutes = 15;
      visibleRoles = [StaffRole.SafeguardingLead, StaffRole.SeniorLead];
      appliedRules.push('R1: 记录者标记现场存在即时危险 → 15 分钟接管，保护负责人与高级负责人可见');
    } else if (hitMarker) {
      riskLevel = RiskLevel.High;
      takeoverMinutes = 60;
      visibleRoles = [StaffRole.SafeguardingLead];
      appliedRules.push(
        `R2: 原话/现场描述含紧迫性措辞（"${hitMarker}"）→ 60 分钟接管，保护负责人可见`,
      );
    } else if (input.reportMode === ReportMode.AnonymousConsultation) {
      riskLevel = RiskLevel.Low;
      takeoverMinutes = 72 * 60;
      visibleRoles = [StaffRole.SafeguardingLead];
      appliedRules.push('R3: 匿名咨询且无紧迫信号 → 72 小时接管，仅保护负责人可见');
    } else {
      riskLevel = RiskLevel.Standard;
      takeoverMinutes = 24 * 60;
      visibleRoles = [StaffRole.SafeguardingLead];
      appliedRules.push('R4: 常规实名报告 → 24 小时接管，保护负责人可见');
    }

    // 匿名咨询的访问范围始终收窄：即便升级时限，详情也只对保护负责人开放
    if (input.reportMode === ReportMode.AnonymousConsultation) {
      visibleRoles = [StaffRole.SafeguardingLead];
      appliedRules.push('R5: 匿名咨询 → 访问范围收窄为保护负责人');
    }

    return { riskLevel, takeoverMinutes, visibleRoles, appliedRules };
  }
}
