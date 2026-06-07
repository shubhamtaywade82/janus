import WebSocket from 'ws';

const symbols = ['btcusdt', 'ethusdt'];
const streams = symbols.map(s => `${s}@kline_1m`).join('/');
const url = `wss://fstream.binance.com/stream?streams=${streams}`;

console.log('Connecting to:', url);
const ws = new WebSocket(url);

let msgCount = 0;
const startTime = Date.now();

ws.on('open', () => {
  console.log('WS opened');
});

ws.on('message', (data) => {
  msgCount++;
  const { stream, data: kdata } = JSON.parse(data);
  if (stream.includes('@kline_1m')) {
    const k = kdata.k;
    if (k.x || msgCount <= 5) {
      console.log(`[${stream}] openTime=${k.t} isClosed=${k.x} close=${k.c} msgs=${msgCount} elapsed=${Date.now()-startTime}ms`);
    }
  }
  if (msgCount === 1) {
    console.log('First message received!');
  }
});

ws.on('error', (err) => {
  console.error('WS error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log('WS closed:', code, reason?.toString());
});

setTimeout(() => {
  console.log(`Total messages in 30s: ${msgCount}`);
  ws.close();
  process.exit(0);
}, 30000);
