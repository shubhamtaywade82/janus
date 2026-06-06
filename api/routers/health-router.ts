import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { signals } from "@db/schema";
import { desc } from "drizzle-orm";
import { activeStreams, latestTickerCache } from "../services/streaming";
import { globalKillSwitch } from "../services/kill-switch";
import { positionStore } from "../services/position-manager/position-store";

const _bootTime = Date.now();

export const healthRouter = createRouter({
  // Basic liveness probe — same as GET /health (for tRPC clients)
  live: publicQuery.query(async () => {
    let dbOk = false;
    try {
      const db = getDb();
      await db.execute("SELECT 1" as any);
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return {
      status: dbOk ? "ok" : "degraded",
      uptime: Math.floor((Date.now() - _bootTime) / 1000),
      db: dbOk ? "ok" : "error",
      ts: new Date().toISOString(),
    };
  }),

  // Detailed health — all subsystem checks
  detailed: publicQuery.query(async () => {
    const db = getDb();
    const now = Date.now();

    // ── DB latency ──
    let dbOk = false;
    let dbLatencyMs = -1;
    try {
      const t0 = Date.now();
      await db.execute("SELECT 1" as any);
      dbLatencyMs = Date.now() - t0;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    // ── Last signal ──
    let lastSignalAt: string | null = null;
    let signalAgeSeconds: number | null = null;
    try {
      const rows = await db
        .select({ createdAt: signals.createdAt })
        .from(signals)
        .orderBy(desc(signals.createdAt))
        .limit(1);
      if (rows.length > 0 && rows[0].createdAt) {
        lastSignalAt = new Date(rows[0].createdAt).toISOString();
        signalAgeSeconds = Math.floor((now - new Date(rows[0].createdAt).getTime()) / 1000);
      }
    } catch {
      // non-fatal
    }

    // ── WebSocket streams ──
    const streamList: { symbol: string; hasWs: boolean; subscriberCount: number }[] = [];
    for (const [symbol, stream] of activeStreams) {
      streamList.push({
        symbol,
        hasWs: stream.ws !== null,
        subscriberCount: stream.subscribers,
      });
    }
    const activeStreamCount = streamList.filter((s) => s.hasWs).length;
    const tickerCount = latestTickerCache.size;

    // ── Kill switch ──
    const killSwitchActive = globalKillSwitch.isActive;

    // ── Position manager ──
    let openPositionCount = 0;
    let totalUnrealizedPnl = 0;
    try {
      openPositionCount = positionStore.getOpen().length;
      totalUnrealizedPnl = positionStore.totalUnrealizedPnl();
    } catch {
      // position store may not be initialized
    }

    // ── Overall status ──
    const signalStale = signalAgeSeconds !== null && signalAgeSeconds > 300; // >5 min
    const streamsHealthy = activeStreamCount > 0 || streamList.length === 0;
    const overallOk = dbOk && !killSwitchActive && !signalStale && streamsHealthy;

    return {
      status: overallOk ? "ok" : "degraded",
      uptime: Math.floor((now - _bootTime) / 1000),
      ts: new Date().toISOString(),
      checks: {
        db: {
          ok: dbOk,
          latencyMs: dbLatencyMs,
        },
        signals: {
          lastSignalAt,
          ageSeconds: signalAgeSeconds,
          stale: signalStale,
        },
        streams: {
          active: activeStreamCount,
          total: streamList.length,
          tickersCached: tickerCount,
          symbols: streamList,
        },
        killSwitch: {
          active: killSwitchActive,
        },
        positions: {
          open: openPositionCount,
          unrealizedPnl: totalUnrealizedPnl,
        },
      },
    };
  }),
});
