import WebSocket from "ws";

const url = "wss://fstream.binance.com/stream?streams=ethusdt@ticker";

const ws = new WebSocket(url);

ws.on("open", () => console.log("[open] connected"));
ws.on("error", (e) => console.error("[error]", e.message));
ws.on("close", (code, reason) => console.log("[close]", code, reason.toString()));
ws.on("message", (data) => {
  console.log("[msg]", data.toString().slice(0, 200));
});

setTimeout(() => { ws.close(); process.exit(0); }, 5000);
