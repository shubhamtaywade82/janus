/**
 * CoinDCX Authenticated Client
 * HMAC-SHA256 signature-based authentication for CoinDCX REST API
 * Used for the private execution feed in the dual-feed Janus architecture
 */

import { createHmac } from "crypto";
import { request as httpsRequest } from "https";

const COINDCX_API_HOST = "api.coindcx.com";
const COINDCX_PUBLIC_HOST = "public.coindcx.com";

// ─── USDT/INR Conversion Rate Cache ───
let cachedConversionRate = 89.0; // default fallback from CoinDCX docs
let conversionRateLastFetched = 0;
const CONVERSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getUsdtInrRate(): Promise<number> {
  const now = Date.now();
  if (now - conversionRateLastFetched < CONVERSION_CACHE_TTL_MS) {
    return cachedConversionRate;
  }
  try {
    const res = await fetch("https://api.coindcx.com/exchange/ticker");
    if (res.ok) {
      const tickers: any[] = await res.json();
      const usdtInr = tickers.find((t: any) => t.market === "USDTINR");
      if (usdtInr && usdtInr.last_price) {
        cachedConversionRate = parseFloat(usdtInr.last_price);
        conversionRateLastFetched = now;
        console.log(`[coindcx] USDT/INR rate updated: ${cachedConversionRate}`);
      }
    }
  } catch (err) {
    console.error("[coindcx] Failed to fetch USDT/INR rate, using cached:", cachedConversionRate);
  }
  return cachedConversionRate;
}

// ─── Types ───
export interface CoinDCXCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface CoinDCXOrderRequest {
  market: string;
  side: "buy" | "sell";
  order_type: "market" | "limit" | "stop_limit";
  total_quantity: number;
  price?: number;
  trigger_price?: number;
  client_order_id?: string;
}

export interface CoinDCXOrderResponse {
  id: string;
  client_order_id: string;
  market: string;
  side: string;
  order_type: string;
  status: string;
  total_quantity: string;
  remaining_quantity: string;
  price: string;
  created_at: string;
}

// ─── HMAC-SHA256 Signature Generator ───
function generateSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function getTimestamp(): number {
  return Date.now();
}

