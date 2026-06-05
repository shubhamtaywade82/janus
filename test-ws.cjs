const WebSocket = require('ws');
const ws = new WebSocket('wss://fstream.binance.com/stream?streams=btcusdt@ticker');
ws.on('message', data => {
  console.log(data.toString());
  process.exit(0);
});
