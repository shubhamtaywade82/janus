/**
 * Wilder's RSI (online, uses Wilder smoothing = EMA with alpha = 1/period)
 */
export class RSI {
  private avgGain: number | null = null;
  private avgLoss: number | null = null;
  private prevClose: number | null = null;
  private count = 0;
  private readonly gains: number[] = [];
  private readonly losses: number[] = [];

  constructor(readonly period: number) {}

  update(close: number): number | null {
    if (this.prevClose === null) {
      this.prevClose = close;
      return null;
    }

    const change = close - this.prevClose;
    this.prevClose = close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (this.count < this.period) {
      this.gains.push(gain);
      this.losses.push(loss);
      this.count++;

      if (this.count === this.period) {
        this.avgGain = this.gains.reduce((s, v) => s + v, 0) / this.period;
        this.avgLoss = this.losses.reduce((s, v) => s + v, 0) / this.period;
      }
      return null;
    }

    // Wilder smoothing
    this.avgGain = (this.avgGain! * (this.period - 1) + gain) / this.period;
    this.avgLoss = (this.avgLoss! * (this.period - 1) + loss) / this.period;
    this.count++;

    if (this.avgLoss === 0) return 100;
    const rs = this.avgGain! / this.avgLoss!;
    return 100 - 100 / (1 + rs);
  }

  get current(): number | null {
    if (this.avgGain === null || this.avgLoss === null) return null;
    if (this.avgLoss === 0) return 100;
    const rs = this.avgGain / this.avgLoss;
    return 100 - 100 / (1 + rs);
  }

  seed(closes: number[]): void {
    for (const c of closes) this.update(c);
  }

  reset(): void {
    this.avgGain = null;
    this.avgLoss = null;
    this.prevClose = null;
    this.count = 0;
    this.gains.length = 0;
    this.losses.length = 0;
  }
}

export function isOverbought(rsi: number, threshold = 70): boolean {
  return rsi >= threshold;
}

export function isOversold(rsi: number, threshold = 30): boolean {
  return rsi <= threshold;
}
