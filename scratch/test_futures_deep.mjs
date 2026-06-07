import WebSocket from 'ws';

const tests = [
  { name: 'futures-combined', url: 'wss://fstream.binance.com/stream?streams=btcusdt@kline_1m' },
  { name: 'futures-single', url: 'wss://fstream.binance.com/ws/btcusdt@kline_1m' },
  { name: 'futures-single-443', url: 'wss://fstream.binance.com:443/ws/btcusdt@kline_1m' },
  { name: 'futures-combined-9443', url: 'wss://fstream.binance.com:9443/stream?streams=btcusdt@kline_1m' },
  { name: 'dstream', url: 'wss://dstream.binance.com/stream?streams=btcusd@kline_1m' },
  { name: 'testnet', url: 'wss://stream.binancefuture.com/stream?streams=btcusdt@kline_1m' },
];

for (const t of tests) {
  const ws = new WebSocket(t.url);
  let count = 0;
  let openTime = null;
  
  ws.on('open', () => {
    openTime = Date.now();
    console.log(`[${t.name}] OPENED (readyState=${ws.readyState})`);
  });
  
  ws.on('message', (d) => {
    count++;
    try {
      const parsed = JSON.parse(d);
      if (count === 1) {
        console.log(`[${t.name}] FIRST MSG at ${Date.now() - openTime}ms:`, JSON.stringify(parsed).slice(0, 120));
      }
    } catch (e) {
      console.log(`[${t.name}] RAW MSG (${d.length}b):`, d.toString().slice(0, 80));
    }
  });
  
  ws.on('ping', (d) => {
    console.log(`[${t.name}] PING received`);
    ws.pong(d);
  });
  
  ws.on('pong', () => {
    console.log(`[${t.name}] PONG received`);
  });
  
  ws.on('error', (e) => {
    console.log(`[${t.name}] ERROR: ${e.message}`);
  });
  
  ws.on('close', (code, reason) => {
    console.log(`[${t.name}] CLOSED code=${code} reason="${reason?.toString() || ''}" after ${openTime ? Date.now() - openTime : 'N/A'}ms`);
  });
  
  t.ws = ws;
  t.count = () => count;
}

setTimeout(() => {
  for (const t of tests) {
    console.log(`[${t.name}] SUMMARY: msgs=${t.count()} readyState=${t.ws.readyState}`);
    t.ws.terminate();
  }
  process.exit(0);
}, 30000);
