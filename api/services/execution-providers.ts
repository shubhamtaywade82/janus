/**
 * Execution providers — the only thing that differs between live and paper.
 *
 * Both implement the same interface so strategy code never needs to branch.
 *
 * Live:  delegates to CoinDCX REST API
 * Paper: simulates an immediate fill at mark price + configurable slippage
 */

import { latestTickerCache } from "./streaming";

export interface FillResult {
  orderId: string;
  avgFillPrice: number;
  filledQuantity: number;
  fee: number;
  simulated: boolean;
}

export interface OrderRequest {
  symbol: string;       // Binance format: BTCUSDT
  side: "buy" | "sell";
  quantity: number;
  leverage: number;
  limitPrice?: number;
}

// ─── Shared fee model ───
// CoinDCX taker fee ~ 0.05%
const TAKER_FEE_RATE = 0.0005;

// ─── Paper execution provider ───
// Fills immediately at mark price + small slippage (0.05% default)
export class PaperExecutionProvider {
  constructor(private slippagePct = 0.0005) {}

  fill(req: OrderRequest): FillResult {
    const ticker = latestTickerCache.get(req.symbol);
    const rawPrice = ticker?.lastPrice ? parseFloat(String(ticker.lastPrice)) : req.limitPrice ?? 0;
    if (!rawPrice) {
      throw new Error(`[PaperExecution] No mark price for ${req.symbol}`);
    }

    // Apply slippage: buy fills slightly above, sell slightly below
    const slippage = rawPrice * this.slippagePct;
    const fillPrice = req.side === "buy" ? rawPrice + slippage : rawPrice - slippage;
    const notional = fillPrice * req.quantity;
    const fee = notional * TAKER_FEE_RATE;

    return {
      orderId: `PAPER_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      avgFillPrice: fillPrice,
      filledQuantity: req.quantity,
      fee,
      simulated: true,
    };
  }
}

// ─── CoinDCX execution provider ───
// Thin wrapper — actual REST call happens in createFuturesOrder; this handles fee estimation
export class CoinDCXExecutionProvider {
  estimateFee(notional: number): number {
    return notional * TAKER_FEE_RATE;
  }
}

export const paperProvider = new PaperExecutionProvider();
export const coindcxProvider = new CoinDCXExecutionProvider();
