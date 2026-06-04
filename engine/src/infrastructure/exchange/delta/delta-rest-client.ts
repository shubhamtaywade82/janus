import { createHmac } from "crypto";

/**
 * Delta Exchange India REST client
 * Docs: https://docs.delta.exchange
 * India endpoint: https://cdn-ind.deltaex.org
 */

const BASE_URL = process.env.DELTA_BASE_URL ?? "https://cdn-ind.deltaex.org";

export interface DeltaCredentials {
  apiKey: string;
  apiSecret: string;
}

function sign(
  secret: string,
  method: string,
  path: string,
  queryString: string,
  body: string,
  timestamp: number
): string {
  const message = method + timestamp + path + queryString + body;
  return createHmac("sha256", secret).update(message).digest("hex");
}

export async function deltaRequest<T>(
  creds: DeltaCredentials,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  params?: Record<string, string>,
  body?: Record<string, unknown>
): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const queryString = params ? "?" + new URLSearchParams(params).toString() : "";
  const bodyStr = body ? JSON.stringify(body) : "";
  const signature = sign(creds.apiSecret, method, path, queryString, bodyStr, timestamp);

  const url = `${BASE_URL}${path}${queryString}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "api-key": creds.apiKey,
      "timestamp": String(timestamp),
      "signature": signature,
    },
    ...(bodyStr ? { body: bodyStr } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Delta API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as T;
}

export async function deltaPublicGet<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const queryString = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(`${BASE_URL}${path}${queryString}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Delta public GET ${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}
