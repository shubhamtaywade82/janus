import WebSocket from 'ws';

// Test single stream
const url1 = 'wss://fstream.binance.com/ws/btcusdt@kline_1m';
console.log('Test 1 - Single stream:', url1);
const ws1 = new WebSocket(url1);
let c1 = 0;
ws1.on('open', () => console.log('T1 opened'));
ws1.on('message', (d) => { c1++; if (c1<=3) console.log('T1 msg:', JSON.parse(d).k?.t, JSON.parse(d).k?.x); });
ws1.on('error', (e) => console.log('T1 error:', e.message));
ws1.on('close', (c,r) => console.log('T1 closed:', c, r?.toString()));

// Test combined stream
const url2 = 'wss://fstream.binance.com/stream?streams=btcusdt@kline_1m';
console.log('Test 2 - Combined stream:', url2);
const ws2 = new WebSocket(url2);
let c2 = 0;
ws2.on('open', () => console.log('T2 opened'));
ws2.on('message', (d) => { c2++; if (c2<=3) console.log('T2 msg:', JSON.parse(d).stream, JSON.parse(d).data?.k?.t); });
ws2.on('error', (e) => console.log('T2 error:', e.message));
ws2.on('close', (c,r) => console.log('T2 closed:', c, r?.toString()));

// Test with headers
const url3 = 'wss://fstream.binance.com/stream?streams=btcusdt@kline_1m';
console.log('Test 3 - With headers:', url3);
const ws3 = new WebSocket(url3, { headers: { 'User-Agent': 'Mozilla/5.0' } });
let c3 = 0;
ws3.on('open', () => console.log('T3 opened'));
ws3.on('message', (d) => { c3++; if (c3<=3) console.log('T3 msg:', JSON.parse(d).stream, JSON.parse(d).data?.k?.t); });
ws3.on('error', (e) => console.log('T3 error:', e.message));
ws3.on('close', (c,r) => console.log('T3 closed:', c, r?.toString()));

setTimeout(() => {
  console.log(`Results: T1=${c1} T2=${c2} T3=${c3}`);
  ws1.close(); ws2.close(); ws3.close();
  process.exit(0);
}, 15000);
