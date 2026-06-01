import WebSocket from "ws";

const url = "wss://fstream.binance.com/market/stream?streams=ethusdt@ticker/ethusdt@trade/ethusdt@markPrice";
const ws = new WebSocket(url);

ws.on("open", () => console.log("[open] connected to /market/stream"));
ws.on("error", (e) => console.error("[error]", e.message));
ws.on("close", (code, reason) => console.log("[close]", code, reason.toString()));
ws.on("message", (data) => {
  const payload = JSON.parse(data.toString());
  console.log(`[stream: ${payload.stream}]`, JSON.stringify(payload.data).slice(0, 150));
});

setTimeout(() => { ws.close(); process.exit(0); }, 5000);
