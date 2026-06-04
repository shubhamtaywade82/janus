import type { Portfolio } from "../../domain/portfolio/portfolio.js";
import type { Position } from "../../domain/positions/position.js";

export interface PortfolioStorePort {
  savePortfolio(portfolio: Portfolio): Promise<void>;
  getPortfolio(accountId: string): Promise<Portfolio | null>;
  savePosition(position: Position): Promise<void>;
  getPositions(accountId: string): Promise<Position[]>;
  removePosition(symbol: string, accountId: string): Promise<void>;
}
