import { EventEmitter } from "events";
import type { ManagedPosition, AssessmentRecord, PositionAction } from "./types";

// ─── Typed Event Definitions ─────────────────────────────────────────────────

export interface PositionManagerEvents {
  "position:discovered": (position: ManagedPosition) => void;
  "position:synced": (position: ManagedPosition) => void;
  "position:protected": (positionId: number, sl: number, tp: number) => void;
  "position:protection-mismatch": (positionId: number, botSl: number, botTp: number, exSl: number | null, exTp: number | null) => void;
  "position:assessed": (record: AssessmentRecord) => void;
  "position:action-executed": (positionId: number, action: PositionAction, result: "ok" | "failed", detail?: string) => void;
  "position:closed": (positionId: number, reason: string) => void;
  "position:lifecycle-changed": (positionId: number, from: string, to: string) => void;
  "manager:error": (context: string, error: Error) => void;
  "manager:started": () => void;
  "manager:stopped": () => void;
}

class TypedEventEmitter extends EventEmitter {
  emit<K extends keyof PositionManagerEvents>(
    event: K,
    ...args: Parameters<PositionManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof PositionManagerEvents>(
    event: K,
    listener: PositionManagerEvents[K]
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<K extends keyof PositionManagerEvents>(
    event: K,
    listener: PositionManagerEvents[K]
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof PositionManagerEvents>(
    event: K,
    listener: PositionManagerEvents[K]
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

export const positionManagerBus = new TypedEventEmitter();
positionManagerBus.setMaxListeners(50);
