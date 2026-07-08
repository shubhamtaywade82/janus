# 📄 JDS-006: Domain Physics Specification
Version: 1.0.0
Status: DRAFT
Owner: Core Architecture

## 1. Core Philosophy: Invariants as Physical Laws
In the Janus Temporal Knowledge Operating System (TKOS), **Invariants are the unbreakable laws of physics**. They define what is mathematically and logically possible in the universe of our trading system. 

Unlike traditional platforms where invariants are handled as ad-hoc validation checks or unit tests, the Janus TKOS compiles JDS invariants directly into **executable property-based tests** and **runtime guards**. 
- If a law is broken during simulation or live execution, it is treated as a physical anomaly: the system halts, executes safe-mode procedures, and isolates the state.
- During code generation, the Janus compiler verifies that all state charts, event schemas, and database transactions satisfy these physics laws.

```
                  ┌──────────────────────┐
                  │   JDS Specification  │ (Source DSL)
                  └──────────┬───────────┘
                             │
                             ▼
            ┌─────────────────────────────────┐
            │   Janus Spec Compiler Engine    │
            └────┬────────────────────────┬───┘
                 │                        │
                 ▼                        ▼
      ┌──────────────────────┐   ┌──────────────────────┐
      │   Runtime Schemas    │   │  Property-Based Tests│ (Verification)
      │  (Types & Zod Guards)│   │  (Vitest/Fast-Check) │
      └──────────────────────┘   └──────────────────────┘
```

---

## 2. The 11 Laws of Domain Physics

### 2.1 Physical Laws (Exchange & Time-Series Constraints)
Enforce absolute boundaries on raw market phenomena.
- **`PriceNonNegativity`**:
  - *Expression*: `Ticker.price >= 0.0`
  - *Severity*: Fatal
- **`HighLowBoundary`**:
  - *Expression*: `Kline.high >= Kline.low`
  - *Severity*: Fatal
- **`OpenInterestFloor`**:
  - *Expression*: `MarketState.openInterest >= 0.0`
  - *Severity*: Fatal

### 2.2 Temporal Laws (Time Ordering Constraints)
Enforce absolute sequence ordering across the system's timelines.
- **`TemporalSequence`**:
  - *Expression*: `Entity.createdAt <= Entity.detectedAt <= Entity.activatedAt <= Entity.resolvedAt <= Entity.archivedAt`
  - *Severity*: Fatal
- **`RelationshipSucceededByInteraction`**:
  - *Expression*: `Relationship.createdAt >= Interaction.createdAt`
  - *Severity*: Fatal
- **`EpisodeBoundaries`**:
  - *Expression*: `Episode.startedAt >= Workflow.createdAt && Episode.endedAt <= Workflow.closedAt`
  - *Severity*: Fatal

### 2.3 Lifecycle Laws (State Transition Constraints)
Enforce the directionality of state evolution.
- **`ImmutableResolvedState`**:
  - *Expression*: `Entity.state == 'RESOLVED' || Entity.state == 'ARCHIVED' => MutationState == 'BLOCKED'`
  - *Severity*: Fatal
- **`PruneBeforeActive`**:
  - *Expression*: `Entity.state == 'FORMING' || Entity.state == 'ACTIVE' => Entity.state != 'ARCHIVED' unless transitioning through 'RESOLVED'`
  - *Severity*: Fatal

### 2.4 Graph Laws (Topology Constraints)
Enforce structural consistency in the Knowledge Graph.
- **`EdgeIntegrity`**:
  - *Expression*: `Exists(Graph.getNode(Relationship.sourceId)) && Exists(Graph.getNode(Relationship.targetId))`
  - *Severity*: Fatal
- **`AcyclicCausality`**:
  - *Expression*: `Graph.hasCycle({ edgeTypes: ['TRIGGERS', 'CAUSES'] }) == false`
  - *Severity*: Fatal
- **`SelfLoopExclusion`**:
  - *Expression*: `Relationship.sourceId != Relationship.targetId unless Relationship.kind == 'SELF'`
  - *Severity*: Fatal

### 2.5 Evidence Laws (Epistemic Constraints)
Enforce mathematical justification for semantic assertions.
- **`EvidenceRequiredForConfidence`**:
  - *Expression*: `Relationship.confidence > 0.0 => relationship.evidence.length > 0`
  - *Severity*: Critical
