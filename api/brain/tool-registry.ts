import { marketStateManager } from "../services/market-state";
import { getPaperWallet } from "../services/paper-wallet";

export interface MarketSnapshot {
  symbol: string;
  ltp: number;
  bidPrice: number;
  askPrice: number;
  spread: number;
  spreadPercent: number;
  imbalance: number;
  absorptionScore: number;
  sweepScore: number;
  volatilityRegime: string;
  cumulativeCvd: number;
}

export interface PortfolioSnapshot {
  userId: number;
  startingBalance: number;
  balance: number;
  lockedMargin: number;
  realizedPnl: number;
  unrealizedPnl: number;
  equity: number;
  drawdown: number;
  drawdownPct: number;
  winRate: number;
  tradeCount: number;
}

export const toolRegistry = {
  /**
   * Retrieves a snapshot of the current market state for a symbol
   */
  getMarketSnapshot: (symbol: string): MarketSnapshot => {
    const state = marketStateManager.getOrInitializeState(symbol);
    const orderBook = state.orderBook;
    const bidPrice = orderBook?.bids?.[0]?.[0] ? parseFloat(orderBook.bids[0][0]) : state.ltp;
    const askPrice = orderBook?.asks?.[0]?.[0] ? parseFloat(orderBook.asks[0][0]) : state.ltp;

    return {
      symbol: state.symbol,
      ltp: state.ltp,
      bidPrice,
      askPrice,
      spread: state.metrics.spread,
      spreadPercent: state.metrics.spreadPercent,
      imbalance: state.metrics.imbalance,
      absorptionScore: state.metrics.absorptionScore,
      sweepScore: state.metrics.sweepScore,
      volatilityRegime: state.metrics.volatilityRegime,
      cumulativeCvd: state.cumulativeCvd,
    };
  },

  /**
   * Retrieves a snapshot of the paper trading portfolio state for a user
   */
  getPortfolioSnapshot: async (userId: number): Promise<PortfolioSnapshot> => {
    const wallet = await getPaperWallet(userId);
    return {
      userId: wallet.userId,
      startingBalance: wallet.startingBalance,
      balance: wallet.balance,
      lockedMargin: wallet.lockedMargin,
      realizedPnl: wallet.realizedPnl,
      unrealizedPnl: wallet.unrealizedPnl,
      equity: wallet.equity,
      drawdown: wallet.drawdown,
      drawdownPct: wallet.drawdownPct,
      winRate: wallet.winRate,
      tradeCount: wallet.tradeCount,
    };
  },

  /**
   * Aggregates both snapshots to provide a unified observation context
   */
  buildSnapshot: async (symbol: string, userId: number) => {
    const market = toolRegistry.getMarketSnapshot(symbol);
    const portfolio = await toolRegistry.getPortfolioSnapshot(userId);
    return {
      timestamp: new Date().toISOString(),
      market,
      portfolio,
    };
  }
};
