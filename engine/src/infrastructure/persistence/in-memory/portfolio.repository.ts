import type { Portfolio } from "../../../domain/portfolio/portfolio.js";
import type { Position } from "../../../domain/positions/position.js";
import type { PortfolioStorePort } from "../../../application/ports/portfolio-store.port.js";

export class InMemoryPortfolioRepository implements PortfolioStorePort {
  private portfolios = new Map<string, Portfolio>();
  private positions = new Map<string, Position[]>(); // key: accountId

  async savePortfolio(portfolio: Portfolio): Promise<void> {
    this.portfolios.set(portfolio.accountId, { ...portfolio });
  }

  async getPortfolio(accountId: string): Promise<Portfolio | null> {
    return this.portfolios.get(accountId) ?? null;
  }

  async savePosition(position: Position): Promise<void> {
    const key = position.symbol;
    for (const [accountId, positions] of this.positions.entries()) {
      const idx = positions.findIndex((p) => p.symbol === position.symbol && p.exchange === position.exchange);
      if (idx >= 0) {
        positions[idx] = { ...position };
        return;
      }
    }
    // If not found, add to a default account
    const defaultAccount = [...this.portfolios.keys()][0] ?? "default";
    const existing = this.positions.get(defaultAccount) ?? [];
    existing.push({ ...position });
    this.positions.set(defaultAccount, existing);
  }

  async getPositions(accountId: string): Promise<Position[]> {
    return this.positions.get(accountId) ?? [];
  }

  async removePosition(symbol: string, accountId: string): Promise<void> {
    const positions = this.positions.get(accountId) ?? [];
    this.positions.set(
      accountId,
      positions.filter((p) => p.symbol !== symbol)
    );
  }
}