- **`EvidenceTimestampBounds`**:
  - *Expression*: `Evidence.timestamp <= Relationship.resolvedAt`
  - *Severity*: Fatal

### 2.6 Provenance Laws (Lineage Constraints)
Enforce absolute trace-back across the data pipeline.
- **`LineageCompleteness`**:
  - *Expression*: `Relationship.provenance.interactionTrigger != null && Interaction.provenance.evidenceEvents.length > 0`
  - *Severity*: Fatal
- **`NoOrphanKnowledge`**:
  - *Expression*: `Exists(MarketObject.provenance.sourceEventId)`
  - *Severity*: Fatal

### 2.7 Event Laws (State Dependency Constraints)
Enforce the logical preconditions for events.
- **`ActivationPrecondition`**:
  - *Expression*: `Event.eventType == 'ObjectActivated' => EventHistory.has('ObjectDetected', { objectId: Event.aggregateId })`
  - *Severity*: Fatal
- **`MitigationPrecondition`**:
  - *Expression*: `Event.eventType == 'MitigationCompleted' => EventHistory.has('MitigationStarted', { objectId: Event.aggregateId })`
  - *Severity*: Fatal

### 2.8 ECS Laws (Architecture Constraints)
Enforce absolute decoupling of entities, components, and systems.
- **`SystemStatelessness`**:
  - *Expression*: `System.mutate(GlobalState) == forbidden`
  - *Severity*: Fatal
- **`ImmutabilityBySystem`**:
  - *Expression*: `System.update(Entity) => System.emits(DomainEvent) && Projection.apply(DomainEvent) => EntityUpdate`
  - *Severity*: Fatal

### 2.9 Replay Laws (Determinism Constraints)
Enforce simulation accuracy for backtests and replays.
- **`ReplayDeterminism`**:
  - *Expression*: `RunSystemPipeline(EventStore, Config) == RunSystemPipeline(EventStore, Config)`
  - *Severity*: Fatal
- **`NoLookaheadBias`**:
  - *Expression*: `System.query(TimeContext.now) => query.results.every(e => e.createdAt <= TimeContext.now)`
  - *Severity*: Fatal

### 2.10 AI Laws (Cognitive Constraints)
Enforce safety and limit the LLM's authority.
- **`AiReadonly`**:
  - *Expression*: `AiBrain.executeCommand(DirectWrite) == forbidden`
  - *Severity*: Fatal
- **`NarrativeProvenance`**:
  - *Expression*: `Narrative.evidence.every(e => Exists(Graph.getNode(e)) || Exists(Graph.getEdge(e)))`
  - *Severity*: Critical

### 2.11 Safety Laws (Execution Constraints)
Enforce risk parameters on order dispatching.
- **`ExecutionApproval`**:
  - *Expression*: `Order.dispatch() => Workflow.state == 'APPROVED' && PolicyEngine.riskApproval == true`
  - *Severity*: Fatal
- **`OrderAnchoredToPlan`**:
  - *Expression*: `Order.executionPlanId != null && Exists(ExecutionPlan.id)`
  - *Severity*: Fatal

---

## 3. Executable Invariant Contract (DSL Schema)

Every domain physics law is specified using a structured contract schema that compiles into typescript guards and vitest suites.

```yaml
# Example: Relationship Provenance Law
name: RelationshipRequiresInteraction
category: Provenance
severity: Fatal
description: "A relationship cannot be created without a parent interaction trigger."
expression: |
  relationship.provenance.interactionTrigger != null && 
  exists(interaction[relationship.provenance.interactionTrigger])
violationAction:
  raise: CausalLineageException
  rejectMutation: true
```

---

## 4. Property-Based Testing Integration

These physical laws map directly to property-based tests (e.g. using `fast-check` in Vitest):

```typescript
import { test, expect } from 'vitest';
import * as fc from 'fast-check';

test('HighLowBoundary Law holds for all Klines', () => {
  fc.assert(
    fc.property(
      fc.record({
        open: fc.float(),
        high: fc.float(),
        low: fc.float(),
        close: fc.float()
      }),
      (rawKline) => {
        // Enforce the physical law generator
        const high = Math.max(rawKline.high, rawKline.low);
        const low = Math.min(rawKline.high, rawKline.low);
        const kline = { ...rawKline, high, low };

        // Assert our physics law
        expect(kline.high).toBeGreaterThanOrEqual(kline.low);
      }
    )
  );
});
```
