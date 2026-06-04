export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

class ConsoleLogger implements Logger {
  constructor(private readonly bindings: Record<string, unknown> = {}) {}

  private format(level: string, msg: string, meta?: Record<string, unknown>): string {
    const ts = new Date().toISOString();
    const context = { ...this.bindings, ...meta };
    const ctxStr = Object.keys(context).length ? " " + JSON.stringify(context) : "";
    return `${ts} [${level.toUpperCase()}] ${msg}${ctxStr}`;
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    if (process.env.LOG_LEVEL === "debug") console.debug(this.format("debug", msg, meta));
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    console.info(this.format("info", msg, meta));
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    console.warn(this.format("warn", msg, meta));
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    console.error(this.format("error", msg, meta));
  }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger({ ...this.bindings, ...bindings });
  }
}

export const logger: Logger = new ConsoleLogger({ service: "janus-engine" });
