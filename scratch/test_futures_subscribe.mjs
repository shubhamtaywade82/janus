import WebSocket from 'ws';

// Test 1: Production with explicit SUBSCRIBE message (no URL streams)
const ws1 = new WebSocket('wss://fstream.binance.com/ws');
let c1 = 0;
ws1.on('open', () => {
  console.log('[prod-ws] OPENED, sending SUBSCRIBE...');
  ws1.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['btcusdt@kline_1m'], id: 1 }));
});
ws1.on('message', (d) => {
  c1++;
  const txt = d.toString();
  if (c1 <= 5) console.log(`[prod-ws] MSG ${c1}:`, txt.slice(0, 120));
});
ws1.on('error', (e) => console.log('[prod-ws] ERROR:', e.message));
ws1.on('close', (c, r) => console.log(`[prod-ws] CLOSED: ${c} msgs=${c1}`));

// Test 2: Production combined with explicit SUBSCRIBE (URL streams ignored?)
const ws2 = new WebSocket('wss://fstream.binance.com/stream?streams=btcusdt@kline_1m');
let c2 = 0;
ws2.on('open', () => {
  console.log('[prod-combined] OPENED, NOT sending SUBSCRIBE (URL-based)...');
});
ws2.on('message', (d) => {
  c2++;
  const txt = d.toString();
  if (c2 <= 5) console.log(`[prod-combined] MSG ${c2}:`, txt.slice(0, 120));
});
ws2.on('error', (e) => console.log('[prod-combined] ERROR:', e.message));
ws2.on('close', (c, r) => console.log(`[prod-combined] CLOSED: ${c} msgs=${c2}`));

// Test 3: Testnet raw /ws with explicit SUBSCRIBE
const ws3 = new WebSocket('wss://stream.binancefuture.com/ws');
let c3 = 0;
ws3.on('open', () => {
  console.log('[testnet-ws] OPENED, sending SUBSCRIBE...');
  ws3.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['btcusdt@kline_1m'], id: 1 }));
});
ws3.on('message', (d) => {
  c3++;
  const txt = d.toString();
  if (c3 <= 5) console.log(`[testnet-ws] MSG ${c3}:`, txt.slice(0, 120));
});
ws3.on('error', (e) => console.log('[testnet-ws] ERROR:', e.message));
ws3.on('close', (c, r) => console.log(`[testnet-ws] CLOSED: ${c} msgs=${c3}`));

setTimeout(() => {
  console.log(`\nFINAL: prod-ws=${c1} prod-combined=${c2} testnet-ws=${c3}`);
  ws1.close(); ws2.close(); ws3.close();
  process.exit(0);
}, 20000);
