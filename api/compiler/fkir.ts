/**
 * Financial Kernel Intermediate Representation (FKIR) Spec Schema Types
 * Version: 1.0.0
 * Status: DRAFT
 * Owner: Compiler Architecture
 */

export interface FinancialKernelIR {
  version: string;
  sourceVersion: string;
  compiledAt: number;

  // Layer 0: The Laws (Constraints & Axioms)
  physics: PhysicsConstraint[];

  // Layer 1: The Entities (Temporal Graph)
  objects: MarketObjectDefinition[];

  // Layer 2: The Mechanics (Interaction & Evidence Graph)
  interactions: InteractionModel[];

  // Layer 3: The Topology (Knowledge & Pattern Graph)
  relationships: RelationshipModel[];

  // Layer 4: The Action (Decision & Execution Graph)
  systems: SystemContract[];
  policies: PolicyRule[];

  // Derived Layer: The Vocabulary (Auto-generated from Layers 1-4)
  events: EventDefinition[];
}

// --- LAYER 0: PHYSICS INVARIANTS ---
export interface PhysicsConstraint {
  id: string;
  category: 'TEMPORAL' | 'GRAPH' | 'PHYSICAL' | 'SAFETY';
  severity: 'FATAL' | 'WARNING';
  expression: string; // The executable or statically checked assertion
  scope: string; // Target entity type or relationship context
  description: string;
}

// --- LAYER 1: TEMPORAL ENTITIES (OBJECTS) ---
export interface MarketObjectDefinition {
  id: string;
  category: string;
  facets: {
    domain: string[];
    spatial: string[];
    lifecycle: string[];
    execution: string[];
  };
  components: Record<string, DataType>;
  lifecycle: {
    states: string[];
    outcomes: string[];
    transitions: StateTransition[];
  };
  affordances: string[];
}

export interface StateTransition {
  from: string;
  to: string;
  trigger: string;
  condition?: string;
  yields?: string; // Outcome parameter if entering resolved terminal state
}

// --- LAYER 2: INTERACTION & EVIDENCE MODELS ---
export interface InteractionModel {
  id: string;
  type: string;
  requires: {
    entities: string[]; // List of object types
    conditions: string[];
  };
  evidenceRequirements: string[];
}

// --- LAYER 3: RELATIONSHIPS & KNOWLEDGE GRAPH ---
export interface RelationshipModel {
  id: string;
  kind: string;
  family: 'CAUSAL' | 'STRUCTURAL' | 'TEMPORAL' | 'TRADING';
  directionality: 'DIRECTED' | 'UNDIRECTED';
  source: string; // Node ID
  target: string; // Node ID
  properties: Record<string, DataType>;
  lifecycle: {
    states: string[];
    outcomes: string[];
  };
  provenance: {
    system: string;
    ruleVersion: string;
  };
}

// --- LAYER 4: SYSTEMS & EXECUTION contracts ---
export interface SystemContract {
  id: string;
  type: 'StatelessSystem' | 'StatefulSystem';
  consumes: string[]; // List of node keys/events
  requires: string[]; // ECS query requirements
  emits: string[]; // Emitted event names
  description: string;
}

export interface PolicyRule {
  id: string;
  appliesTo: string;
  guards: string[];
  actions: string[];
}

// --- GENERATED EVENT LAYER ---
export interface EventDefinition {
  id: string;
  aggregate: string;
  payload: Record<string, DataType>;
  generatedFrom: {
    sourceId: string;
    triggerType: 'LIFECYCLE_TRANSITION' | 'OUTCOME' | 'SYSTEM_EMISSION';
  };
}

// --- CORE UTILITY TYPES ---
export type DataType =
  | 'float'
  | 'integer'
  | 'string'
  | 'boolean'
  | 'timestamp'
  | 'PricePoint'
  | { enum: string[] }
  | { list: string };
