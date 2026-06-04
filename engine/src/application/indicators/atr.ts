/**
 * Average True Range (Wilder smoothing)
 */
export class ATR {
  private atr: number | null = null;
  private prevClose: number | null = null;
  private readonly trValues: number[] = [];
  private count = 0;

  constructor(readonly period: number) {}

  update(high: number, low: number, close: number): number | null {
    const tr = this.trueRange(high, low, this.prevClose);
    this.prevClose = close;
    this.count++;

    if (this.count <= this.period) {
      this.trValues.push(tr);
      if (this.count === this.period) {
        this.atr = this.trValues.reduce((s, v) => s + v, 0) / this.period;
      }
      return this.atr;
    }

    // Wilder smoothing
    this.atr = (this.atr! * (this.period - 1) + tr) / this.period;
    return this.atr;
  }

  get current(): number | null {
    return this.atr;
  }

  private trueRange(high: number, low: number, prevClose: number | null): number {
    if (prevClose === null) return high - low;
    return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }

  reset(): void {
    this.atr = null;
    this.prevClose = null;
    this.trValues.length = 0;
    this.count = 0;
  }
}
