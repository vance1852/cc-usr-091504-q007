import { Injectable } from '@nestjs/common';
import { StaffRole } from '../common/roles';
import { StaffUser } from '../users/staff-user.entity';
import { Concern, ReportMode } from '../concerns/concern.entity';
import { TimelineEntry, TimelineKind } from '../concerns/timeline-entry.entity';

/** 调用者相对某条关切的视角 */
export enum ViewLevel {
  /** 记录者本人：只看自己提交的内容与必须执行的动作 */
  Reporter = 'reporter',
  /** 保护链路（负责人/高级负责人）：完整视图 */
  Chain = 'chain',
  /** 被转交的专业人员：仅转交范围内的信息 */
  Assignee = 'assignee',
}

/**
 * 访问裁剪：同一关切按角色输出不同视图，
 * 匿名咨询屏蔽记录者身份，普通活动老师不接触调查细节。
 */
@Injectable()
export class AccessControlService {
  /** 记录者视图：自己提交的事实 + 状态 + 指派给自己的动作 */
  reporterView(
    concern: Concern,
    ownEntries: TimelineEntry[],
    actionRequests: TimelineEntry[],
    contact: { provided: boolean; withdrawn: boolean },
  ) {
    return {
      level: ViewLevel.Reporter,
      id: concern.id,
      reference: concern.reference,
      status: concern.status,
      reportMode: concern.reportMode,
      riskLevel: concern.riskLevel,
      studentRef: concern.studentRef,
      classCode: concern.classCode,
      verbatimWords: concern.verbatimWords,
      occurredAt: concern.occurredAt,
      sceneSafety: concern.sceneSafety,
      immediateDanger: concern.immediateDanger,
      minimalActionsTaken: concern.minimalActionsTaken,
      createdAt: concern.createdAt,
      mySupplements: ownEntries.map((e) => this.publicEntry(e)),
      requiredActions: actionRequests.map((e) => ({
        id: e.id,
        body: e.body,
        createdAt: e.createdAt,
        completedAt: e.completedAt,
      })),
      contact,
    };
  }

  /** 保护链路视图：完整信息；匿名咨询屏蔽记录者身份 */
  chainView(
    concern: Concern,
    reporterName: string | null,
    timeline: TimelineEntry[],
    contact: { provided: boolean; withdrawn: boolean },
  ) {
    const anonymous = concern.reportMode === ReportMode.AnonymousConsultation;
    return {
      level: ViewLevel.Chain,
      id: concern.id,
      reference: concern.reference,
      status: concern.status,
      reportMode: concern.reportMode,
      riskLevel: concern.riskLevel,
      takeoverDueAt: concern.takeoverDueAt,
      visibleRoles: concern.visibleRoles,
      reporter: anonymous
        ? { masked: true as const, note: '匿名咨询：记录者身份已屏蔽' }
        : { masked: false as const, id: concern.reporterId, name: reporterName },
      studentRef: concern.studentRef,
      classCode: concern.classCode,
      verbatimWords: concern.verbatimWords,
      occurredAt: concern.occurredAt,
      sceneSafety: concern.sceneSafety,
      immediateDanger: concern.immediateDanger,
      minimalActionsTaken: concern.minimalActionsTaken,
      duplicateOfId: concern.duplicateOfId,
      mergedIntoId: concern.mergedIntoId,
      createdAt: concern.createdAt,
      timeline: timeline.map((e) => this.chainEntry(e)),
      contact,
    };
  }

  /** 专业人员视图：只知道转交给自己的内容与责任 */
  assigneeView(
    concern: Concern,
    transfer: { contentScope: string; responsibility: string },
  ) {
    return {
      level: ViewLevel.Assignee,
      id: concern.id,
      reference: concern.reference,
      status: concern.status,
      riskLevel: concern.riskLevel,
      classCode: concern.classCode,
      transfer,
    };
  }

  /** 时间线条目是否对该角色可见 */
  entryVisibleTo(entry: TimelineEntry, user: StaffUser, concern: Concern): boolean {
    if (user.role === StaffRole.SafeguardingLead || user.role === StaffRole.SeniorLead) {
      return true;
    }
    if (user.id === concern.reporterId) {
      // 记录者：自己写的 + 指派给自己的动作
      return entry.authorId === user.id || entry.addressedToId === user.id;
    }
    // 其他活动老师/专业人员：不接触调查细节
    return entry.kind !== TimelineKind.Note && entry.authorId === user.id;
  }

  private publicEntry(e: TimelineEntry) {
    return {
      id: e.id,
      kind: e.kind,
      body: e.body,
      verificationStatus: e.verificationStatus,
      createdAt: e.createdAt,
    };
  }

  private chainEntry(e: TimelineEntry) {
    return {
      id: e.id,
      concernId: e.concernId,
      kind: e.kind,
      body: e.body,
      authorId: e.authorId,
      verificationStatus: e.verificationStatus,
      verifiedById: e.verifiedById,
      verifiedAt: e.verifiedAt,
      addressedToId: e.addressedToId,
      completedAt: e.completedAt,
      createdAt: e.createdAt,
    };
  }
}
