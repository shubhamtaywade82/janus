import { LedgerEngine } from "../services/ledger-engine.js";
import type { ExchangeGatewayPort } from "../ports/exchange-gateway.port.js";

export class RecalcPortfolioUseCase {
  constructor(
    private readonly ledgerEngine: LedgerEngine,
    private readonly gateway: ExchangeGatewayPort,
    private readonly accountId: string
  ) {}

  async execute(): Promise<void> {
    const balances = await this.gateway.fetchBalances();
    const usdtBalance = balances.find((b) => b.currency === "USDT");
    const cashBalance = usdtBalance ? usdtBalance.available + usdtBalance.locked : 0;

    await this.ledgerEngine.recalcPortfolio(
      this.accountId,
      this.gateway.exchangeId,
      cashBalance
    );
  }
}
