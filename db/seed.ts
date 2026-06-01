import { getDb } from "../api/queries/connection";
import { positions, trades } from "./schema";

async function seed() {
  const db = getDb();
  console.log("Seeding database with mock trading portfolio data...");

  // Clear existing
  await db.delete(positions);
  await db.delete(trades);

  // Insert mock open positions
  const openPos = await db.insert(positions).values([
    {
      userId: 1,
      symbol: "BTCUSDT",
      side: "long" as const,
      entryPrice: "73200.00",
      currentPrice: "73364.10",
      size: "0.45",
      leverage: 10,
      margin: "3294.00",
      unrealizedPnl: "73.845", // (73364.10 - 73200) * 0.45 = 73.845
      realizedPnl: "0.00",
      status: "open" as const,
    },
    {
      userId: 1,
      symbol: "ETHUSDT",
      side: "short" as const,
      entryPrice: "3480.00",
      currentPrice: "3450.50",
      size: "4.5",
      leverage: 5,
      margin: "3132.00",
      unrealizedPnl: "132.75", // (3480 - 3450.5) * 4.5 = 132.75
      realizedPnl: "0.00",
      status: "open" as const,
    }
  ]).returning({ id: positions.id });

  console.log(`Inserted ${openPos.length} open positions.`);

  // Insert mock trades
  const mockTrades = await db.insert(trades).values([
    {
      userId: 1,
      positionId: openPos[0].id,
      symbol: "BTCUSDT",
      side: "buy" as const,
      orderType: "market" as const,
      price: "73200.00",
      size: "0.45",
      leverage: 10,
      fee: "16.47",
      total: "32940.00",
      status: "filled" as const,
      executedAt: new Date(Date.now() - 3600000), // 1 hour ago
      createdAt: new Date(Date.now() - 3600000),
    },
    {
      userId: 1,
      positionId: openPos[1].id,
      symbol: "ETHUSDT",
      side: "sell" as const,
      orderType: "market" as const,
      price: "3480.00",
      size: "4.5",
      leverage: 5,
      fee: "7.83",
      total: "15660.00",
      status: "filled" as const,
      executedAt: new Date(Date.now() - 1800000), // 30 mins ago
      createdAt: new Date(Date.now() - 1800000),
    },
    {
      userId: 1,
      symbol: "SOLUSDT",
      side: "buy" as const,
      orderType: "market" as const,
      price: "142.50",
      size: "25.0",
      leverage: 3,
      fee: "1.78",
      total: "3562.50",
      status: "filled" as const,
      executedAt: new Date(Date.now() - 7200000), // 2 hours ago
      createdAt: new Date(Date.now() - 7200000),
    }
  ]);

  console.log("Mock trades seeded successfully.");
  console.log("Done.");
  process.exit(0);
}

seed();
