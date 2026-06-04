import WebSocket from "ws";
import { createHmac } from "crypto";
import { EventEmitter } from "events";

/**
 * Delta Exchange India WebSocket client
 * Endpoint: wss://socket.india.delta.exchange
 * Auth: sign("GET" + timestamp + "/live") with HMAC-SHA256
 */

const WS_URL = process.env.DELTA_WS_URL ?? "wss://socket.india.delta.exchange";

export interface DeltaWsCredentials {
  apiKey: string;
  apiSecret: string;
}

export type DeltaWsChannel =
  | `v2/ticker/${string}`           // mark price
  | `l2_orderbook/${string}`        // orderbook
  | `all_trades/${string}`          // public trades
  | `candlestick_1m/${string}`      // 1-min candles
  | "orders"                        // private orders
  | "fills"                         // private fills
  | "positions";                    // private positions

export class DeltaWsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1_000;
  private readonly maxDelay = 30_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private channels = new Set<DeltaWsChannel>();
  private _connected = false;

  constructor(private readonly creds?: DeltaWsCredentials) {
    super();
    this.setMaxListeners(100);
  }

  connect(): void {
    this.ws = new WebSocket(WS_URL);

    this.ws.on("open", () => {
      this._connected = true;
      this.reconnectDelay = 1_000;
      if (this.creds) this.authenticate();
      else this.resubscribeAll();
      this.emit("connected");
    });

    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        this.handleMessage(msg);
      } catch {
        // ignore
      }
    });

    this.ws.on("error", (err) => this.emit("error", err));

    this.ws.on("close", () => {
      this._connected = false;
      this.emit("disconnected");
      this.scheduleReconnect();
    });

    // Heartbeat every 25s
    const hb = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: "heartbeat" });
      } else {
        clearInterval(hb);
      }
    }, 25_000);
  }

  private authenticate(): void {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", this.creds!.apiSecret)
      .update(`GET${timestamp}/live`)
      .digest("hex");

    this.send({
      type: "auth",
      payload: {
        "api-key": this.creds!.apiKey,
        signature,
        timestamp,
      },
    });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    if (type === "success") {
      // auth success or subscribe success
      this.resubscribeAll();
      this.emit("authenticated");
      return;
    }

    if (type === "l2_orderbook") {
      this.emit("orderbook", msg);
      this.emit(`orderbook:${msg.symbol}`, msg);
    } else if (type === "all_trades") {
      this.emit("trades", msg);
      this.emit(`trades:${msg.symbol}`, msg);
    } else if (type === "v2/ticker") {
      this.emit("ticker", msg);
      this.emit(`ticker:${msg.symbol}`, msg);
    } else if (type === "candlestick_1m") {
      this.emit("candle", msg);
    } else if (type === "orders") {
      this.emit("orderUpdate", msg);
    } else if (type === "fills") {
      this.emit("fillReceived", msg);
    } else if (type === "positions") {
      this.emit("positionUpdate", msg);
    } else if (type === "heartbeat") {
      // acknowledged
    }
  }

  subscribe(channels: DeltaWsChannel[]): void {
    for (const c of channels) this.channels.add(c);
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: "subscribe", payload: { channels: channels.map((c) => ({ name: c })) } });
    }
  }

  unsubscribe(channels: DeltaWsChannel[]): void {
    for (const c of channels) this.channels.delete(c);
    this.send({ type: "unsubscribe", payload: { channels: channels.map((c) => ({ name: c })) } });
  }

  private resubscribeAll(): void {
    if (this.channels.size === 0) return;
    this.send({
      type: "subscribe",
      payload: { channels: [...this.channels].map((c) => ({ name: c })) },
    });
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this._connected;
  }
}
