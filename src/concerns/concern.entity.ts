import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 报告方式：匿名咨询与实名报告适用不同访问范围 */
export enum ReportMode {
  AnonymousConsultation = 'anonymous_consultation',
  NamedReport = 'named_report',
}

export enum RiskLevel {
  Low = 'low',
  Standard = 'standard',
  High = 'high',
  Critical = 'critical',
}

export enum ConcernStatus {
  AwaitingTakeover = 'awaiting_takeover',
  TakenOver = 'taken_over',
  Closed = 'closed',
}

/**
 * 一条保护性关切。只记录原始事实与处置参数，
 * 系统不对学生或家庭下任何结论。
 */
@Entity('concerns')
export class Concern {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 对外引用编号，如 SC-0001 */
  @Column({ unique: true })
  reference: string;

  /** 记录者（系统内部始终可知，匿名模式下对他人屏蔽） */
  @Column()
  @Index()
  reporterId: string;

  @Column({ type: 'varchar' })
  reportMode: ReportMode;

  /** 学生的化名/内部编号，避免在传播中暴露身份 */
  @Column()
  @Index()
  studentRef: string;

  @Column()
  classCode: string;

  /** 学生原话（逐字记录，不加转述） */
  @Column({ type: 'text' })
  verbatimWords: string;

  /** 事发时间 */
  @Column()
  occurredAt: Date;

  /** 现场安全情况描述 */
  @Column({ type: 'text' })
  sceneSafety: string;

  /** 记录者判断：现场是否存在即时危险（风险规则输入之一） */
  @Column({ default: false })
  immediateDanger: boolean;

  /** 已经采取的最小措施 */
  @Column({ type: 'text' })
  minimalActionsTaken: string;

  /** 风险规则得出的等级——仅决定处置时限与可见角色 */
  @Column({ type: 'varchar' })
  riskLevel: RiskLevel;

  /** 接管截止时间 */
  @Column()
  takeoverDueAt: Date;

  /** 风险规则得出的可见角色列表 */
  @Column({ type: 'simple-json' })
  visibleRoles: string[];

  @Column({ type: 'varchar', default: ConcernStatus.AwaitingTakeover })
  @Index()
  status: ConcernStatus;

  /** 若被合并，指向主关切 */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  mergedIntoId: string | null;

  /** 自动化检测出的疑似重复报告指向 */
  @Column({ type: 'varchar', nullable: true })
  duplicateOfId: string | null;

  @Column({ type: 'datetime', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  closeReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
