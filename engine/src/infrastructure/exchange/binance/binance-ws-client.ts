import WebSocket from "ws";
import { EventEmitter } from "events";

export interface BinanceWsMessage {
  stream: string;
  data: Record<string, unknown>;
}

export class BinanceWsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1_000;
  private readonly maxDelay = 30_000;
  private _connected = false;
  private readonly streams: Set<string> = new Set();

  /** wss://fstream.binance.com for USD-M futures */
  constructor(private readonly baseUrl: string = "wss://fstream.binance.com") {
    super();
  }

  subscribe(streams: string[]): void {
    for (const s of streams) this.streams.add(s);
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      this.send({ method: "SUBSCRIBE", params: streams, id: Date.now() });
    }
  }

  connect(): void {
    const url = `${this.baseUrl}/stream?streams=${[...this.streams].join("/")}`;
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this._connected = true;
      this.reconnectDelay = 1_000;
      this.emit("connected");
    });

    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as BinanceWsMessage;
        if (msg.stream && msg.data) {
          this.emit("message", msg);
          this.emit(`stream:${msg.stream}`, msg.data);
        }
      } catch {
        // ignore parse errors
      }
    });

    this.ws.on("error", (err) => {
      this.emit("error", err);
    });

    this.ws.on("close", () => {
      this._connected = false;
      this.emit("disconnected");
      this.scheduleReconnect();
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
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

  get connected(): boolean {
    return this._connected;
  }
}
