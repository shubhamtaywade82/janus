import WebSocket from "ws";

const symbol = "ethusdt";
const url = `wss://stream.binance.com:9443/stream?streams=${symbol}@depth20@100ms/${symbol}@trade/${symbol}@ticker/${symbol}@kline_1m`;
console.log("Connecting to Spot WS:", url);
const ws = new WebSocket(url);

ws.on("open", () => console.log("[open] connected to Binance Spot WS"));
ws.on("error", (e) => console.error("[error]", e.message));
ws.on("close", (code, reason) => console.log("[close]", code, reason.toString()));
ws.on("message", (raw) => {
  const payload = JSON.parse(raw.toString());
  console.log(`[stream: ${payload.stream}] received`);
});

setTimeout(() => {
  console.log("Closing test");
  ws.close();
  process.exit(0);
}, 6000);
