import io from "socket.io-client";
import { createHmac } from "crypto";
import { getDb } from "../queries/connection";
import { exchangeCredentials, positions } from "@db/schema";
import { eq, and } from "drizzle-orm";

let socket: any = null;

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
    console.log("[coindcx-ws] Socket.io connection opened. Authenticating...");
    
    // Auth Handshake
    const timestamp = Date.now();
    const signature = generateWsSignature(apiSecret, timestamp);

    // CoinDCX socket.io join auth handshake
    socket.emit("join", {
      key: apiKey,
      signature,
      timestamp,
    });
  });

  socket.on("joined", (response: any) => {
    console.log("[coindcx-ws] Authenticated successfully via join event:", response);
    
    // Subscribe to execution reports / user orders
    socket.emit("subscribe", {
      channel: "user-orders"
    });
  });

  // Handle incoming private ticks / execution reports
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
