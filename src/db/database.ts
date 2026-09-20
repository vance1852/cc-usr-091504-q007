import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

/** 预处理语句的最小接口，屏蔽底层 SQLite 驱动差异 */
export interface Statement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * SQLite 连接封装（基于 Node 22 内置 node:sqlite）：
 * 提供与 better-sqlite3 一致的 prepare/exec/transaction 同步接口。
 */
export class SqliteDb {
  private readonly inner: DatabaseSync;

  constructor(filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.inner = new DatabaseSync(filename);
  }

  pragma(directive: string) {
    this.inner.exec(`PRAGMA ${directive}`);
  }

  exec(sql: string) {
    this.inner.exec(sql);
  }

  prepare(sql: string): Statement {
    const stmt = this.inner.prepare(sql);
    return {
      run: (...params: unknown[]) => stmt.run(...(params as any[])),
      get: (...params: unknown[]) => stmt.get(...(params as any[])),
      all: (...params: unknown[]) => stmt.all(...(params as any[])) as unknown[],
    };
  }

  transaction<T extends (...args: any[]) => unknown>(fn: T): T {
    return ((...args: Parameters<T>) => {
      this.inner.exec('BEGIN');
      try {
        const result = fn(...args);
        this.inner.exec('COMMIT');
        return result;
      } catch (err) {
        this.inner.exec('ROLLBACK');
        throw err;
      }
    }) as T;
  }

  close() {
    this.inner.close();
  }
}

/**
 * SQLite 持久层。
 * 所有访问控制结论都落在 access_grants 上（角色授权 / 升级授权 / 指派 / 披露），
 * 使「谁因为什么理由能看到哪条关切」可审计。
 */
@Injectable()
export class Database implements OnModuleDestroy {
  readonly db: SqliteDb;

