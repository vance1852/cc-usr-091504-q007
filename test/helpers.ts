import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { ClockService } from '../src/domain/clock.service';

export const STAFF = {
  dsl: 'dsl-001',
  deputy: 'dsl-002',
  head: 'head-001',
  teacher1: 't-001', // c-1，首例记录者
  teacher2: 't-002', // c-2，跨班
  teacher3: 't-003', // c-3，无关普通老师
};

export interface Harness {
  app: INestApplication;
  clock: ClockService;
  http: () => any;
}

export async function buildApp(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'safeguard-'));
  process.env.SAFEGUARD_DB_PATH = join(dir, 'test.sqlite');
  process.env.SAFEGUARD_DISABLE_SCHEDULER = '1';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return { app, clock: app.get(ClockService), http: () => app.getHttpServer() };
}

export function call(
  harness: Harness,
  staffId: string,
  method: 'post' | 'get',
  url: string,
  body?: object,
) {
  const req = request(harness.http())[method](url).set('x-staff-id', staffId);
  return method === 'post' && body !== undefined ? req.send(body) : req;
}

export function baseNamedReport(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'named_report',
    studentId: 'stu-77',
    studentPseudonym: '小安',
    classId: 'c-1',
    verbatim: '我不想回家。',
    indicators: ['unwilling_to_go_home'],
    sceneSafety: { dangerNow: false, safeLocation: true, narrative: '学生在活动教室，情绪低落但身体未见明显异常。' },
    minimalAction: '陪同学生留在有其他成人在场的教室，未让其独自离校。',
    reporterContact: '周老师分机 801',
    ...overrides,
  };
}

export function baseAnonymousConsultation(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'anonymous_consultation',
    studentPseudonym: '一名不愿留名的学生',
    verbatim: '听说有同学最近不敢回家。',
    indicators: ['other'],
    sceneSafety: { dangerNow: false, safeLocation: true, narrative: '咨询者通过活动后纸条留言，无法确认身份。' },
    minimalAction: '未采取进一步行动，先提交保护负责人阅看。',
    ...overrides,
  };
}
