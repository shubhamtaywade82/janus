# 📄 JDS-008: System Model Specification (ECS Architecture)
Version: 1.0.0
Status: DRAFT
Owner: Core Architecture

## 1. Core Philosophy: The System Principle
The Janus Market Operating System is built on the **Entity-Component-System (ECS)** pattern.
1. **Entities (`MarketObjects`)** are passive, unique identifiers representing structural market facts. They contain data and signatures, but no behavior.
2. **Components (`Facets`)** are raw, structured data bags attached to entities defining their properties (e.g., Spatial boundaries, Temporal lifespans).
3. **Systems** are stateless, specialized processing engines that query entities by their component signatures and execute all business logic, calculations, and mutations.

By decoupling data from behavior, we guarantee perfect determinism for historical replays, simplify parallel execution, and allow new market features to be added by registering new Systems without modifying existing code.

---

## 2. The Systems Pipeline (The Market Compiler)

The Janus runtime operates like a compiler, passing exchange data through a sequence of specialized systems:

```
    [Exchange Feed]
           │
           ▼
┌──────────────────────┐
│ Feature Systems      │ (Tokenizes ticks into mathematical features)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Object Systems       │ (Parses features into semantic Market Object nodes)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Relationship Systems │ (Analyses spatial/temporal intersections, creating edges)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Pattern Systems      │ (Extracts topological sub-graphs of confluences)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Strategy Systems     │ (Queries patterns to generate trade Signals)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Policy & Exec Systems│ (Enforces safety and executes workflows)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Semantic Systems     │ (Serializes episodes into natural-language stories)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Learning Systems     │ (Offline vector encoding, reflection, and evolution)
└──────────────────────┘
```

---

## 3. System Contracts & Requirements

Every System in Janus must declare its signature, inputs, required facets, produced events, and determinism constraints.

### 3.1 Mitigation System
Evaluates whether active spatial structures (e.g., FVG, Order Blocks) have been mitigated or broken by price action.
```yaml
system:
  name: MitigationSystem
  type: Realtime
  inputs:
    - Event: TickReceived
    - EntitySet: MarketObjects
  requires:
    state: ACTIVE
    facets:
      spatial: ZONE
      lifecycle: FINITE
      execution: TRADABLE
  guards:
    - "Price enters the object boundary"
  actions:
    - "Update object.state to TRANSITIONING"
    - "Emit Event: ObjectInteractionStarted"
    - "If price closes beyond opposite boundary, transition to RESOLVED (Outcome: INVALIDATED)"
  determinism: DETERMINISTIC
  parallelizable: YES
```

### 3.2 Relationship System
Dynamically constructs directed edges in the Knowledge Graph based on temporal and geometric intersections between active objects.
```yaml
system:
  name: RelationshipSystem
  type: Realtime
  inputs:
    - Event: MarketObjectDetected
    - EntitySet: MarketObjects
  requires:
    state: ACTIVE
  guards:
    - "Check spatial overlap or temporal proximity between the new object and existing objects"
  actions:
    - "Create Edge (Relationship) in Graphology"
    - "Emit Event: RelationshipFormed"
  determinism: DETERMINISTIC
  parallelizable: YES
```

### 3.3 Narrative System
Translates graph structures and trade workflows into chronological, causal narratives for the AI Brain.
```yaml
system:
  name: NarrativeSystem
  type: Batch
  inputs:
    - Entity: Episode
    - GraphSet: HistoricalGraph
  requires:
    state: RESOLVED
    facets:
      lifecycle: COMPOSITE
  actions:
    - "Query all nodes and edges within 2 hops of the TradeWorkflow"
    - "Order events chronologically"
    - "Serialize graph topology into Markdown Narrative"
    - "Emit Event: NarrativeSerialized"
  determinism: DETERMINISTIC
  parallelizable: YES
```

---

## 4. Generated SDK Interface & Handwritten System Logic

This section defines the strict boundary of the developer experience. The compiler generates the type-safe interfaces, while the developer writes the pure mathematical logic.

### 4.1 Generated Contract (`packages/runtime/generated/MitigationSystem.ts`)
```typescript
// GENERATED: Do not edit manually.
import { PriceTick, FairValueGap, MitigationStarted, MitigationCompleted } from './types';

export interface MitigationSystemInputs {
  tick: PriceTick;
  activeGaps: FairValueGap[];
}

export interface MitigationSystemOutputs {
  events: Array<MitigationStarted | MitigationCompleted>;
}

export interface IMitigationSystem {
  // Query filter logic generated from JDS facets declarations
  filter(gap: FairValueGap): boolean;

  // The developer implementation hook
  execute(inputs: MitigationSystemInputs): MitigationSystemOutputs;
}
```

### 4.2 Handwritten Logic (`packages/runtime/src/systems/MitigationSystem.ts`)
The developer writes only the core math and logical evaluation inside this implementation file.

```typescript
import { IMitigationSystem, MitigationSystemInputs, MitigationSystemOutputs } from '../../generated/MitigationSystem';
import { FairValueGap } from '../../generated/types';

export class MitigationSystem implements IMitigationSystem {
  public filter(gap: FairValueGap): boolean {
    // Compiled directly from JDS facets: [Imbalance, Zone, Finite, Tradable]
    return (
      gap.state === 'ACTIVE' &&
      gap.facets.spatial.includes('Zone') &&
      gap.facets.lifecycle.includes('Finite')
    );
  }

  public execute(inputs: MitigationSystemInputs): MitigationSystemOutputs {
    const emittedEvents: MitigationSystemOutputs['events'] = [];
    const { tick, activeGaps } = inputs;

    for (const gap of activeGaps) {
      if (!this.filter(gap)) continue;

      // Core handwritten physical evaluation
      const priceTouched = tick.price <= gap.upperPrice && tick.price >= gap.lowerPrice;
      
      if (priceTouched) {
        emittedEvents.push({
          type: 'MitigationStarted',
          payload: {
            objectId: gap.id,
            price: tick.price,
            timestamp: tick.timestamp
          }
        });
      }
    }

    return { events: emittedEvents };
  }
}
```

### 4.3 Runtime Execution Loop & Guards (`packages/runtime/src/Scheduler.ts`)
The scheduler loads systems, queries the entity pool, applies the generated Zod/Physics guards, and executes transitions:

```typescript
import { MitigationSystem } from './systems/MitigationSystem';
import { enforcePhysics } from '../generated/guards';
import { MitigationStartedSchema } from '../generated/schemas';

class EcsScheduler {
  private mitigationSystem = new MitigationSystem();

  public async runTick(tick: PriceTick) {
    // 1. Query the passive entity pool matching filter
    const activeGaps = this.world.query(gap => this.mitigationSystem.filter(gap));

    // 2. Execute the handwritten stateless system logic
    const { events } = this.mitigationSystem.execute({ tick, activeGaps });

    // 3. Process emitted events through the validation and physics guards
    for (const event of events) {
      // Validate schema format
      if (event.type === 'MitigationStarted') {
        MitigationStartedSchema.parse(event.payload);
      }
      
      // Enforce temporal/causality physics laws
      enforcePhysics(event, 'Law_of_Causality');

      // 4. Append to event store and outbox
      await this.eventStore.append(event);
    }
  }
}
```

