import WebSocket from 'ws';

// Test exact format the bot uses but with spot endpoint
const s = 'btcusdt';
const url = `wss://stream.binance.com:9443/stream?streams=${s}@depth20@100ms/${s}@trade/${s}@ticker/${s}@kline_1m`;
console.log('Test spot combined:', url);
const ws = new WebSocket(url);
let counts = { depth: 0, trade: 0, ticker: 0, kline: 0 };
ws.on('open', () => console.log('Opened'));
ws.on('message', (d) => {
  const { stream } = JSON.parse(d);
  if (stream.includes('@depth20')) counts.depth++;
  else if (stream.includes('@trade')) counts.trade++;
  else if (stream.includes('@ticker')) counts.ticker++;
  else if (stream.includes('@kline_1m')) counts.kline++;
});
ws.on('error', (e) => console.log('Error:', e.message));
ws.on('close', (c,r) => console.log('Closed:', c, r?.toString()));

setTimeout(() => {
  console.log('Counts:', counts);
  ws.close();
  process.exit(0);
}, 10000);
