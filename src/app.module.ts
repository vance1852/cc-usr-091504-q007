import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

export function buildTypeOrmOptions(): TypeOrmModuleOptions {
  if (process.env.SQLITE_IN_MEMORY === '1') {
    // 测试：纯内存 sql.js，不落盘
    return { type: 'sqljs', autoLoadEntities: true, synchronize: true };
  }
  return {
    type: 'sqljs',
    location:
      process.env.SQLITE_PATH ??
      join(process.cwd(), 'data', 'safeguarding.sqlite'),
    autoSave: true, // 每次提交写回 SQLite 文件
    autoLoadEntities: true,
    synchronize: true, // 演示环境自动建表；生产应改为迁移
  };
}
import { AccessModule } from './access/access.module';
import { AppController } from './app.controller';
import { AuthGuard } from './auth/auth.guard';
import { ConcernsModule } from './concerns/concerns.module';
import { DisclosuresModule } from './disclosures/disclosures.module';
import { MergesModule } from './merges/merges.module';
import { RiskModule } from './risk/risk.module';
import { TakeoverModule } from './takeover/takeover.module';
import { TransfersModule } from './transfers/transfers.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmOptions()),
    ScheduleModule.forRoot(),
    AccessModule,
    ConcernsModule,
    DisclosuresModule,
    MergesModule,
    RiskModule,
    TakeoverModule,
    TransfersModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
