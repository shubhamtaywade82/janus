import WebSocket from "ws";

// Test spot WS depth format
const ws = new WebSocket("wss://stream.binance.com:9443/stream?streams=ethusdt@depth20@100ms");

ws.on("open", () => console.log("[open]"));
ws.on("error", (e) => console.error("[error]", e.message));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  const { stream, data } = msg;
  console.log(`stream=${stream}`);
  console.log(`data keys: ${Object.keys(data || {}).join(", ")}`);
  console.log(`bids type: ${typeof data?.bids}  isArray: ${Array.isArray(data?.bids)}`);
  console.log(`b type: ${typeof data?.b}  isArray: ${Array.isArray(data?.b)}`);
  console.log(`sample bid:`, (data?.bids ?? data?.b)?.[0]);
  ws.close();
  process.exit(0);
});

setTimeout(() => { console.log("timeout"); process.exit(1); }, 5000);
