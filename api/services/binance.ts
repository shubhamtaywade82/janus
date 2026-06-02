/**
 * Binance API Service
 * Provides real-time market data from Binance's public REST API
 * Used for the public feed in the dual-feed Janus architecture
 */

const BINANCE_API_BASE = "https://fapi.binance.com";
const BINANCE_WS_BASE = "wss://fstream.binance.com/ws";

// ─── Types ───
export interface BinanceKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  trades: number;
}

export interface BinanceTicker24h {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  lastPrice: string;
  lastQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  count: number;
}

export interface BinanceOrderBook {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface BinanceRecentTrade {
  id: number;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
  isBestMatch: boolean;
}

export interface BinanceAggTrade {
  a: number; // Aggregate tradeId
  p: string; // Price
  q: string; // Quantity
  f: number; // First tradeId
  l: number; // Last tradeId
  T: number; // Timestamp
  m: boolean; // Was the buyer the maker?
}

// ─── Circuit Breaker ───
// HTTP 418 = Binance IP ban. Block ALL REST calls for ban duration to avoid
// making the ban worse. Binance bans escalate: 2min → 5min → longer.

class BinanceCircuitBreaker {
  private bannedUntil = 0;
  private banCount = 0;

  isBanned(): boolean {
    return Date.now() < this.bannedUntil;
  }

  onBanReceived() {
    this.banCount++;
    // Escalating ban duration: 2min → 5min → 10min
    const durationMs = Math.min(2 * 60_000 * Math.pow(2, this.banCount - 1), 10 * 60_000);
    this.bannedUntil = Date.now() + durationMs;
    const mins = (durationMs / 60_000).toFixed(0);
    console.error(`[binance] IP ban (418) received. Blocking REST for ${mins}min (ban #${this.banCount})`);
  }

  onSuccess() {
    if (this.banCount > 0) {
      console.log("[binance] REST calls restored after ban period");
      this.banCount = 0;
    }
  }

  checkOrThrow() {
    if (this.isBanned()) {
      const secsLeft = Math.ceil((this.bannedUntil - Date.now()) / 1000);
      throw new Error(`Binance REST banned — ${secsLeft}s remaining`);
    }
  }
}

export const binanceCircuitBreaker = new BinanceCircuitBreaker();

async function binanceFetch(url: string, errorPrefix: string): Promise<any> {
  binanceCircuitBreaker.checkOrThrow();
  const res = await fetch(url);
  if (res.status === 418 || res.status === 429) {
    binanceCircuitBreaker.onBanReceived();
    throw new Error(`${errorPrefix}: ${res.status}`);
  }
  if (!res.ok) throw new Error(`${errorPrefix}: ${res.status}`);
  binanceCircuitBreaker.onSuccess();
  return res.json();
}

// ─── REST API Functions ───

export async function fetchKlines(
  symbol: string,
  interval: string = "1m",
  limit: number = 150
): Promise<BinanceKline[]> {
  const url = `${BINANCE_API_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const data = await binanceFetch(url, "Binance klines error") as any[];
  return data.map((d: any[]) => ({
    openTime: d[0],
    open: d[1],
    high: d[2],
    low: d[3],
    close: d[4],
    volume: d[5],
    closeTime: d[6],
    quoteVolume: d[7],
    trades: d[8],
  }));
}

export async function fetch24hTicker(symbol?: string): Promise<BinanceTicker24h | BinanceTicker24h[]> {
  const url = symbol
    ? `${BINANCE_API_BASE}/fapi/v1/ticker/24hr?symbol=${symbol}`
    : `${BINANCE_API_BASE}/fapi/v1/ticker/24hr`;
  return binanceFetch(url, "Binance 24h ticker error");
}

export async function fetchOrderBook(
  symbol: string,
  limit: number = 100
): Promise<BinanceOrderBook> {
  const url = `${BINANCE_API_BASE}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`;
  return binanceFetch(url, "Binance depth error");
}

export async function fetchRecentTrades(
  symbol: string,
  limit: number = 50
): Promise<BinanceRecentTrade[]> {
  const url = `${BINANCE_API_BASE}/fapi/v1/trades?symbol=${symbol}&limit=${limit}`;
  return binanceFetch(url, "Binance trades error");
}

export async function fetchAggTrades(
  symbol: string,
  limit: number = 50
): Promise<BinanceAggTrade[]> {
  const url = `${BINANCE_API_BASE}/fapi/v1/aggTrades?symbol=${symbol}&limit=${limit}`;
  const data = await binanceFetch(url, "Binance aggTrades error") as any[];
  return data.map((d: any) => ({
    a: d.a, p: d.p, q: d.q, f: d.f, l: d.l, T: d.T, m: d.m,
  }));
}

export async function fetchMarkPrice(symbol: string): Promise<{ markPrice: string; indexPrice: string; estimatedSettlePrice: string }> {
  const url = `${BINANCE_API_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`;
  return binanceFetch(url, "Binance mark price error");
}

export async function fetchFundingRate(symbol: string): Promise<{ fundingRate: string; fundingTime: number }> {
  const url = `${BINANCE_API_BASE}/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
  const data = await binanceFetch(url, "Binance funding rate error") as any[];
  return data[0];
}

// ─── WebSocket URL Generator ───
export function getBinanceWsUrl(streams: string[]): string {
  if (streams.length === 1) {
    return `${BINANCE_WS_BASE}/${streams[0]}`;
  }
  return `${BINANCE_WS_BASE}/stream?streams=${streams.join("/")}`;
}

// ─── Symbol Mapping ───
export function mapBinanceToCoinDCX(binanceSymbol: string): string {
  // e.g., "BTCUSDT" -> "B-BTC_USDT"
  const base = binanceSymbol.slice(0, -4);
  const quote = binanceSymbol.slice(-4);
  return `B-${base}_${quote}`;
}

export function mapCoinDCXToBinance(coindcxSymbol: string): string {
  // e.g., "B-BTC_USDT" -> "BTCUSDT"
  return coindcxSymbol.replace("B-", "").replace("_", "");
}

// ─── Supported Pairs ───
export const SUPPORTED_PAIRS = [
  { binance: "BTCUSDT", coindcx: "B-BTC_USDT", name: "Bitcoin" },
  { binance: "ETHUSDT", coindcx: "B-ETH_USDT", name: "Ethereum" },
  { binance: "SOLUSDT", coindcx: "B-SOL_USDT", name: "Solana" },
  { binance: "BNBUSDT", coindcx: "B-BNB_USDT", name: "BNB" },
  { binance: "XRPUSDT", coindcx: "B-XRP_USDT", name: "XRP" },
  { binance: "ADAUSDT", coindcx: "B-ADA_USDT", name: "Cardano" },
  { binance: "DOGEUSDT", coindcx: "B-DOGE_USDT", name: "Dogecoin" },
  { binance: "AVAXUSDT", coindcx: "B-AVAX_USDT", name: "Avalanche" },
];
