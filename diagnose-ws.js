const WebSocket = require('ws');

const symbols = ['BTCUSDT', 'ETHUSDT'];
const host = 'fstream.binance.com';

for (const symbol of symbols) {
  const s = symbol.toLowerCase();
  const url = `wss://${host}/stream?streams=${s}@kline_1m`;
  console.log(`[test] Connecting to ${url}`);

  const ws = new WebSocket(url);
  let msgCount = 0;
  const startTime = Date.now();

  ws.on('open', () => {
    console.log(`[test] ${symbol} WS OPEN`);
  });

  ws.on('message', (data) => {
    msgCount++;
    try {
      const { stream, data: kdata } = JSON.parse(data.toString());
      if (stream.endsWith('@kline_1m')) {
        const k = kdata.k;
        console.log(`[test] ${symbol} kline msg #${msgCount}: openTime=${k.t} isClosed=${k.x} close=${k.c} elapsed=${Date.now()-startTime}ms`);
        if (msgCount >= 3) {
          console.log(`[test] ${symbol} received ${msgCount} messages successfully — WS is working`);
          ws.close();
        }
      }
    } catch (e) {
      console.log(`[test] ${symbol} parse error:`, e.message);
    }
  });

  ws.on('error', (err) => {
    console.error(`[test] ${symbol} WS ERROR:`, err.message);
  });

  ws.on('close', (code, reason) => {
    console.log(`[test] ${symbol} WS CLOSED: code=${code} reason=${reason} totalMsgs=${msgCount}`);
  });
}

setTimeout(() => {
  console.log('[test] Timeout — exiting after 15s');
  process.exit(1);
}, 15000);
