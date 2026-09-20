import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConcernsService } from './concerns.service';

/**
 * 每 60 秒扫描一次超时未接管的实名报告并逐级升级。
 * 升级状态同时落库，即使调度器重启也不丢升级记录。
 */
@Injectable()
export class EscalationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(private readonly concerns: ConcernsService) {}

  onApplicationBootstrap() {
    if (process.env.SAFEGUARD_DISABLE_SCHEDULER === '1') return;
    this.timer = setInterval(() => {
      try {
        this.concerns.tickEscalations();
      } catch (err) {
        // 升级扫描失败不能使进程崩溃；实际部署应接结构化告警
        // eslint-disable-next-line no-console
        console.error('升级扫描失败', err);
      }
    }, 60_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
