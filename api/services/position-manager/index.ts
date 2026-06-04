import { PositionLifecycleManager } from "./position-lifecycle";
import { DEFAULT_POSITION_MANAGER_CONFIG } from "./types";

export * from "./types";
export * from "./event-bus";
export { positionStore } from "./position-store";
export { PositionLifecycleManager };

// ─── Singleton ─────────────────────────────────────────────────────────────
// Survives Vite HMR via globalThis attachment.

const key = "__positionLifecycleManager__" as const;

if (!(globalThis as Record<string, unknown>)[key]) {
  (globalThis as Record<string, unknown>)[key] = new PositionLifecycleManager(
    DEFAULT_POSITION_MANAGER_CONFIG
  );
}

export const positionLifecycleManager: PositionLifecycleManager = (
  globalThis as Record<string, unknown>
)[key] as PositionLifecycleManager;

// ─── Manual wiring (add to existing files when ready) ──────────────────────
//
// 1. api/boot.ts — start the manager after LLM advisor init:
//    import { positionLifecycleManager } from "./services/position-manager/index";
//    setTimeout(() => positionLifecycleManager.start().catch(console.error), 5_000);
//
// 2. api/router.ts — register the tRPC router:
//    import { positionManagerRouter } from "./routers/position-manager-router";
//    // inside appRouter: positionManager: positionManagerRouter
//
// 3. DB tables — run once to create the 3 new tables:
//    npx drizzle-kit push --config drizzle.config.ts
//    (tables defined in db/position-manager-schema.ts)
