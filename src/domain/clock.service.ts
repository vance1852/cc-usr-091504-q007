import { Injectable } from '@nestjs/common';

/** 可在测试中拨动的时钟，用于确定性地验证超时升级 */
@Injectable()
export class ClockService {
  private offsetMs = 0;

  now(): number {
    return Date.now() + this.offsetMs;
  }

  advance(ms: number) {
    this.offsetMs += ms;
  }
}
