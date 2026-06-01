import WebSocket from "ws";
import { createHmac } from "crypto";
import { getDb } from "../queries/connection";
import { exchangeCredentials, positions, trades } from "@db/schema";
import { eq, and } from "drizzle-orm";

let socket: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

// Generate signature for WebSocket Auth Handshake
function generateWsSignature(secret: string, timestamp: number): string {
  const payload = `timestamp=${timestamp}`;
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
  const wsUrl = "wss://stream.coindcx.com"; // CoinDCX WebSocket stream endpoint

  if (socket) {
    socket.close();
  }

  console.log(`[coindcx-ws] Connecting to CoinDCX Private WS: ${wsUrl}`);
  socket = new WebSocket(wsUrl);

  socket.on("open", () => {
    console.log("[coindcx-ws] Socket connection opened. Authenticating...");
    
    // Auth Handshake
    const timestamp = Date.now();
    const signature = generateWsSignature(apiSecret, timestamp);

    const authMessage = {
      event: "auth",
      params: {
        key: apiKey,
        signature,
        timestamp,
      },
    };

    socket?.send(JSON.stringify(authMessage));
  });

  socket.on("message", async (dataStr) => {
    try {
      const payload = JSON.parse(dataStr.toString());
      console.log("[coindcx-ws] Received message:", payload);

      // Handle auth success
      if (payload.event === "auth" && payload.status === "success") {
        console.log("[coindcx-ws] Authenticated successfully. Subscribing to execution reports...");
        
        // Subscribe to user execution reports/fills channel
        const subMessage = {
          event: "subscribe",
          topic: "user-orders",
        };
        socket?.send(JSON.stringify(subMessage));
      }

      // Handle order execution report / fill updates
      if (payload.topic === "user-orders" && payload.data) {
        const order = payload.data;
        const exchangeOrderId = order.id;
        const status = order.status; // e.g. "filled", "cancelled"

        console.log(`[coindcx-ws] Execution Report - Order ${exchangeOrderId}: ${status}`);

        // Update database position/trade records
        if (status === "filled") {
          const db = getDb();
          
          // Match by exchangeOrderId
          const matchedPositions = await db
            .select()
            .from(positions)
            .where(eq(positions.exchangeOrderId, exchangeOrderId))
            .limit(1);

          if (matchedPositions && matchedPositions[0]) {
            const pos = matchedPositions[0];
            
            // If it's a closing trade or status update
            await db
              .update(positions)
              .set({
                status: "open",
                updatedAt: new Date(),
              })
              .where(eq(positions.id, pos.id));

            console.log(`[coindcx-ws] Updated position ${pos.id} in DB.`);
          }
        }
      }
    } catch (err) {
      console.error("[coindcx-ws] Error parsing message:", err);
    }
  });

  socket.on("error", (err) => {
    console.error("[coindcx-ws] Private socket error:", err);
  });

  socket.on("close", () => {
    console.log("[coindcx-ws] Socket connection closed. Reconnecting in 5 seconds...");
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      initCoinDCXPrivateWs();
    }, 5000);
  });
}
