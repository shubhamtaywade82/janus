# 📄 JDS-007: Event Model Specification (State Change Vocabulary)
Version: 1.0.0
Status: DRAFT
Owner: Core Architecture

## 1. Core Philosophy: The Causal Timeline
In the Janus Temporal Knowledge Operating System (TKOS), **Events are the ultimate facts**. State transitions do not occur by direct database writes; they are the result of applying a deterministic sequence of events to a projection. 

Furthermore, every Event is strictly bound by the **Domain Physics (`006-domain-physics.md`)**. An event can only be appended to the Event Store if it passes all semantic, temporal, and safety invariants.

The vocabulary of state changes is divided into the CQRS triad:
1. **Commands (Requests)**: Intent to change state. May be rejected if they violate business rules or safety laws.
2. **Events (Facts)**: Immutable, historical records of what occurred. Never rejected.
3. **Queries (Projections)**: Read-only requests to active session graph views.

```
       [Command]
           │
           ▼
┌──────────────────────┐
│   Systems Validation │ (Verifies Domain Physics Invariants)
└──────────┬───────────┘
           │ (If valid)
           ▼
        [Event] ───────> Append to Event Store (Transactional Outbox)
           │
           ▼
┌──────────────────────┐
│   Projections        │ (Updates Graph/Memory Read Models)
└──────────┬───────────┘
           │
           ▼
        [Query] ───────> Feeds User/AI Decisions
```

---

## 2. Standard Event Envelope (TKOS Lineage)

Every event appended to the Event Store carries metadata to construct a complete **Causal Tracing Chain**:

```typescript
export interface DomainEventEnvelope<TPayload = any> {
  // --- IDENTIFICATION ---
  eventId: string;                  // UUID v7 (Time-sortable)
  eventType: string;                // Namespaced type (e.g. 'janus.market.interaction_registered')
  sequenceNumber: bigint;           // Monotonic ordering key per stream
  
  // --- CAUSAL TRACING ---
  correlationId: string;            // The original root trigger (e.g. parent PriceTick event ID)
  causationId: string;              // The immediate cause (e.g. ID of the event/command that triggered this system run)
  
  // --- STREAM CONTEXT ---
  streamId: string;                 // e.g., 'market:BTCUSDT' or 'workflow:uuid'
  aggregateId: string;              // ID of the target entity
  aggregateType: string;            // e.g., 'MarketObject', 'TradeWorkflow'
  
  // --- DATA ---
  timestamp: ExchangeTime;          // Exchange microsecond timestamp
  payload: TPayload;                // Type-safe data payload
}
```

---

## 3. Core Event Catalog & Schemas

### 3.1 Market Ingestion & Feature Events
- **`janus.market.tick_received`**: Raw price/volume tick from exchange.
- **`janus.market.features_recalculated`**: Features engine output updated.

### 3.2 Object & Interaction Events (Level 2 Facts)
- **`janus.market.object_detected`**: Level 2 entity created.
  ```typescript
  interface ObjectDetectedPayload {
    objectId: string;
    symbol: string;
    facets: FacetSignature;      // Spatial/Temporal facets
    geometry: Record<string, number>; // Price boundaries
  }
  ```
- **`janus.market.interaction_registered`**: Transient interaction event.
  ```typescript
  interface InteractionRegisteredPayload {
    interactionId: string;
    type: 'TOUCH' | 'PENETRATION' | 'CROSS' | 'RETEST';
    sourceEntityId: string;       // e.g. PriceTick ID
    targetEntityId: string;       // e.g. FVG ID
    price: number;
    metrics: Record<string, number>;
  }
  ```

### 3.3 Relationship Events (Graph Edges)
- **`janus.market.relationship_formed`**: Persistent edge added.
  ```typescript
  interface RelationshipFormedPayload {
    relationshipId: string;
    kind: RelationshipKind;       // e.g. 'SWEEPS', 'FILLS'
    sourceId: string;
    targetId: string;
    confidence: number;
    interactionTriggerId: string; // Causation link
  }
  ```
- **`janus.market.relationship_updated`**: Edge weights, confidence, or evidence modified.
- **`janus.market.relationship_resolved`**: Edge reached terminal state.

### 3.4 Execution & Safety Events (Workflows)
- **`janus.execution.workflow_started`**: TradeWorkflow initialized.
- **`janus.execution.order_submitted`**: Order dispatched to exchange.
- **`janus.risk.kill_switch_triggered`**: Safety limit hit, bot halted.

---

## 4. The Causal Tracing Chain Example

To trace why Janus executed a trade, the AI Brain reconstructs the causal timeline using `correlationId` and `causationId`:

```
[Exchange Tick #4012]
   │
   ├── (Causation) ──> [janus.market.interaction_registered] (Touch FVG)
   │                      │
   │                      └── (Causation) ──> [janus.market.relationship_updated] (Mitigation Confirmed)
   │                                             │
   │                                             └── (Causation) ──> [janus.execution.workflow_started] (LONG setup)
```
If a trade fails or performs anomaly actions, the Replay Engine streams the correlation chain sequentially, allowing perfect, step-by-step diagnostic audits.