// ─── Authenticated Request Helper (POST) ───
async function authenticatedRequest<T>(
  credentials: CoinDCXCredentials,
  path: string,
  body: Record<string, any> = {}
): Promise<T> {
  const timestamp = getTimestamp();
  const payload = { ...body, timestamp };

  // Compact JSON - NO SPACES (critical for signature validity)
  const compactJson = JSON.stringify(payload, Object.keys(payload).sort());
  const signature = generateSignature(compactJson, credentials.apiSecret);

  const url = `https://${COINDCX_API_HOST}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": credentials.apiKey,
      "X-AUTH-SIGNATURE": signature,
    },
    body: compactJson,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`CoinDCX API error (${res.status}): ${error}`);
  }

  return res.json() as Promise<T>;
}

// ─── Authenticated GET-with-body Helper ───
// CoinDCX uses GET+body (via Node 'request' lib). fetch API blocks this.
// Use Node's https module directly to bypass the restriction.
function authenticatedGetRequest<T>(
  credentials: CoinDCXCredentials,
  path: string,
  body: Record<string, any> = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timestamp = getTimestamp();
    const payload = { ...body, timestamp };
    const json = JSON.stringify(payload);
    const signature = generateSignature(json, credentials.apiSecret);

    // Strip query string from path for hostname options
    const [pathname, search] = path.split("?");
    const fullPath = search ? `${pathname}?${search}` : pathname;

    const options = {
      hostname: COINDCX_API_HOST,
      path: fullPath,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-APIKEY": credentials.apiKey,
        "X-AUTH-SIGNATURE": signature,
        "Content-Length": Buffer.byteLength(json),
      },
    };

    const req = httpsRequest(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`CoinDCX API error (${res.statusCode}): ${data}`));
        } else {
          try { resolve(JSON.parse(data)); } catch { reject(new Error(`Invalid JSON: ${data}`)); }
        }
      });
    });

    req.on("error", reject);
    req.write(json);
    req.end();
  });
}

// ─── Public Request Helper ───

async function publicRequest<T>(path: string, params?: Record<string, string>): Promise<T> {
  const query = params ? "?" + new URLSearchParams(params).toString() : "";
  const url = `https://${COINDCX_PUBLIC_HOST}${path}${query}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinDCX public API error: ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Account Operations ───
export async function getBalances(credentials: CoinDCXCredentials): Promise<any[]> {
  return authenticatedRequest<any[]>(credentials, "/exchange/v1/users/balances");
}

export async function getUserInfo(credentials: CoinDCXCredentials): Promise<any> {
  return authenticatedRequest<any>(credentials, "/exchange/v1/users/info");
}

// ─── Order Operations ───
export async function createOrder(
  credentials: CoinDCXCredentials,
  order: CoinDCXOrderRequest
): Promise<CoinDCXOrderResponse> {
  return authenticatedRequest<CoinDCXOrderResponse>(
    credentials,
    "/exchange/v1/orders/create",
    order as Record<string, any>
  );
}

export async function cancelOrder(
  credentials: CoinDCXCredentials,
  orderId: string,
  market: string
): Promise<any> {
  return authenticatedRequest<any>(credentials, "/exchange/v1/orders/cancel", {
    id: orderId,
    market,
    timestamp: getTimestamp(),
  });
}

export async function getActiveOrders(
  credentials: CoinDCXCredentials,
  market?: string,
  side?: string,
  status?: string
): Promise<any[]> {
  const body: Record<string, any> = { timestamp: getTimestamp() };
  if (market) body.market = market;
  if (side) body.side = side;
  if (status) body.status = status;
  return authenticatedRequest<any[]>(credentials, "/exchange/v1/orders/active_orders", body);
}

export async function getOrderStatus(
  credentials: CoinDCXCredentials,
  orderId: string
): Promise<any> {
  return authenticatedRequest<any>(credentials, "/exchange/v1/orders/status", {
    id: orderId,
    timestamp: getTimestamp(),
  });
}

// ─── Market Data (Public) ───
export async function getCoinDCXCandles(
  market: string,
  interval: string = "1m",
  limit: number = 100
): Promise<any[]> {
  return publicRequest<any[]>("/market_data/candles", {
    pair: market,
    interval,
    limit: String(limit),
  });
}

export async function getCoinDCXTicker(market?: string): Promise<any> {
  const url = "https://api.coindcx.com/exchange/ticker";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinDCX ticker API error: ${res.status}`);
  const data = await res.json();
  if (market && Array.isArray(data)) {
    return data.find((t: any) => t.market === market);
  }
  return data;
}

// ─── Futures Operations ───
export async function getFuturesPositions(credentials: CoinDCXCredentials): Promise<any[]> {
  return authenticatedRequest<any[]>(credentials, "/exchange/v1/derivatives/futures/positions");
}

export async function createFuturesOrder(
  credentials: CoinDCXCredentials,
  order: {
    market: string;
    side: "buy" | "sell";
    order_type: "market" | "limit";
    total_quantity: number;
    price?: number;
    leverage?: number;
  }
): Promise<any> {
  return authenticatedRequest<any>(
    credentials,
    "/exchange/v1/derivatives/futures/orders/create",
    { ...order, timestamp: getTimestamp() }
  );
}

// ─── Futures Wallet ───
export async function getFuturesWallet(
  credentials: CoinDCXCredentials,
  marginCurrency?: "USDT" | "INR"
): Promise<any[]> {
  const wallets = await authenticatedGetRequest<any[]>(credentials, "/exchange/v1/derivatives/futures/wallets");
  if (marginCurrency) return wallets.filter((w: any) => w.currency_short_name === marginCurrency);
  return wallets;
}

// ─── Futures Wallet Transactions ───
export async function getFuturesWalletTransactions(
  credentials: CoinDCXCredentials,
  page = 1,
  size = 100
): Promise<any[]> {
  return authenticatedGetRequest<any[]>(
    credentials,
    `/exchange/v1/derivatives/futures/wallets/transactions?page=${page}&size=${size}`
  );
}

// ─── Cross Margin Details ───
export async function getCrossMarginDetails(credentials: CoinDCXCredentials): Promise<any> {
  return authenticatedRequest<any>(credentials, "/exchange/v1/derivatives/futures/cross_margin_details", {
    timestamp: getTimestamp(),
  });
}

// ─── Wallet Transfer (Spot <-> Futures) ───
export async function walletTransfer(
  credentials: CoinDCXCredentials,
  params: {
    currency_short_name: string;
    amount: number;
    from_wallet: "spot" | "futures";
    to_wallet: "spot" | "futures";
  }
): Promise<any> {
  return authenticatedRequest<any>(credentials, "/exchange/v1/derivatives/futures/wallet_transfer", {
    ...params,
    timestamp: getTimestamp(),
  });
}

// ─── Add / Remove Margin ───
export async function addRemoveMargin(
  credentials: CoinDCXCredentials,
  params: {
    position_id: string;
    amount: number;
    type: "add" | "remove";
  }
): Promise<any> {
  return authenticatedRequest<any>(credentials, "/exchange/v1/derivatives/futures/positions/add_remove_margin", {
    ...params,
    timestamp: getTimestamp(),
  });
}

// ─── List Futures Orders ───
export async function getFuturesOrders(
  credentials: CoinDCXCredentials,
  params?: {
    status?: "open" | "closed" | "cancelled";
    margin_currency_short_name?: ("USDT" | "INR")[];
    market?: string;
  }
): Promise<any[]> {
  const body: Record<string, any> = { timestamp: getTimestamp() };
  if (params?.status) body.status = params.status;
  if (params?.margin_currency_short_name) body.margin_currency_short_name = params.margin_currency_short_name;
  if (params?.market) body.market = params.market;
  return authenticatedRequest<any[]>(credentials, "/exchange/v1/derivatives/futures/orders", body);
}

// ─── Margin Ratio Calculator ───
export function calculateMarginRatio(maintenanceMargin: number, equity: number): number {
  if (equity <= 0) return Infinity;
  return maintenanceMargin / equity;
}

// ─── Liquidation Price Calculator ───
export function calculateLiquidationPrice(
  entryPrice: number,
  margin: number,
  size: number,
  side: "long" | "short",
  _leverage: number
): number {
  const maintenanceMarginRate = 0.005; // 0.5%
  const mm = entryPrice * size * maintenanceMarginRate;
  if (side === "long") {
    return entryPrice * (1 - (margin - mm) / (entryPrice * size));
  } else {
    return entryPrice * (1 + (margin - mm) / (entryPrice * size));
  }
}

// ─── Currency Conversion ───
// NOTE: CoinDCX /api/v1/derivatives/futures/data/conversions requires HFT API access.
// We derive the same rate from the public USDTINR market ticker instead.
export async function getCurrencyConversions(_credentials?: CoinDCXCredentials): Promise<any[]> {
  const rate = await getUsdtInrRate();
  return [
    {
      symbol: "USDTINR",
      margin_currency_short_name: "INR",
      target_currency_short_name: "USDT",
      conversion_price: rate,
      last_updated_at: conversionRateLastFetched || Date.now(),
    },
  ];
}
