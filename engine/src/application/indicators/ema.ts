/**
 * Exponential Moving Average (online, O(1) per update)
 */
export class EMA {
  private value: number | null = null;
  private readonly k: number;

  constructor(readonly period: number) {
    this.k = 2 / (period + 1);
  }

  update(price: number): number {
    if (this.value === null) {
      this.value = price;
    } else {
      this.value = price * this.k + this.value * (1 - this.k);
    }
    return this.value;
  }

  get current(): number | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
  }

  /** Bulk seed from historical closes */
  seed(closes: number[]): void {
    for (const c of closes) this.update(c);
  }
}

/** Returns true when the fast EMA crossed above the slow EMA on this update */
export function emaCrossUp(fast: EMA, slow: EMA): boolean {
  return fast.current !== null && slow.current !== null && fast.current > slow.current;
}

export function emaCrossDown(fast: EMA, slow: EMA): boolean {
  return fast.current !== null && slow.current !== null && fast.current < slow.current;
}
