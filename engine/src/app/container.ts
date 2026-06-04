import type { EngineConfig } from "./config.js";
import type { ExchangeGatewayPort } from "../application/ports/exchange-gateway.port.js";

import { InMemoryEventBus } from "../infrastructure/messaging/event-bus.js";
import { InMemoryOrderRepository } from "../infrastructure/persistence/in-memory/order.repository.js";
import { InMemoryFillRepository } from "../infrastructure/persistence/in-memory/fill.repository.js";
import { InMemoryPortfolioRepository } from "../infrastructure/persistence/in-memory/portfolio.repository.js";

import { RiskEngine } from "../application/services/risk-engine.js";
import { ExecutionEngine } from "../application/services/execution-engine.js";
import { LedgerEngine } from "../application/services/ledger-engine.js";
import { StrategyRunner } from "../application/services/strategy-runner.js";

import { PlaceOrderUseCase } from "../application/use-cases/place-order.usecase.js";
import { HandleFillUseCase } from "../application/use-cases/handle-fill.usecase.js";
import { RecalcPortfolioUseCase } from "../application/use-cases/recalc-portfolio.usecase.js";

import { DeltaGateway } from "../infrastructure/exchange/delta/delta-gateway.js";
import { CoinDCXGateway } from "../infrastructure/exchange/coindcx/coindcx-gateway.js";

import { SystemClock } from "../application/ports/clock.port.js";

export interface Container {
  eventBus: InMemoryEventBus;
  orderRepo: InMemoryOrderRepository;
  fillRepo: InMemoryFillRepository;
  portfolioRepo: InMemoryPortfolioRepository;
  gateways: Map<string, ExchangeGatewayPort>;
  riskEngine: RiskEngine;
  executionEngine: ExecutionEngine;
  ledgerEngine: LedgerEngine;
  strategyRunner: StrategyRunner;
  placeOrder: PlaceOrderUseCase;
  handleFill: HandleFillUseCase;
  recalcPortfolio: RecalcPortfolioUseCase;
  clock: SystemClock;
  config: EngineConfig;
}

export function buildContainer(config: EngineConfig): Container {
  // Infrastructure
  const eventBus = new InMemoryEventBus();
  const orderRepo = new InMemoryOrderRepository();
  const fillRepo = new InMemoryFillRepository();
  const portfolioRepo = new InMemoryPortfolioRepository();
  const clock = new SystemClock();

  // Gateways
  const gateways = new Map<string, ExchangeGatewayPort>();

  if (config.exchanges.includes("delta") && config.delta) {
    gateways.set("delta", new DeltaGateway(config.delta));
  }

  if (config.exchanges.includes("coindcx") && config.coindcx) {
    gateways.set("coindcx", new CoinDCXGateway(config.coindcx));
  }

  // Application services
  const riskEngine = new RiskEngine(config.risk, eventBus);
  const executionEngine = new ExecutionEngine(gateways, orderRepo, eventBus);
  const ledgerEngine = new LedgerEngine(fillRepo, orderRepo, portfolioRepo, eventBus);
  const strategyRunner = new StrategyRunner(eventBus);

  // Use cases
  const primaryGateway = gateways.values().next().value!;
  const placeOrder = new PlaceOrderUseCase(riskEngine, executionEngine, portfolioRepo);
  const handleFill = new HandleFillUseCase(ledgerEngine, config.accountId);
  const recalcPortfolio = new RecalcPortfolioUseCase(ledgerEngine, primaryGateway, config.accountId);

  return {
    eventBus,
    orderRepo,
    fillRepo,
    portfolioRepo,
    gateways,
    riskEngine,
    executionEngine,
    ledgerEngine,
    strategyRunner,
    placeOrder,
    handleFill,
    recalcPortfolio,
    clock,
    config,
  };
}
