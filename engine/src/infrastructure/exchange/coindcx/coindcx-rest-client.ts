import { createHmac } from "crypto";
import { request as httpsRequest } from "https";

const API_HOST = "api.coindcx.com";

export interface CoinDCXCredentials {
  apiKey: string;
  apiSecret: string;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function cdxPost<T>(
  creds: CoinDCXCredentials,
  path: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const payload = { ...body, timestamp: Date.now() };
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  const signature = sign(json, creds.apiSecret);

  const res = await fetch(`https://${API_HOST}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": creds.apiKey,
      "X-AUTH-SIGNATURE": signature,
    },
    body: json,
  });
  if (!res.ok) throw new Error(`CoinDCX POST ${path} failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** CoinDCX GET with body — uses Node https module as fetch blocks GET+body */
export function cdxGet<T>(
  creds: CoinDCXCredentials,
  path: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = { ...body, timestamp: Date.now() };
    const json = JSON.stringify(payload);
    const signature = sign(json, creds.apiSecret);
    const [pathname] = path.split("?");
    const opts = {
      hostname: API_HOST,
      path: pathname,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-APIKEY": creds.apiKey,
        "X-AUTH-SIGNATURE": signature,
        "Content-Length": Buffer.byteLength(json),
      },
    };
    const req = httpsRequest(opts, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`CoinDCX GET ${path} failed (${res.statusCode}): ${data}`));
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
