import WebSocket from "ws";

// Try different stream configurations for depth and trade on Futures
const streams = [
  "ethusdt@depth5",
  "ethusdt@depth10",
  "ethusdt@depth20",
  "ethusdt@depth",
  "ethusdt@trade",
  "ethusdt@aggTrade"
];

const url = `wss://fstream.binance.com/market/stream?streams=${streams.join("/")}`;
console.log("Connecting to:", url);
const ws = new WebSocket(url);

ws.on("open", () => console.log("[open] connected"));
ws.on("error", (e) => console.error("[error]", e.message));
ws.on("message", (raw) => {
  const payload = JSON.parse(raw.toString());
  console.log(`[stream: ${payload.stream}] received`);
});

setTimeout(() => {
  console.log("Closing test");
  ws.close();
  process.exit(0);
}, 6000);
