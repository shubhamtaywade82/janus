import io from "socket.io-client";
import { createHmac } from "crypto";
import { EventEmitter } from "events";

const WS_URL = "wss://stream.coindcx.com";

export interface CoinDCXWsCredentials {
  apiKey: string;
  apiSecret: string;
}

function sign(secret: string, body: Record<string, unknown>): string {
  return createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
}

function parse(raw: unknown): unknown {
  if (typeof (raw as any)?.data === "string") {
    try { return JSON.parse((raw as any).data); } catch { return raw; }
  }
  return (raw as any)?.data ?? raw;
}

export class CoinDCXWsClient extends EventEmitter {
  private socket: ReturnType<typeof io> | null = null;
  private authenticated = false;

  constructor(private readonly creds: CoinDCXWsCredentials) {
    super();
    this.setMaxListeners(50);
  }

  connect(): void {
    this.socket = io(WS_URL, {
      transports: ["websocket"],
      upgrade: false,
      rejectUnauthorized: false,
    });

    this.socket.on("connect", () => {
      const body = { channel: "coindcx" };
      this.socket!.emit("join", {
        channelName: "coindcx",
        authSignature: sign(this.creds.apiSecret, body),
        apiKey: this.creds.apiKey,
      });
    });

    this.socket.on("joined", () => {
      this.authenticated = true;
      // subscribe mark price + per-pair futures channels
      this.socket!.emit("join", { channelName: "currentPrices@futures@rt" });
      this.emit("authenticated");
    });

    // Position updates
    this.socket.on("df-position-update", (raw: unknown) => {
      const parsed = parse(raw);
      const list = Array.isArray(parsed) ? parsed : (parsed as any)?.data ?? [];
      this.emit("positionUpdate", list);
    });

    // Order updates
    this.socket.on("df-order-update", (raw: unknown) => {
      const parsed = parse(raw);
      this.emit("orderUpdate", parsed);
    });

    // Balance updates
    this.socket.on("balance-update", (raw: unknown) => {
      const parsed = parse(raw);
      const list = Array.isArray(parsed) ? parsed : (parsed as any)?.data ?? [];
      this.emit("balanceUpdate", list);
    });

    // Mark prices
    this.socket.on("currentPrices@futures#update", (raw: unknown) => {
      const parsed = parse(raw);
      const prices = (parsed as any)?.prices ?? {};
      this.emit("markPrices", prices);
    });

    this.socket.on("error", (err: unknown) => this.emit("error", err));
    this.socket.on("disconnect", (reason: string) => {
      this.authenticated = false;
      this.emit("disconnected", reason);
    });
  }

  subscribePublicPair(nativePair: string): void {
    this.socket?.emit("join", { channelName: `${nativePair}@prices-futures` });
    this.socket?.emit("join", { channelName: `${nativePair}_1m-futures` });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  get isAuthenticated(): boolean {
    return this.authenticated;
  }
}
