# 📄 JDS-001: Compiler Architecture Specification (Pass Manager)
Version: 1.0.0
Status: DRAFT
Owner: Compiler Architecture

## 1. Compiler Pass Manager Architecture
The Janus Domain Compiler (`jdc`) uses a decoupled **Pass Manager** pipeline to execute multi-stage optimizations on the Financial Kernel Intermediate Representation (FKIR) before backend code generation.

```
                      ┌────────────────────────┐
                      │    FKIR Graph Input    │
                      └───────────┬────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────┐
│  Stage 1: Canonicalization Pass                        │
│  - Merges polar categories (e.g. Bullish/Bearish FVG)   │
│  - Maps direction values as metadata annotations       │
└───────────────────────────┬────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────┐
│  Stage 2: Inference Pass                               │
│  - Derives implicit capabilities from facets           │
│  - Example: Zone + Finite -> Mitigatable               │
└───────────────────────────┬────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────┐
│  Stage 3: Physics Pass                                 │
│  - Enforces temporal acyclicity and lifecycle rules    │
└───────────────────────────┬────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────┐
│  Stage 4: Optimization Pass                            │
│  - Removes dead nodes & folds linear temporal chains   │
└───────────────────────────┬────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────┐
│  Stage 5: Validation Pass                              │
│  - Assures correctness of generated target schemas     │
└────────────────────────────────────────────────────────┘
```

---

## 2. The Financial Standard Library (`stdlib/`)
JDS modules import built-in primitives from the Financial Standard Library (`stdlib/`). The compiler pre-loads these primitives:

- **`std.market.Price`**: Raw market price components.
- **`std.market.Candles`**: OHLCV candle parameters.
- **`std.market.Volume`**: Volume profiles and Surges.
- **`std.market.Orderbook`**: L2 orderbook layers and imbalances.
- **`std.risk.Portfolio`**: Kelly sizing and exposure tracking.

```jds
import std.market.Candles;
import std.risk.Portfolio;
```

---

## 3. Independent Versioning
To prevent tight coupling between execution runtimes and specifications, Janus enforces independent versioning across the toolchain:

- **Language Spec Version**: Defines JDS grammar grammar rules (e.g., v2.0.0).
- **FKIR Graph Schema**: Defines JIR database and outbox nodes (e.g., v5.1.0).
- **Physics Solver Version**: System invariants solver (e.g., v3.2.0).
- **Target Backend Generators**: TypeScript (v7.0.0) / Rust (v4.4.0).
