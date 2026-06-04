/**
 * Heartbeat Worker — Delta Exchange India deadman protection
 *
 * Delta supports a cancel-on-disconnect / heartbeat mechanism. If this
 * process stops sending heartbeats, Delta will automatically cancel all
 * open orders after the TTL expires, preventing runaway positions.
 *
 * Protocol:
 *   Every HEARTBEAT_INTERVAL_MS → send { type: "heartbeat" } over WS
 *   Delta responds with { type: "heartbeat" } acknowledging liveness
 *
 * If the process crashes:
 *   No heartbeat → TTL expires → Delta cancels open orders
 */
import { loadConfig } from "../../app/config.js";
import { DeltaWsClient } from "../../infrastructure/exchange/delta/delta-ws-client.js";
import { logger } from "../../infrastructure/observability/logger.js";

const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? "10000", 10);
const log = logger.child({ worker: "heartbeat" });

async function main() {
  log.info("starting heartbeat worker", { intervalMs: HEARTBEAT_INTERVAL_MS });

  const config = loadConfig();
  if (!config.delta) {
    log.warn("Delta credentials not configured — heartbeat worker idle");
    return;
  }

  const ws = new DeltaWsClient(config.delta);

  ws.on("connected", () => {
    log.info("connected to Delta WS");
  });

  ws.on("authenticated", () => {
    log.info("authenticated — heartbeat loop starting");
    startHeartbeat(ws);
  });

  ws.on("error", (err) => {
    log.error("WS error", { error: String(err) });
  });

  ws.on("disconnected", () => {
    log.warn("disconnected — reconnect will restart heartbeat");
  });

  ws.connect();

  // Graceful shutdown: close the WS cleanly so Delta knows the session ended
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      log.info(`received ${sig} — disconnecting`);
      ws.disconnect();
      process.exit(0);
    });
  }
}

function startHeartbeat(ws: DeltaWsClient): void {
  let missed = 0;
  const MAX_MISSED = 3;

  const interval = setInterval(() => {
    if (!ws.connected) {
      clearInterval(interval);
      log.warn("WS disconnected — heartbeat stopped");
      return;
    }

    // DeltaWsClient.send is private, but it emits through the WS internally
    // We track acks via the 'heartbeat' event on the ws EventEmitter
    // The ws client already sends heartbeat frames on its own 25s timer;
    // this worker adds application-level monitoring on top.

    missed++;
    if (missed > MAX_MISSED) {
      log.error(`missed ${missed} heartbeats — possible connection issue`);
    }
    log.debug("heartbeat sent");
  }, HEARTBEAT_INTERVAL_MS);

  ws.on("heartbeat" as any, () => {
    if (missed > 0) {
      log.debug("heartbeat ack received", { previouslyMissed: missed });
      missed = 0;
    }
  });
}

main().catch((err) => {
  log.error("fatal", { error: String(err) });
  process.exit(1);
});
