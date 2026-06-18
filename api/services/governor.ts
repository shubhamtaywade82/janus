/**
 * Governor — Deterministic Safety Gatekeeper
 *
 * Extracted from AutoExecutor to create a clean insertion point for the Brain.
 * All hard safety gates live here. The Brain will later sit between
 * Governor and Executor.
 *
 * Flow:
 *   Signal → Governor.evaluate() → if approved → Executor.execute()
 *                                    ↓
 *                              Brain.evaluate() (shadow mode)
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { positions, type Signal, type AutoExecutorConfig } from "@db/schema";
import { globalKillSwitch } from "./kill-switch";
import { isFundingExtreme } from "./funding-filter";
import { checkCorrelation } from "./correlation-guard";
import { globalRiskEngine, type RiskSession } from "./risk-engine";
import { knnSnapshotCache } from "./knn-supertrend";
import { walletToUsdt } from "./paper-currency";

export interface GovernorContext {
  signal: Signal;
  config: AutoExecutorConfig;
  targetSymbols: string[];
  dedupWindowMs: number;
  recentExecutions: Map<string, number>;
  openCount: number;
  isPaperMode: boolean;
  walletFree: number;
  walletLocked: number;
  session: RiskSession;
}

export interface GovernorOutcome {
  approved: boolean;
  gate: string;
  reason: string;
  adjusted?: {
    sizeUsdt?: number;
    leverage?: number;
    stopLossPct?: number;
    takeProfitPct?: number;
  };
}

export class Governor {
  async evaluate(ctx: GovernorContext): Promise<GovernorOutcome> {
    const { signal, config, targetSymbols, dedupWindowMs, recentExecutions, openCount, isPaperMode, walletFree, walletLocked, session } = ctx;

    const symbol = signal.symbol.startsWith("B-")
      ? signal.symbol.slice(2).replace("_USDT", "USDT").replace("_", "")
      : signal.symbol;
    const side = signal.direction as "long" | "short";
    const metadata = signal.metadata as Record<string, unknown> | null;

    // Gate 1: symbol in target list
    if (!targetSymbols.includes(symbol)) {
      return { approved: false, gate: "target_list", reason: `${symbol} not in target list` };
    }

    // Gate 1b: signal staleness
    const signalAgeMs = Date.now() - new Date(signal.createdAt).getTime();
    if (signalAgeMs > 60_000) {
      return { approved: false, gate: "stale_signal", reason: `stale signal (${Math.round(signalAgeMs / 1000)}s old)` };
    }

    // Gate 1c: dedup
    const dedupKey = `${symbol}:${signal.direction}`;
    const lastExec = recentExecutions.get(dedupKey) ?? 0;
    if (Date.now() - lastExec < dedupWindowMs) {
      return {
        approved: false,
        gate: "dedup",
        reason: `dedup: same ${symbol} ${signal.direction} executed ${Math.round((Date.now() - lastExec) / 1000)}s ago`,
      };
    }

    // Gate 2: kill switch
    if (!globalKillSwitch.canTrade() && process.env.DISABLE_KILL_SWITCH !== "true") {
      return { approved: false, gate: "kill_switch", reason: "kill switch active" };
    }

    // Gate 3: duplicate open position (paper/live isolated; paper allows same-side pyramiding via PM)
    const db = getDb();
    const existing = await db
      .select({ id: positions.id, side: positions.side })
      .from(positions)
      .where(
        and(
          eq(positions.userId, 1),
          eq(positions.symbol, symbol),
          eq(positions.status, "open"),
          isPaperMode ? eq(positions.isPaper, true) : eq(positions.isPaper, false)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      if (isPaperMode && existing[0].side === side) {
        return {
          approved: false,
          gate: "duplicate_position",
          reason: "same-side paper position open — scale in via position manager",
        };
      }
      return { approved: false, gate: "duplicate_position", reason: "position already open" };
    }

    // Gate 4: max total open positions. Paper is aggressive; live uses the (conservative)
    // configured cap.
    const PAPER_MAX_POSITIONS = 10;
    const maxTotal = isPaperMode ? PAPER_MAX_POSITIONS : (config.maxTotalPositions ?? 3);
    if (openCount >= maxTotal) {
      return { approved: false, gate: "max_positions", reason: `max ${maxTotal} positions open` };
    }

    // Gate 5: funding rate filter
    const fundingCheck = isFundingExtreme(symbol, side);
    if (fundingCheck.blocked) {
      return { approved: false, gate: "funding", reason: fundingCheck.reason };
    }

    // Gate 6: correlation guard
    const corrCheck = await checkCorrelation(symbol, side, 1);
    if (!corrCheck.allowed) {
      return { approved: false, gate: "correlation", reason: corrCheck.reason };
    }

    // Gate 6b: spread filter (spreadPercent is stored as a percentage value, e.g. 2.0 = 2%)
    const spreadPct = metadata?.spreadPercent as number | undefined;
    if (spreadPct !== undefined && spreadPct > 2.0) {
      return {
        approved: false,
        gate: "spread",
        reason: `spread ${spreadPct.toFixed(3)}% > 2% — low liquidity`,
      };
    }

    // Gate 7: risk engine (wallet values normalized to USDT for sizing checks)
    const isManualOverride = metadata?.sizeUsdt !== undefined && metadata.sizeUsdt !== null;
    const sizeUsdt = isManualOverride
      ? parseFloat(String(metadata.sizeUsdt))
      : parseFloat(config.defaultSizeUsdt ?? "50");
    const paperCurrency = (config.paperCurrency as "USDT" | "INR") ?? "INR";
    const walletBalanceUsdt = isPaperMode
      ? await walletToUsdt(walletFree || session.startingBalance, paperCurrency)
      : walletFree || session.startingBalance;
    const walletLockedUsdt = isPaperMode
      ? await walletToUsdt(walletLocked, paperCurrency)
      : walletLocked;
    const allocPct = parseFloat(
      config.capitalAllocationPct ?? (isPaperMode ? "0.250" : "0.150")
    );
    const riskNotional = isManualOverride
      ? sizeUsdt
      : walletBalanceUsdt * allocPct;

    // Ensure Risk Engine's maxPositionPct is always at least equal to the configured allocPct
    // (with a tiny buffer to avoid precision/rounding issues)
    globalRiskEngine.config.maxPositionPct = Math.max(
      globalRiskEngine.config.maxPositionPct ?? 0.50,
      allocPct * 1.05
    );

    const riskCheck = globalRiskEngine.checkTradeAllowed(session, {
      notional: riskNotional,
      walletBalance: walletBalanceUsdt,
      usedMargin: walletLockedUsdt,
      isManualOverride,
    });
    if (!riskCheck.approved && process.env.DISABLE_RISK_LIMITS !== "true") {
      return { approved: false, gate: "risk", reason: `risk: ${riskCheck.reason}` };
    }

    // Gate 8: KNN SuperTrend filter
    const knnSnap = knnSnapshotCache.get(symbol);
    if (knnSnap) {
      // KNN range regime check disabled to allow entries in chop (user preference)
      // if (knnSnap.regime === "range") {
      //   return { approved: false, gate: "knn_range", reason: `KNN: range regime — signals suppressed for ${symbol}` };
      // }
      // const knnMinConf = 60;
      // const knnBias = knnSnap.knn.bias;
      // const knnConf = knnSnap.knn.confidence;
      // const biasSide = knnBias === "bullish" ? "long" : knnBias === "bearish" ? "short" : "neutral";
      // KNN bias conflict check disabled to allow entries against short-term bias (user preference)
      // if (knnBias !== "neutral" && knnConf >= knnMinConf && biasSide !== side) {
      //   return {
      //     approved: false,
      //     gate: "knn_conflict",
      //     reason: `KNN: bias=${knnBias} (${knnConf}%) conflicts with signal ${side}`,
      //   };
      // }
      // KNN low-confidence check disabled (user preference)
      // if (knnConf < 40) {
      //   return {
      //     approved: false,
      //     gate: "knn_low_conf",
      //     reason: `KNN: very low confidence (${knnConf}%) — skipping ${symbol}`,
      //   };
      // }
    }

    // All gates passed
    return { approved: true, gate: "governor_approved", reason: "all safety gates passed" };
  }
}

export const globalGovernor = new Governor();
