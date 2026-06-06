import { nanoid } from "nanoid";
import type { TradeSignal } from "../../domain/signals/trade-signal.js";
import type { ExecutionIntent } from "../../domain/signals/execution-intent.js";
import { RiskEngine } from "../services/risk-engine.js";
import { ExecutionEngine } from "../services/execution-engine.js";
import type { PortfolioStorePort } from "../ports/portfolio-store.port.js";

export class PlaceOrderUseCase {
  constructor(
    private readonly riskEngine: RiskEngine,
    private readonly executionEngine: ExecutionEngine,
    private readonly portfolioStore: PortfolioStorePort
  ) {}

  async execute(signal: TradeSignal, accountId: string): Promise<void> {
    const portfolio = await this.portfolioStore.getPortfolio(accountId);
    if (!portfolio) throw new Error(`Portfolio not found for account ${accountId}`);

    const positions = await this.portfolioStore.getPositions(accountId);
    const decision = this.riskEngine.evaluate(signal, portfolio, positions.length);

    if (!decision.approved) {
      console.warn(`[PlaceOrderUseCase] Risk rejected signal ${signal.id}: ${decision.reason}`);
      return;
    }

    const intent: ExecutionIntent = {
      signalId: signal.id,
      symbol: signal.symbol,
      exchange: signal.exchange,
      side: signal.side,
      orderType: signal.orderType,
      quantity: decision.adjustedQuantity ?? signal.quantity,
      price: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      clientOrderId: nanoid(),
    };

    await this.executionEngine.execute(intent);
  }
}
