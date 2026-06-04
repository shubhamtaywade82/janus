import WebSocket from "ws";

const symbol = "ethusdt";
const url = `wss://fstream.binance.com/market/stream?streams=${symbol}@depth20@100ms/${symbol}@trade/${symbol}@ticker/${symbol}@kline_1m`;
console.log("Connecting to:", url);
const ws = new WebSocket(url);

ws.on("open", () => console.log("[open] connected to Binance Futures WS"));
ws.on("error", (e) => console.error("[error]", e.message));
ws.on("close", (code, reason) => console.log("[close]", code, reason.toString()));
ws.on("message", (raw) => {
  const payload = JSON.parse(raw.toString());
  console.log(`[stream: ${payload.stream}]`, Object.keys(payload.data || {}).join(", "));
});

setTimeout(() => {
  console.log("Closing test");
  ws.close();
  process.exit(0);
}, 6000);
