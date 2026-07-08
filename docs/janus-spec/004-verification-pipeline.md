# 📄 JDS-004: Verification Pipeline Specification
Version: 1.0.0
Status: DRAFT
Owner: Compiler Architecture

## 1. Multi-Layer Verification
The Janus Domain Compiler (`jdc`) runs verification at three distinct layers. This prevents invalid specifications, circular causal logic, and physics violations from compiling into the runtime.

```
                  ┌──────────────────────┐
                  │      AST Input       │
                  └──────────┬───────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────┐
│  Layer 1: Static Compiler Verification                 │
│  - Syntax & Indentation checking                       │
│  - Symbol resolution & import validating               │
│  - Type checks & Facet index bound validations         │
│  - Cycle detection (Kahn's DAG analysis)               │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│  Layer 2: Physics Verification                         │
│  - Invariant consistency checks                        │
│  - Temporal consistency (arrow of time check)          │
│  - Evidence completeness validations                   │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│  Layer 3: Runtime Verification (Generated guards)     │
│  - Schema validations (Zod event validation)          │
│  - Replay and lookahead protection                     │
│  - Safety & AI gating guards                           │
└────────────────────────────────────────────────────────┘
```

---

## 2. Compile-Time Verification Engines

### 2.1 Cycle Detection Engine
The compiler constructs a dependency graph of all imports and causal relationships (e.g. `TRIGGERS` or `CAUSES` links). It runs Kahn's Algorithm to sort the graph:
- If a cycle is detected, the compiler immediately halts with `E002_CYCLIC_IMPORT` and prints the cycle path.

### 2.2 Lifecycle Reachability Engine
For every state machine defined inside JDS modules, the compiler:
- Performs depth-first search (DFS) traversal.
- Identifies any states that are "dead ends" (lacking transition paths to a terminal resolved state).
- Identifies any unreachable states.

### 2.3 Physics Invariant Engine
Evaluates JDS-010 Domain Physics rules.
- Statically compiles laws where variables can be verified (e.g., compile-time enum validations).
- Automatically converts dynamic laws (e.g. `PriceTick.price >= 0`) into runtime guard middleware code.
