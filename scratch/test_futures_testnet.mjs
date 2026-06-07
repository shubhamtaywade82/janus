import WebSocket from 'ws';

// Test testnet
const url1 = 'wss://stream.binancefuture.com/stream?streams=btcusdt@kline_1m';
console.log('Test testnet:', url1);
const ws1 = new WebSocket(url1);
let c1 = 0;
ws1.on('open', () => console.log('Testnet opened'));
ws1.on('message', (d) => { c1++; if (c1<=3) console.log('Testnet msg:', JSON.parse(d).stream, JSON.parse(d).data?.k?.t); });
ws1.on('error', (e) => console.log('Testnet error:', e.message));
ws1.on('close', (c,r) => console.log('Testnet closed:', c, r?.toString()));

// Try with origin header (some CDNs require this)
const url2 = 'wss://fstream.binance.com/stream?streams=btcusdt@kline_1m';
console.log('Test with origin:', url2);
const ws2 = new WebSocket(url2, { origin: 'https://www.binance.com' });
let c2 = 0;
ws2.on('open', () => console.log('Origin opened'));
ws2.on('message', (d) => { c2++; if (c2<=3) console.log('Origin msg:', JSON.parse(d).stream, JSON.parse(d).data?.k?.t); });
ws2.on('error', (e) => console.log('Origin error:', e.message));
ws2.on('close', (c,r) => console.log('Origin closed:', c, r?.toString()));

setTimeout(() => {
  console.log(`Results: testnet=${c1} origin=${c2}`);
  ws1.close(); ws2.close();
  process.exit(0);
}, 15000);
