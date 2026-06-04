import { cdxPost } from "../coindcx-rest-client.js";
import type { CoinDCXCredentials } from "../coindcx-rest-client.js";
import { mapFill, toNative } from "../coindcx-mapper.js";
import type { Fill } from "../../../../domain/fills/fill.js";

export class CoinDCXFillClient {
  constructor(private readonly creds: CoinDCXCredentials) {}

  async fetchFills(symbol?: string, _since?: number): Promise<Fill[]> {
    const body: Record<string, unknown> = {
      status: "filled",
      margin_currency_short_name: ["USDT", "INR"],
    };
    if (symbol) body.market = toNative(symbol);

    const raw = await cdxPost<Record<string, unknown>[]>(
      this.creds,
      "/exchange/v1/derivatives/futures/orders",
      body
    );
    return raw.map((r) => mapFill(r, String(r.client_order_id ?? r.id)));
  }
}
