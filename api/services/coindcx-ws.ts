import io from "socket.io-client";
import { createHmac } from "crypto";
import { getDb } from "../queries/connection";
import { exchangeCredentials, positions } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { EventEmitter } from "events";

export const tradingEvents = new EventEmitter();
tradingEvents.setMaxListeners(100);

let socket: any = null;

// Generate signature for WebSocket Auth Handshake
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

  // Handle incoming private ticks / position updates
  socket.on("df-position-update", (data: any) => {
    console.log("[coindcx-ws] Received df-position-update:", data);
    tradingEvents.emit("portfolio-update:1");
  });

  // Handle incoming private order updates
  socket.on("df-order-update", (data: any) => {
    console.log("[coindcx-ws] Received df-order-update:", data);
    tradingEvents.emit("portfolio-update:1");
  });

  // Handle incoming balance updates
  socket.on("balance-update", (data: any) => {
    console.log("[coindcx-ws] Received balance-update:", data);
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
