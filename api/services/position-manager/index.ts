import { PositionLifecycleManager } from "./position-lifecycle";
import { DEFAULT_POSITION_MANAGER_CONFIG } from "./types";

export * from "./types";
export * from "./event-bus";
export { positionStore } from "./position-store";
export { PositionLifecycleManager };

// ─── Singleton ─────────────────────────────────────────────────────────────
// Attached to globalThis so it survives Vite HMR.

const key = "__positionLifecycleManager__" as const;

if (!(globalThis as Record<string, unknown>)[key]) {
  (globalThis as Record<string, unknown>)[key] = new PositionLifecycleManager(
    DEFAULT_POSITION_MANAGER_CONFIG
  );
}

export const positionLifecycleManager: PositionLifecycleManager = (
  globalThis as Record<string, unknown>
)[key] as PositionLifecycleManager;
