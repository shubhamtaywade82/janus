# 📄 JDS-003: Generator Model Specification
Version: 1.0.0
Status: DRAFT
Owner: Compiler Architecture

## 1. Core Philosophy: The Generation Boundary
In the Janus Temporal Knowledge Operating System (TKOS), **the runtime is generated**. Developers never handwrite boilerplate, schemas, types, database repositories, or telemetry routing classes. These are compiled directly from the JIR specification.

This ensures a strict boundary between generated code and handwritten logic, eliminating developer overhead and preventing configuration drift.

```
┌────────────────────────────────────────────────────────┐
│                    GENERATED ARTIFACTS                 │
│  - Entity Classes (TS/Rust structs)                    │
│  - Data Transfer Objects (DTOs) & Zod Schemas          │
│  - Lifecycle Events & State transition triggers        │
│  - Telemetry counters, traces, and metrics wrappers     │
│  - Database Schema migrations & Query repository files │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼ (Satisfies interfaces of)
┌────────────────────────────────────────────────────────┐
│                    HANDWRITTEN ALGORITHMS              │
│  - Detection logic (e.g. FVG calculation math)          │
│  - Scoring confluences (e.g. Confluence speedometers)  │
│  - Execution engines (e.g. order router adapters)      │
│  - AI reasoning (Ollama system instructions)            │
└────────────────────────────────────────────────────────┘
```

---

## 2. Generator Targets Detail

### 2.1 TypeScript SDK Target (`jgen-ts`)
- **Entities**: Compiles JIR `NODE` elements into immutable TypeScript interfaces and builder classes.
- **Zod validation**: Generates schema files for all components and events.
- **Statecharts**: Compiles state charts into finite state machine classes.

### 2.2 Rust & WASM SDK Target (`jgen-rust`)
- **Memory Optimization**: Generates flat, memory-aligned Rust struct formats and WASM binding layers to execute feature calculations and object detection at microsecond latency.

### 2.3 Testing Target (`jgen-testing`)
- **Property-based tests**: Generates property checks via `fast-check` for every JIR constraint.
- **Fuzzing Fixtures**: Compiles object structures into randomized test generators.

### 2.4 Documentation & AI Target (`jgen-docs-ai`)
- **Mermaid/UML**: Generates visual SVG charts of state graphs and system inputs/outputs.
- **AI Narrative prompt structures**: Translates graph ontology nodes into JSON schemas used by the AI Brain for semantic narrative processing.
