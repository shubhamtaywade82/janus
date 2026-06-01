/**
 * CoinDCX Authenticated Client
 * HMAC-SHA256 signature-based authentication for CoinDCX REST API
 * Used for the private execution feed in the dual-feed Janus architecture
 */

import { createHmac } from "crypto";

const COINDCX_API_HOST = "api.coindcx.com";
const COINDCX_PUBLIC_HOST = "public.coindcx.com";

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

// ─── Authenticated Request Helper ───
async function authenticatedRequest<T>(
  credentials: CoinDCXCredentials,
  path: string,
  body: Record<string, any> = {}
): Promise<T> {
  const timestamp = getTimestamp();
  const payload = {
    ...body,
    timestamp,
  };

  // Compact JSON - NO SPACES (critical for signature validity)
  const compactJson = JSON.stringify(payload, Object.keys(payload).sort());
  const signature = generateSignature(compactJson, credentials.apiSecret);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-AUTH-APIKEY": credentials.apiKey,
    "X-AUTH-SIGNATURE": signature,
  };

  const url = `https://${COINDCX_API_HOST}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: compactJson,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`CoinDCX API error (${res.status}): ${error}`);
  }

  return res.json() as Promise<T>;
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
  return publicRequest<any>("/market_data/ticker", market ? { market } : undefined);
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
