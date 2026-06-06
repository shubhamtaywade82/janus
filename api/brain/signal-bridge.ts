import { getDb } from "../queries/connection";
import { signals } from "@db/schema";
import { latestTickerCache } from "../services/streaming";
import { globalAutoExecutor, type ExecutorDecision } from "../services/auto-executor";

export interface ProposeTradeOpts {
  symbol: string;                 // CoinDCX form, e.g. "B-BTC_USDT"
  direction: "long" | "short";
  compositeScore?: number;        // synthetic score (default 85)
  threshold?: number;             // default 75
  source: string;                 // "manual-trigger" | "brain-driver"
  sizeUsdt?: number;              // override → bypasses risk-engine sizing
  leverage?: number;
  stopLossPct?: number;           // fraction (already /100), e.g. 0.015
  takeProfitPct?: number;         // fraction
  disableTrailing?: boolean;
  entryReason?: string;
  episodeId?: number;             // link back to the originating brain episode
  rsi?: number;
  extraMetadata?: Record<string, unknown>;
}

export interface ProposeTradeResult {
  signalId: number;
  decision?: ExecutorDecision;
}

/**
 * Bridge a trade proposal (manual injection or brain-driver) into the existing
 * execution pipeline: build a gated signal row with override metadata, insert it,
 * and run it through the auto-executor's full gate pipeline. Single source of truth
 * for both `/trigger-signal` and the autonomous brain driver — execution logic is
 * NOT duplicated here.
 */
export async function proposeTradeAsSignal(opts: ProposeTradeOpts): Promise<ProposeTradeResult> {
  const compositeScore = String(opts.compositeScore ?? 85);
  const threshold = String(opts.threshold ?? 75);
  const binanceSym = opts.symbol.replace("B-", "").replace("_", "");
  const currentPrice = latestTickerCache.get(binanceSym)?.lastPrice ?? 0;

  const db = getDb();
  const [insertedSignal] = await db
    .insert(signals)
    .values({
      symbol: opts.symbol,
      microScore: compositeScore,
      intraScore: compositeScore,
      swingScore: compositeScore,
      compositeScore,
      threshold,
      isGated: true,
      direction: opts.direction,
      metadata: {
        rsi: opts.rsi ?? 50,
        ema20: currentPrice * 0.998,
        ema50: currentPrice * 0.995,
        spread: 0.0002,
        imbalance: 0.3,
        source: opts.source,
        sizeUsdt: opts.sizeUsdt,
        leverage: opts.leverage,
        stopLossPct: opts.stopLossPct,
        takeProfitPct: opts.takeProfitPct,
        disableTrailing: opts.disableTrailing === true,
        entryReason: opts.entryReason,
        episodeId: opts.episodeId,
        ...(opts.extraMetadata ?? {}),
      },
    })
    .returning();

  const decisions = await globalAutoExecutor.onSignalBatch([insertedSignal]);
  return { signalId: insertedSignal.id, decision: decisions[0] };
}
