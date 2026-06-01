import io from "socket.io-client";
import { createHmac } from "crypto";
import { getDb } from "../queries/connection";
import { exchangeCredentials, positions, futuresWallets } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { EventEmitter } from "events";

export const tradingEvents = new EventEmitter();
tradingEvents.setMaxListeners(100);

export const userBalancesCache = new Map<number, any[]>();
export const userPositionsCache = new Map<number, any[]>();

let socket: any = null;

// CoinDCX sends { event: string, data: "<JSON string>" } — double-serialized
const parseWsEvent = (response: any): any => {
  if (typeof response?.data === "string") {
    try { return JSON.parse(response.data); } catch { return response; }
  }
  return response?.data ?? response;
};

function generateWsSignature(secret: string, body: Record<string, any>): string {
  const payload = JSON.stringify(body);
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function initCoinDCXPrivateWs() {
  const db = getDb();
  
  // Find user credentials for userId = 1
  const creds = await db
    .select()
    .from(exchangeCredentials)
    .where(
      and(
        eq(exchangeCredentials.userId, 1),
        eq(exchangeCredentials.exchange, "coindcx")
      )
    )
    .limit(1);

  if (!creds || !creds[0]) {
    console.log("[coindcx-ws] No credentials found. WebSocket listener idle.");
    return;
  }

  const { apiKey, apiSecret } = creds[0];
  const wsUrl = "wss://stream.coindcx.com"; // CoinDCX Socket.io stream endpoint

  if (socket) {
    socket.disconnect();
  }

  console.log(`[coindcx-ws] Connecting to CoinDCX Private Socket.io v2: ${wsUrl}`);
  
  socket = io(wsUrl, {
    transports: ["websocket"],
    upgrade: false,
    rejectUnauthorized: false
  });

  socket.on("connect", () => {
    console.log("[coindcx-ws] Socket.io connection opened. Authenticating for 'coindcx' private channel...");
    
    // Auth Handshake for 'coindcx' channel
    const body = { channel: "coindcx" };
    const authSignature = generateWsSignature(apiSecret, body);

    // CoinDCX socket.io join auth handshake
    socket.emit("join", {
      channelName: "coindcx",
      authSignature,
      apiKey,
    });
  });

  socket.on("joined", (response: any) => {
    console.log("[coindcx-ws] Authenticated successfully joined 'coindcx' channel:", response);
  });

  socket.on("df-position-update", (raw: any) => {
    const parsed = parseWsEvent(raw);
    const posList: any[] = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
    console.log(`[coindcx-ws] df-position-update: ${posList.length} positions`);
    if (posList.length > 0) {
      const existing = userPositionsCache.get(1) || [];
      const updated = [...existing];
      for (const p of posList) {
        const idx = updated.findIndex((e: any) => e.pair === p.pair);
        if (idx >= 0) updated[idx] = p;
        else updated.push(p);
      }
      userPositionsCache.set(1, updated);
    }
    tradingEvents.emit("portfolio-update:1");
  });

  socket.on("df-order-update", (raw: any) => {
    const parsed = parseWsEvent(raw);
    console.log("[coindcx-ws] df-order-update:", JSON.stringify(parsed).slice(0, 200));
    tradingEvents.emit("portfolio-update:1");
  });

  socket.on("balance-update", async (raw: any) => {
    const parsed = parseWsEvent(raw);
    const balanceList: any[] = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);
    console.log(`[coindcx-ws] balance-update: ${balanceList.length} entries`, balanceList.map((b: any) => `${b.currency_short_name}=${b.balance}`));

    if (balanceList) {
      userBalancesCache.set(1, balanceList);
      // Persist each currency balance to DB so it survives server restarts
      try {
        const db = getDb();
        for (const b of balanceList) {
          const currency = (b.currency_short_name || b.currency || "").toUpperCase();
          if (currency !== "INR" && currency !== "USDT") continue;
          const existing = await db
            .select()
            .from(futuresWallets)
            .where(and(
              eq(futuresWallets.userId, 1),
              eq(futuresWallets.exchange, "coindcx"),
              eq(futuresWallets.marginCurrency, currency as "INR" | "USDT")
            ))
            .limit(1);
          const walletData = {
            balance: String(b.balance || "0"),
            lockedBalance: String(b.locked_balance || "0"),
            crossUserMargin: String(b.cross_user_margin || "0"),
            crossOrderMargin: String(b.cross_order_margin || "0"),
            updatedAt: new Date(),
          };
          if (existing[0]) {
            await db.update(futuresWallets).set(walletData).where(eq(futuresWallets.id, existing[0].id));
          } else {
            await db.insert(futuresWallets).values({
              userId: 1,
              exchange: "coindcx",
              marginCurrency: currency as "INR" | "USDT",
              ...walletData,
            });
          }
        }
      } catch (err) {
        console.error("[coindcx-ws] Failed to persist balance to DB:", err);
      }
    }
    tradingEvents.emit("portfolio-update:1");
  });

  // Handle legacy/fallback user-orders if any
  socket.on("user-orders", async (order: any) => {
    try {
      console.log("[coindcx-ws] Received execution report:", order);
      const exchangeOrderId = order.id;
      const status = order.status; // e.g. "filled", "cancelled"

      if (status === "filled") {
        const db = getDb();
        
        // Match position by exchangeOrderId
        const matchedPositions = await db
          .select()
          .from(positions)
          .where(eq(positions.exchangeOrderId, exchangeOrderId))
          .limit(1);

        if (matchedPositions && matchedPositions[0]) {
          const pos = matchedPositions[0];
          
          await db
            .update(positions)
            .set({
              status: "open",
              updatedAt: new Date(),
            })
            .where(eq(positions.id, pos.id));

          console.log(`[coindcx-ws] Updated position ${pos.id} to open in DB.`);
          tradingEvents.emit("portfolio-update:1");
        }
      }
    } catch (err) {
      console.error("[coindcx-ws] Error handling user order tick:", err);
    }
  });

  socket.on("error", (err: any) => {
    console.error("[coindcx-ws] Socket.io private socket error:", err);
  });

  socket.on("disconnect", (reason: string) => {
    console.log(`[coindcx-ws] Socket.io disconnected. Reason: ${reason}. Will reconnect automatically.`);
  });
}
