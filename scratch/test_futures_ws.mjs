import WebSocket from 'ws';

const tests = [
  { name: 'futures-combined', url: 'wss://fstream.binance.com/stream?streams=btcusdt@kline_1m' },
  { name: 'futures-single', url: 'wss://fstream.binance.com/ws/btcusdt@kline_1m' },
  { name: 'futures-single-443', url: 'wss://fstream.binance.com:443/ws/btcusdt@kline_1m' },
  { name: 'futures-combined-9443', url: 'wss://fstream.binance.com:9443/stream?streams=btcusdt@kline_1m' },
  { name: 'dstream', url: 'wss://dstream.binance.com/stream?streams=btcusdt@kline_1m' },
];

for (const t of tests) {
  const ws = new WebSocket(t.url);
  let count = 0;
  ws.on('open', () => console.log(`[${t.name}] opened`));
  ws.on('message', (d) => {
    count++;
    if (count === 1) {
      const parsed = JSON.parse(d);
      console.log(`[${t.name}] FIRST MESSAGE! stream=${parsed.stream || parsed.e || 'n/a'}`);
    }
  });
  ws.on('error', (e) => console.log(`[${t.name}] error: ${e.message}`));
  ws.on('close', (c,r) => console.log(`[${t.name}] closed: ${c} ${r?.toString() || ''}`));
  t.ws = ws;
  t.count = () => count;
}

setTimeout(() => {
  for (const t of tests) {
    console.log(`[${t.name}] total messages: ${t.count()}`);
    t.ws.close();
  }
  process.exit(0);
}, 20000);
