import WebSocket from "ws";

const url = "ws://localhost:3011";
console.log("Connecting to local WS server at:", url);
const ws = new WebSocket(url);

ws.on("open", () => {
  console.log("[open] connected to local WS server on 3011");
  // Send a mock subscription request if needed
});

ws.on("error", (e) => {
  console.error("[error] failed to connect:", e.message);
});

ws.on("close", (code, reason) => {
  console.log("[close] connection closed:", code, reason.toString());
});

setTimeout(() => {
  console.log("Closing connection test");
  ws.close();
  process.exit(0);
}, 3000);
