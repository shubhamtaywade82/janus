import WebSocket from 'ws';

const configs = [
  { name: 'default', headers: {} },
  { name: 'user-agent', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } },
  { name: 'origin', headers: { 'Origin': 'https://www.binance.com' } },
  { name: 'both', headers: { 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://www.binance.com' } },
  { name: 'referer', headers: { 'Referer': 'https://www.binance.com/en/futures/BTCUSDT' } },
];

for (const cfg of configs) {
  const ws = new WebSocket('wss://fstream.binance.com/stream?streams=btcusdt@kline_1m', { headers: cfg.headers });
  let count = 0;
  let timer = null;
  
  ws.on('open', () => {
    console.log(`[${cfg.name}] OPENED`);
    // Send a subscribe message just in case
    ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['btcusdt@kline_1m'], id: 1 }));
    timer = setTimeout(() => {
      console.log(`[${cfg.name}] TIMEOUT: ${count} msgs after 15s`);
      ws.close();
    }, 15000);
  });
  
  ws.on('message', (d) => {
    count++;
    if (count <= 3) {
      console.log(`[${cfg.name}] MSG ${count}:`, d.toString().slice(0, 100));
    }
  });
  
  ws.on('error', (e) => console.log(`[${cfg.name}] ERROR: ${e.message}`));
  ws.on('close', (c, r) => {
    if (timer) clearTimeout(timer);
    console.log(`[${cfg.name}] CLOSED: ${c} "${r?.toString() || ''}" msgs=${count}`);
  });
}

setTimeout(() => process.exit(0), 25000);
