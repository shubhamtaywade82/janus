import { getDb } from "../api/queries/connection";
import { positions, orders, tradingAccounts } from "../db/schema";
import { positionTransactions } from "../db/position-manager-schema";
import { eq, and } from "drizzle-orm";
import Decimal from "decimal.js";

async function main() {
  const db = getDb();
  console.log("Starting correction of negative positions and orders...");

  await db.transaction(async (tx) => {
    // 1. Get all positions with negative size
    const allPositions = await tx.select().from(positions);
    let updatedPositionsCount = 0;

    for (const p of allPositions) {
      const sizeVal = parseFloat(p.size);
      const marginVal = parseFloat(p.margin);
      
      if (sizeVal < 0 || marginVal < 0) {
        const absSize = Math.abs(sizeVal);
        // Recalculate margin to be positive based on absolute size
        const absMargin = (absSize * parseFloat(p.entryPrice)) / p.leverage;
        
        console.log(`Fixing position ID ${p.id} (${p.symbol}): size ${p.size} -> ${absSize}, margin ${p.margin} -> ${absMargin.toFixed(4)}`);
        
        await tx
          .update(positions)
          .set({
            size: absSize.toString(),
            margin: absMargin.toFixed(8),
            usedMargin: absMargin.toFixed(8),
            updatedAt: new Date(),
          })
          .where(eq(positions.id, p.id));
          
        updatedPositionsCount++;
      }
    }
    console.log(`Fixed ${updatedPositionsCount} positions.`);

    // 2. Get all orders with negative quantity
    const allOrders = await tx.select().from(orders);
    let updatedOrdersCount = 0;

    for (const o of allOrders) {
      const qtyVal = parseFloat(o.quantity);
      if (qtyVal < 0) {
        const absQty = Math.abs(qtyVal);
        console.log(`Fixing order ID ${o.id} (${o.symbol}): quantity ${o.quantity} -> ${absQty}`);
        
        await tx
          .update(orders)
          .set({
            quantity: absQty.toString(),
            filledQuantity: o.filledQuantity && parseFloat(o.filledQuantity) < 0 ? absQty.toString() : o.filledQuantity,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, o.id));
          
        updatedOrdersCount++;
      }
    }
    console.log(`Fixed ${updatedOrdersCount} orders.`);

    // 3. Fix negative quantities in positionTransactions if they exist
    try {
      const txns = await tx.select().from(positionTransactions);
      let updatedTxnsCount = 0;
      for (const t of txns) {
        const qAfter = parseFloat(t.quantityAfter || "0");
        const qDelta = parseFloat(t.quantityDelta || "0");
        const mAfter = parseFloat(t.marginAfter || "0");
        if (qAfter < 0 || qDelta < 0 || mAfter < 0) {
          console.log(`Fixing transaction ID ${t.id} (${t.symbol}): quantityAfter ${qAfter} -> ${Math.abs(qAfter)}, quantityDelta ${qDelta} -> ${Math.abs(qDelta)}, marginAfter ${mAfter} -> ${Math.abs(mAfter)}`);
          await tx
            .update(positionTransactions)
            .set({
              quantityAfter: Math.abs(qAfter).toString(),
              quantityDelta: Math.abs(qDelta).toString(),
              marginAfter: Math.abs(mAfter).toString(),
            })
            .where(eq(positionTransactions.id, t.id));
          updatedTxnsCount++;
        }
      }
      console.log(`Fixed ${updatedTxnsCount} position transactions.`);
    } catch (e) {
      console.warn("Could not update positionTransactions:", e);
    }

    // 4. Reconcile Account ID 1 (consolidated INR account) locked margin and available balance
    const [account] = await tx
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.id, 1))
      .limit(1);

    if (account) {
      // Find all open paper positions for userId: 1 and marginCurrency: "INR"
      const openINRPositions = await tx
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.userId, 1),
            eq(positions.status, "open"),
            eq(positions.isPaper, true),
            eq(positions.marginCurrency, "INR")
          )
        );

      let totalOpenMargin = new Decimal(0);
      for (const pos of openINRPositions) {
        totalOpenMargin = totalOpenMargin.add(new Decimal(pos.margin));
      }

      const walletBal = new Decimal(account.walletBalance);
      const lockedVal = totalOpenMargin;
      const availVal = walletBal.sub(lockedVal);
      const freeMarginVal = Decimal.max(0, availVal);

      console.log(`Reconciling Account ID 1:`);
      console.log(`- Wallet Balance: ${walletBal.toFixed(4)}`);
      console.log(`- New Locked Margin: ${lockedVal.toFixed(4)} (from ${openINRPositions.length} open positions)`);
      console.log(`- New Available Balance: ${availVal.toFixed(4)}`);
      console.log(`- New Free Margin: ${freeMarginVal.toFixed(4)}`);

      await tx
        .update(tradingAccounts)
        .set({
          lockedMargin: lockedVal.toFixed(8),
          availableBalance: availVal.toFixed(8),
          usedMargin: lockedVal.toFixed(8),
          freeMargin: freeMarginVal.toFixed(8),
          equity: walletBal.toFixed(8),
          updatedAt: new Date(),
        })
        .where(eq(tradingAccounts.id, 1));
    }

    console.log("Database correction transaction complete.");
  });
}

main().catch(console.error);
