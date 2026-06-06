import { getDb } from "../queries/connection";
import { paperAccounts, paperPositions, paperTrades } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

export interface ExecutionAdapter {
  openPosition(
    symbol: string,
    side: "long" | "short",
    sizePct: number,
    entryPrice: number,
    stopLossPct?: number,
    takeProfitPct?: number
  ): Promise<any>;
  closePosition(positionId: string, exitPrice: number): Promise<void>;
  getOpenPositions(): Promise<any[]>;
}

export class PaperExecutionAdapter implements ExecutionAdapter {
  private takerFeeRate = 0.0005; // 0.05%
  private makerFeeRate = 0.0002; // 0.02%
  private slippageRate = 0.0002; // 0.02% slippage base

  private async getOrCreateAccount(userId: number, initialBalance = 10000) {
    const db = getDb();
    const rows = await db.select().from(paperAccounts).limit(1);
    if (rows.length === 0) {
      const [acc] = await db.insert(paperAccounts).values({
        name: `Paper Account User ${userId}`,
        startingBalance: initialBalance.toString(),
        currentBalance: initialBalance.toString(),
        equity: initialBalance.toString(),
        marginUsed: "0.00000000"
      }).returning();
      return acc;
    }
    return rows[0];
  }

  async openPosition(
    symbol: string,
    side: "long" | "short",
    sizePct: number,
    marketPrice: number,
    stopLossPct?: number,
    takeProfitPct?: number
  ): Promise<any> {
    const db = getDb();
    const account = await this.getOrCreateAccount(1);
    const balance = parseFloat(account.currentBalance);

    // Apply slippage to entry price
    // Long entry: slippage pushes price up. Short entry: pushes price down.
    const entryPrice = side === "long" 
      ? marketPrice * (1 + this.slippageRate)
      : marketPrice * (1 - this.slippageRate);

    // Margin = sizePct of portfolio balance
    const margin = balance * (sizePct / 100);
    const leverage = 10; // Default 10x leverage
    const positionValue = margin * leverage;
    const quantity = positionValue / entryPrice;

    // Fees: Taker fee on entry
    const entryFee = positionValue * this.takerFeeRate;
    const remainingBalance = balance - margin - entryFee;

    // SL / TP prices
    const stopLoss = stopLossPct 
      ? (side === "long" ? entryPrice * (1 - stopLossPct / 100) : entryPrice * (1 + stopLossPct / 100))
      : null;

    const takeProfit = takeProfitPct
      ? (side === "long" ? entryPrice * (1 + takeProfitPct / 100) : entryPrice * (1 - takeProfitPct / 100))
      : null;

    const positionId = `paper_${nanoid(10)}`;

    const [pos] = await db.insert(paperPositions).values({
      id: positionId,
      symbol,
      side,
      entryPrice: entryPrice.toString(),
      quantity: quantity.toString(),
      leverage,
      margin: margin.toString(),
      stopLoss: stopLoss ? stopLoss.toString() : null,
      takeProfit: takeProfit ? takeProfit.toString() : null,
      status: "open",
      openedAt: new Date()
    }).returning();

    // Update account balance and margin used
    await db.update(paperAccounts).set({
      currentBalance: remainingBalance.toString(),
      marginUsed: (parseFloat(account.marginUsed) + margin).toString(),
      equity: (remainingBalance + parseFloat(account.marginUsed) + margin).toString()
    }).where(eq(paperAccounts.id, account.id));

    console.log(`[Paper Adapter] Opened position ${positionId} for ${symbol} @ ${entryPrice.toFixed(2)}`);
    return pos;
  }

  async closePosition(positionId: string, exitPrice: number): Promise<void> {
    const db = getDb();
    
    const [pos] = await db.select().from(paperPositions).where(eq(paperPositions.id, positionId)).limit(1);
    if (!pos || pos.status !== "open") return;

    const account = await this.getOrCreateAccount(1);
    const entryPrice = parseFloat(pos.entryPrice);
    const quantity = parseFloat(pos.quantity);
    const margin = parseFloat(pos.margin);
    
    // Calculate PnL (Futures Formula)
    const directionMult = pos.side === "long" ? 1 : -1;
    const rawPnl = (exitPrice - entryPrice) * quantity * directionMult;

    // Taker fee on exit
    const exitFee = (quantity * exitPrice) * this.takerFeeRate;
    const totalPnl = rawPnl - exitFee;

    // Release margin and add PnL to balance
    const currentBalance = parseFloat(account.currentBalance);
    const nextBalance = currentBalance + margin + totalPnl;

    // Update position status
    await db.update(paperPositions).set({
      status: "closed",
      closedAt: new Date()
    }).where(eq(paperPositions.id, positionId));

    // Save Trade execution outcome
    const rMultiple = margin > 0 ? totalPnl / margin : 0;
    await db.insert(paperTrades).values({
      positionId,
      entryPrice: pos.entryPrice,
      exitPrice: exitPrice.toString(),
      pnl: totalPnl.toString(),
      fees: exitFee.toString(),
      rMultiple: rMultiple.toString()
    });

    // Update Account
    await db.update(paperAccounts).set({
      currentBalance: nextBalance.toString(),
      marginUsed: Math.max(0, parseFloat(account.marginUsed) - margin).toString(),
      equity: nextBalance.toString()
    }).where(eq(paperAccounts.id, account.id));

    console.log(`[Paper Adapter] Closed position ${positionId} @ ${exitPrice.toFixed(2)}. PnL: ${totalPnl.toFixed(2)} USDT (R: ${rMultiple.toFixed(2)})`);
  }

  async getOpenPositions(): Promise<any[]> {
    const db = getDb();
    return db.select().from(paperPositions).where(eq(paperPositions.status, "open"));
  }
}
