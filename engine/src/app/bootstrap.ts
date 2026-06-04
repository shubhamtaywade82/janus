import { loadConfig } from "./config.js";
import { buildContainer } from "./container.js";
import { logger } from "../infrastructure/observability/logger.js";
import { DomainEvents } from "../domain/common/events.js";
import type { TradeSignal } from "../domain/signals/trade-signal.js";

async function main() {
  const log = logger.child({ module: "bootstrap" });
  const config = loadConfig();
  log.info("starting engine", { exchanges: config.exchanges });

  const c = buildContainer(config);

  // ─── Connect gateways ──────────────────────────────────────────────────────
  for (const [name, gateway] of c.gateways) {
    try {
      await gateway.connect();
      log.info(`gateway connected`, { exchange: name });
    } catch (err) {
      log.error(`gateway connect failed`, { exchange: name, error: String(err) });
    }
  }

  // ─── Seed portfolio ────────────────────────────────────────────────────────
  await c.portfolioRepo.savePortfolio({
    accountId: config.accountId,
    exchange: (config.exchanges[0] ?? "coindcx") as any,
    cashBalance: 0,
    equity: 0,
    usedMargin: 0,
    freeMargin: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalFees: 0,
    netProfit: 0,
    updatedAt: Date.now(),
  });

  // Sync live balance on startup
  try {
    await c.recalcPortfolio.execute();
  } catch (err) {
    log.warn("initial portfolio sync failed", { error: String(err) });
  }

  // ─── Wire signal → place-order pipeline ───────────────────────────────────
  c.eventBus.subscribe<TradeSignal>(DomainEvents.SIGNAL_GENERATED, async (signal) => {
    log.info("signal received", {
      id: signal.id,
      symbol: signal.symbol,
      side: signal.side,
      confidence: signal.confidence,
      score: signal.score,
    });

    if (process.env.PLACE_ORDERS !== "true") {
      log.warn("PLACE_ORDERS=false — signal not executed");
      return;
    }

    try {
      await c.placeOrder.execute(signal, config.accountId);
    } catch (err) {
      log.error("place order failed", { error: String(err) });
    }
  });

  // ─── Portfolio periodic reconciliation ────────────────────────────────────
  setInterval(async () => {
    try {
      await c.recalcPortfolio.execute();
    } catch (err) {
      log.warn("portfolio reconciliation failed", { error: String(err) });
    }
  }, 30_000);

  log.info("engine running", {
    exchanges: [...c.gateways.keys()],
    placeOrders: process.env.PLACE_ORDERS === "true",
  });

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      log.info(`received ${signal}, shutting down`);
      for (const gateway of c.gateways.values()) {
        await gateway.disconnect().catch(() => {});
      }
      process.exit(0);
    });
  }
}

main().catch((err) => {
  logger.error("fatal error", { error: String(err) });
  process.exit(1);
});
