import { cdxPost, cdxGet } from "../coindcx-rest-client.js";
import type { CoinDCXCredentials } from "../coindcx-rest-client.js";
import { mapBalance, mapPosition } from "../coindcx-mapper.js";
import type { BalanceSnapshot, PositionSnapshot } from "../../../../application/ports/exchange-gateway.port.js";

export class CoinDCXPositionClient {
  constructor(private readonly creds: CoinDCXCredentials) {}

  async fetchBalances(): Promise<BalanceSnapshot[]> {
    const raw = await cdxGet<Record<string, unknown>[]>(
      this.creds,
      "/exchange/v1/derivatives/futures/wallets"
    );
    return raw.map(mapBalance);
  }

  async fetchPositions(_symbol?: string): Promise<PositionSnapshot[]> {
    const raw = await cdxPost<Record<string, unknown>[]>(
      this.creds,
      "/exchange/v1/derivatives/futures/positions",
      { margin_currency_short_name: ["INR", "USDT"] }
    );
    return raw.map(mapPosition);
  }
}
