// ─── PTA Tick Sampler ─────────────────────────────────────────────────────────
// Samples mark-price ticks for open positions into trade_price_ticks.
// Best-effort: never throws; errors are logged and swallowed.

import { getDb } from "../queries/connection";
import { tradePriceTicks } from "@db/pta-schema";
import { trades } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import { positionStore } from "./position-manager/position-store";
import { markPriceCache } from "./coindcx-ws";

let started = false;
const SAMPLE_INTERVAL_MS = 10_000; // 10s per open position
const MAX_ROWS_PER_TICK = 500; // safety cap

export function startPtaTickSampler(): void {
  if (started) return;
  started = true;
  console.log("[pta-sampler] Tick sampler started (10s)");

  setInterval(() => {
    try {
      const opens = positionStore.getOpen();
      if (!opens.length) return;

      const now = new Date();
      const rows: {
        tradeId: string;
        observedAt: Date;
        markPrice: string;
        indexPrice: string | null;
        fundingRate: string | null;
        pnlPctFromEntry: string | null;
      }[] = [];

      for (let i = 0; i < opens.length && i < MAX_ROWS_PER_TICK; i++) {
        const p = opens[i];
        const mark = markPriceCache.get(p.binanceSymbol) ?? 0;
        if (!mark || mark <= 0) continue;

        const pnlPct =
          p.margin > 0
            ? ((mark - p.entryPrice) * p.quantity) / p.margin
            : 0;

        rows.push({
          tradeId: `pos-${p.id}`,
          observedAt: now,
          markPrice: String(mark),
          indexPrice: null,
          fundingRate: null,
          pnlPctFromEntry: String(pnlPct),
        });
      }

      if (!rows.length) return;

      getDb()
        .insert(tradePriceTicks)
        .values(rows)
        .catch((err) => {
          console.error("[pta-sampler] insert failed", err);
        });
    } catch (err) {
      console.error("[pta-sampler] sampling failure", err);
    }
  }, SAMPLE_INTERVAL_MS);
}

export async function backfillMfeMae(positionId: number, side: "long" | "short"): Promise<void> {
  if (!positionId) return;

  const db = getDb();
  const sourceId = `pos-${positionId}`;

  const ticks = await db
    .select({
      markPrice: tradePriceTicks.markPrice,
    })
    .from(tradePriceTicks)
    .where(eq(tradePriceTicks.tradeId, sourceId))
    .orderBy(tradePriceTicks.observedAt)
    .limit(100_000);

  if (!ticks.length) return;

  const values = ticks.map((t) => Number(t.markPrice));
  if (!values.length) return;

  const extremeFn = side === "long" ? Math.max : Math.min;
  const extremePrice = extremeFn(...values);

  const [mfePrice, maePrice] =
    side === "long"
      ? [extremePrice, Math.min(...values)]
      : [extremePrice, Math.max(...values)];

  await db
    .update(trades as any)
    .set({
      mfePrice,
      maePrice,
    })
    .where(eq((trades as any).positionId, positionId))
    .catch(() => {});
}
