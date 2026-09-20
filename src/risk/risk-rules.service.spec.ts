import { StaffRole } from '../common/roles';
import { ReportMode, RiskLevel } from '../concerns/concern.entity';
import { RiskRulesService } from './risk-rules.service';

describe('RiskRulesService（风险规则：只定处置参数，不下结论）', () => {
  const service = new RiskRulesService();

  it('现场即时危险 → critical，15 分钟接管，负责人与高级负责人可见', () => {
    const d = service.evaluate({
      immediateDanger: true,
      verbatimWords: '我不想回家',
      sceneSafety: '学生情绪激动',
      reportMode: ReportMode.NamedReport,
    });
    expect(d.riskLevel).toBe(RiskLevel.Critical);
    expect(d.takeoverMinutes).toBe(15);
    expect(d.visibleRoles).toEqual([
      StaffRole.SafeguardingLead,
      StaffRole.SeniorLead,
    ]);
  });

  it('原话含紧迫措辞 → high，60 分钟接管', () => {
    const d = service.evaluate({
      immediateDanger: false,
      verbatimWords: '我不想回家，家里有人打我',
      sceneSafety: '现场平静',
      reportMode: ReportMode.NamedReport,
    });
    expect(d.riskLevel).toBe(RiskLevel.High);
    expect(d.takeoverMinutes).toBe(60);
    expect(d.visibleRoles).toEqual([StaffRole.SafeguardingLead]);
  });

  it('常规实名报告 → standard，24 小时', () => {
    const d = service.evaluate({
      immediateDanger: false,
      verbatimWords: '今天不想参加活动',
      sceneSafety: '无异常',
      reportMode: ReportMode.NamedReport,
    });
    expect(d.riskLevel).toBe(RiskLevel.Standard);
    expect(d.takeoverMinutes).toBe(24 * 60);
  });

  it('匿名咨询即使标记即时危险，可见范围也收窄为保护负责人', () => {
    const d = service.evaluate({
      immediateDanger: true,
      verbatimWords: '不想回家',
      sceneSafety: '无',
      reportMode: ReportMode.AnonymousConsultation,
    });
    expect(d.visibleRoles).toEqual([StaffRole.SafeguardingLead]);
  });

  it('规则输出只含处置参数，不包含对学生或家庭的任何结论', () => {
    const d = service.evaluate({
      immediateDanger: true,
      verbatimWords: '不想回家',
      sceneSafety: '无',
      reportMode: ReportMode.NamedReport,
    });
    expect(Object.keys(d).sort()).toEqual([
      'appliedRules',
      'riskLevel',
      'takeoverMinutes',
      'visibleRoles',
    ]);
    // 每条规则说明只描述处置决定，不做事实认定
    for (const rule of d.appliedRules) {
      expect(rule).toMatch(/→/);
      expect(rule).not.toMatch(/认定|确诊|虐待属实|家庭问题/);
    }
  });
});
