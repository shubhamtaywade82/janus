/**
 * Ledger Worker
 * Listens for FILL_RECEIVED events, applies them to the ledger,
 * and recomputes positions and portfolio.
 */
import { loadConfig } from "../../app/config.js";
import { buildContainer } from "../../app/container.js";
import { logger } from "../../infrastructure/observability/logger.js";
import { DomainEvents } from "../../domain/common/events.js";
import type { Fill } from "../../domain/fills/fill.js";

const log = logger.child({ worker: "ledger" });

async function main() {
  log.info("starting ledger worker");

  const config = loadConfig();
  const c = buildContainer(config);

  for (const [name, gw] of c.gateways) {
    await gw.connect().catch((e) =>
      log.error("gateway connect failed", { exchange: name, error: String(e) })
    );
  }

  c.eventBus.subscribe<Fill>(DomainEvents.FILL_RECEIVED, async (fill) => {
    log.info("fill received", { id: fill.id, symbol: fill.symbol, qty: fill.quantity, price: fill.price });

    // We need mark price for unrealized PnL — use fill price as approximation for now
    const markPrice = fill.price;

    try {
      await c.handleFill.execute(fill, markPrice);
    } catch (err) {
      log.error("ledger apply failed", { error: String(err), fill });
    }
  });

  c.eventBus.subscribe(DomainEvents.POSITION_UPDATED, (event) => {
    log.info("position updated", event as Record<string, unknown>);
  });

  c.eventBus.subscribe(DomainEvents.PORTFOLIO_UPDATED, (event) => {
    log.info("portfolio updated", event as Record<string, unknown>);
  });

  // Periodic full reconciliation
  setInterval(async () => {
    try {
      await c.recalcPortfolio.execute();
    } catch (err) {
      log.warn("periodic reconciliation failed", { error: String(err) });
    }
  }, 60_000);

  log.info("ledger worker ready");
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  log.error("fatal", { error: String(err) });
  process.exit(1);
});
