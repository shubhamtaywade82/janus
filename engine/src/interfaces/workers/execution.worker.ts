/**
 * Execution Worker
 * Listens for SIGNAL_GENERATED events and drives the risk → execution pipeline.
 */
import { loadConfig } from "../../app/config.js";
import { buildContainer } from "../../app/container.js";
import { logger } from "../../infrastructure/observability/logger.js";
import { DomainEvents } from "../../domain/common/events.js";
import type { TradeSignal } from "../../domain/signals/trade-signal.js";

const log = logger.child({ worker: "execution" });

async function main() {
  log.info("starting execution worker");

  const config = loadConfig();
  const c = buildContainer(config);

  for (const [name, gw] of c.gateways) {
    try {
      await gw.connect();
      log.info("gateway connected", { exchange: name });
    } catch (err) {
      log.error("gateway connect failed", { exchange: name, error: String(err) });
    }
  }

  // Seed empty portfolio
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

  await c.recalcPortfolio.execute().catch((e) =>
    log.warn("initial recalc failed", { error: String(e) })
  );

  c.eventBus.subscribe<TradeSignal>(DomainEvents.SIGNAL_GENERATED, async (signal) => {
    log.info("signal received", { id: signal.id, symbol: signal.symbol, confidence: signal.confidence });

    if (process.env.PLACE_ORDERS !== "true") {
      log.warn("PLACE_ORDERS disabled — skipping");
      return;
    }

    try {
      await c.placeOrder.execute(signal, config.accountId);
    } catch (err) {
      log.error("execution failed", { error: String(err), signal });
    }
  });

  c.eventBus.subscribe(DomainEvents.ORDER_FILLED, (event) => {
    log.info("order filled", event as Record<string, unknown>);
  });

  c.eventBus.subscribe(DomainEvents.ORDER_REJECTED, (event) => {
    log.warn("order rejected", event as Record<string, unknown>);
  });

  log.info("execution worker ready");
  // Keep alive
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  log.error("fatal", { error: String(err) });
  process.exit(1);
});
