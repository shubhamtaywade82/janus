/**
 * Janus Proto-Kernel Core Types
 * Package: @janus/shared
 * Version: 0.1.0
 */

// --- IDENTITY & TIME ---
export type UUID = string;

export interface TimeVector {
  exchange: number; // Monotonic exchange timestamp
  system: number;   // Local arrival/processing timestamp
  replay?: number;  // Simulated replay cursor
}

// --- BASE EVENT ENVELOPE ---
export interface EventEnvelope<T = any> {
  id: UUID;
  correlationId: UUID;
  causationId: UUID;
  timestamp: TimeVector;
  type: string;
  payload: T;
}

// --- EPISTEMOLOGICAL FLOW STAGES ---

// 1. Observation: Raw, immutable sensory inputs
export interface Observation<T = any> {
  id: UUID;
  source: string; // e.g. "binance.ws"
  timestamp: TimeVector;
  type: string;
  payload: T;
}

// 2. Inference: Stateful probabilistic deductions
export interface Inference<T = any> {
  id: UUID;
  type: string;
  state: 'FORMING' | 'ACTIVE' | 'RESOLVED';
  confidence: number; // 0.0 to 1.0
  geometry: Geometry;
  data: T;
  evidence: UUID[]; // References to observations
  timestamp: TimeVector;
}

// 3. Knowledge: Corroborated structural facts
export interface Knowledge<T = any> {
  id: UUID;
  type: string;
  state: 'UNCONFIRMED' | 'CONFIRMED' | 'WEAKENED' | 'INVALIDATED';
  confidence: number;
  data: T;
  evidence: UUID[]; // References to Inferences/Observations
  timestamp: TimeVector;
}

// 4. Decision: Action intents validated by policies
export interface Decision<T = any> {
  id: UUID;
  intent: 'ENTER' | 'EXIT' | 'SCALE' | 'ABORT';
  state: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
  data: T;
  rationales: UUID[]; // Pointers to Knowledge nodes
  timestamp: TimeVector;
}

// --- GEOMETRY PRIMITIVES ---
export type Geometry =
  | { type: 'POINT'; price: number }
  | { type: 'RANGE'; upper: number; lower: number }
  | { type: 'ZONE'; upper: number; lower: number; startTime: number; endTime?: number };

// --- UTILITY PATTERNS ---
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

export type Option<T> =
  | { hasValue: true; value: T }
  | { hasValue: false };

export interface ErrorModel {
  code: string;
  message: string;
  details?: any;
}