  constructor() {
    const dbPath = process.env.SAFEGUARD_DB_PATH || path.join(process.cwd(), 'data', 'safeguarding.sqlite');
    const db = new SqliteDb(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    this.db = db;
    this.init();
    this.seed();
  }

  onModuleDestroy() {
    this.db.close();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS staff (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,            -- safeguarding_lead | deputy_safeguarding_lead | headteacher | activity_teacher
        class_id TEXT
      );

      CREATE TABLE IF NOT EXISTS concerns (
        id TEXT PRIMARY KEY,
        ref TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,            -- named_report | anonymous_consultation
        status TEXT NOT NULL,          -- open | taken_over | referred_out | closed
        risk_level TEXT NOT NULL,
        student_id TEXT,               -- 匿名咨询时为 NULL（身份未识别）
        student_pseudonym TEXT,
        class_id TEXT,
        reporter_id TEXT NOT NULL REFERENCES staff(id),
        reporter_contact TEXT,         -- 记录者联系方式，可被撤回（撤回后抹除，仅留墓碑标记）
        contact_retracted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        takeover_due_at INTEGER,       -- 实名报告：当前接管人截止时间
        review_due_at INTEGER,         -- 匿名咨询：阅看期限
        current_owner_id TEXT REFERENCES staff(id),
        takeover_ack_at INTEGER,
        escalation_level INTEGER NOT NULL DEFAULT 0,
        merged_into TEXT REFERENCES concerns(id),
        risk_reasons TEXT NOT NULL,    -- JSON：规则命中说明
        closure_summary TEXT
      );

      CREATE TABLE IF NOT EXISTS timeline (
        id TEXT PRIMARY KEY,
        concern_id TEXT NOT NULL REFERENCES concerns(id),
        origin_concern_id TEXT NOT NULL REFERENCES concerns(id), -- 合并后保留事实来源线索
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor_id TEXT REFERENCES staff(id),
        created_at INTEGER NOT NULL,
        verbatim TEXT,                 -- 学生/原话，逐字记录
        quote_occurred_at INTEGER,     -- 学生讲话发生时间（区别于记录提交时间）
        indicators TEXT,               -- JSON：记录者勾选的观察信号
        scene_safety TEXT,             -- JSON：现场安全情况
        minimal_action TEXT,           -- 已经采取的最小措施
        body TEXT,                     -- 通用说明文本
        verification_state TEXT NOT NULL DEFAULT 'unverified', -- unverified | verified | refuted
        metadata TEXT NOT NULL DEFAULT '{}' -- JSON
      );

      CREATE TABLE IF NOT EXISTS access_grants (
        id TEXT PRIMARY KEY,
        concern_id TEXT NOT NULL REFERENCES concerns(id),
        staff_id TEXT REFERENCES staff(id),
        role TEXT,                     -- 按角色授权（该角色全体成员可见）
        via TEXT NOT NULL,             -- policy | escalation | assignment | disclosure
        reason TEXT NOT NULL,
        granted_by TEXT REFERENCES staff(id),
        created_at INTEGER NOT NULL,
        UNIQUE (concern_id, staff_id, role, via)
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        concern_id TEXT NOT NULL REFERENCES concerns(id),
        type TEXT NOT NULL,            -- take_over | review | follow_up
        assignee_id TEXT NOT NULL REFERENCES staff(id),
        description TEXT NOT NULL,
        context TEXT,                  -- 执行动作所必需的最小上下文（不含调查细节）
        status TEXT NOT NULL,          -- pending | acknowledged | done | escalated | cancelled
        assigned_by TEXT REFERENCES staff(id),
        created_at INTEGER NOT NULL,
        due_at INTEGER,
        ack_at INTEGER,
        done_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS referrals (
        id TEXT PRIMARY KEY,
        concern_id TEXT NOT NULL REFERENCES concerns(id),
        external_org TEXT NOT NULL,
        external_role TEXT NOT NULL,
        external_contact TEXT,         -- 若记录者已撤回联系方式，禁止写入其个人联系信息
        scope_summary TEXT NOT NULL,   -- 移交内容（哪些记录/事实）
        responsibility TEXT NOT NULL,  -- 移交责任（对方承担什么、本方保留什么）
        status TEXT NOT NULL,          -- pending | accepted | declined
        referred_by TEXT NOT NULL REFERENCES staff(id),
        created_at INTEGER NOT NULL,
        accepted_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS disclosures (
        id TEXT PRIMARY KEY,
        concern_id TEXT NOT NULL REFERENCES concerns(id),
        recipient_id TEXT REFERENCES staff(id),
        recipient_name TEXT NOT NULL,
        recipient_role TEXT NOT NULL,
        reason TEXT NOT NULL,
        disclosed_fields TEXT NOT NULL, -- JSON：实际披露的字段
        disclosed_by TEXT NOT NULL REFERENCES staff(id),
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS merges (
        id TEXT PRIMARY KEY,
        surviving_concern_id TEXT NOT NULL REFERENCES concerns(id),
        merged_concern_id TEXT NOT NULL REFERENCES concerns(id),
        reason TEXT NOT NULL,
        merged_by TEXT NOT NULL REFERENCES staff(id),
        created_at INTEGER NOT NULL,
        undone_at INTEGER,
        undo_reason TEXT,
        undone_by TEXT REFERENCES staff(id)
      );
    `);
  }

  private seed() {
    const count = this.db.prepare('SELECT COUNT(*) AS c FROM staff').get() as { c: number };
    if (count.c > 0) return;
    const insert = this.db.prepare('INSERT INTO staff (id, name, role, class_id) VALUES (?, ?, ?, ?)');
    const staff: Array<[string, string, string, string | null]> = [
      ['dsl-001', '林主任', 'safeguarding_lead', null],
      ['dsl-002', '陈副主任', 'deputy_safeguarding_lead', null],
      ['head-001', '王校长', 'headteacher', null],
      ['t-001', '周老师（课后活动导师）', 'activity_teacher', 'c-1'],
      ['t-002', '吴老师（跨班活动导师）', 'activity_teacher', 'c-2'],
      ['t-003', '郑老师（普通活动老师）', 'activity_teacher', 'c-3'],
    ];
    const tx = this.db.transaction(() => staff.forEach((s) => insert.run(...s)));
    tx();
  }
}
