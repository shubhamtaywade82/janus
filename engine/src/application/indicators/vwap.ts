/**
 * VWAP — Volume Weighted Average Price
 * Resets at session open (midnight UTC by default).
 */
export class VWAP {
  private cumulativePV = 0;
  private cumulativeVolume = 0;
  private sessionStart = 0;

  constructor(private readonly sessionDurationMs = 24 * 60 * 60 * 1000) {
    this.resetSession();
  }

  update(price: number, volume: number, ts = Date.now()): number {
    if (ts - this.sessionStart >= this.sessionDurationMs) {
      this.resetSession(ts);
    }
    this.cumulativePV += price * volume;
    this.cumulativeVolume += volume;
    return this.current;
  }

  get current(): number {
    if (this.cumulativeVolume === 0) return 0;
    return this.cumulativePV / this.cumulativeVolume;
  }

  private resetSession(ts = Date.now()): void {
    const msPerDay = this.sessionDurationMs;
    this.sessionStart = Math.floor(ts / msPerDay) * msPerDay;
    this.cumulativePV = 0;
    this.cumulativeVolume = 0;
  }

  reset(): void {
    this.cumulativePV = 0;
    this.cumulativeVolume = 0;
  }
}
