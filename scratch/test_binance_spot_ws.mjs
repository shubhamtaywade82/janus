import WebSocket from 'ws';

// Test spot stream
const url1 = 'wss://stream.binance.com:9443/ws/btcusdt@kline_1m';
console.log('Test spot WS:', url1);
const ws1 = new WebSocket(url1);
let c1 = 0;
ws1.on('open', () => console.log('Spot opened'));
ws1.on('message', (d) => { c1++; if (c1<=3) console.log('Spot msg:', JSON.parse(d).k?.t, JSON.parse(d).k?.x); });
ws1.on('error', (e) => console.log('Spot error:', e.message));
ws1.on('close', (c,r) => console.log('Spot closed:', c, r?.toString()));

// Test REST API
console.log('Test REST API...');
try {
  const res = await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=5');
  const data = await res.json();
  console.log('REST API works! Got', data.length, 'klines. Latest openTime:', data[data.length-1][0]);
} catch (e) {
  console.log('REST API error:', e.message);
}

setTimeout(() => {
  console.log(`Spot WS messages: ${c1}`);
  ws1.close();
  process.exit(0);
}, 15000);
