export interface ClockPort {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export class SystemClock implements ClockPort {
  now(): number {
    return Date.now();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
