# 📄 JDS-026: Spec Compiler Pipeline & Build Graph
Version: 1.0.0
Status: DRAFT
Owner: Compiler Architecture

## 1. Core Philosophy: Incremental Build Graphs
The Janus Domain Compiler (`jdc`) does not perform linear batch compilation. It models compiling as an **Incremental Build Graph**. Every target file (TypeScript classes, Zod schemas, Vitest specs, Markdown files) is a node in the compiler build graph dependent on a JDS source file node.

If a JDS source file's checksum is identical, the compiler skips parsing and generation for that branch of the DAG, achieving sub-second build times.

```
┌─────────────────────┐
│  FairValueGap.jds   │
└──────────┬──────────┘
           ├──────────────────────────┐
           ▼                          ▼
┌─────────────────────┐    ┌─────────────────────┐
│  gen:FairValueGap   │    │  gen:ZodSchema      │
│  (Runtime TS)       │    │  (Schema TS)        │
└─────────────────────┘    └─────────────────────┘
```

---

## 2. Compilation Stages Pipeline

```
           [JDS Source File System]
                      │
                      ▼
 ┌────────────────────────────────────────┐
 │ 1. Lexer & Parser (Syntactic Check)    │
 └────────────────────┬───────────────────┘
                      ▼
 ┌────────────────────────────────────────┐
 │ 2. Standard Library Linking            │ (Resolves imports from 'std.*')
 └────────────────────┬───────────────────┘
                      ▼
 ┌────────────────────────────────────────┐
 │ 3. Pass Manager Optimization Pipeline  │ (Runs Canonical, Physics, Inference)
 └────────────────────┬───────────────────┘
                      ▼
 ┌────────────────────────────────────────┐
 │ 4. FKIR Generator                      │ (Emits serialized graph JSON)
 └────────────────────┬───────────────────┘
                      ▼
 ┌────────────────────────────────────────┐
 │ 5. Code Generation Plugins             │ (Transpiles TS, Rust, Docs, AI)
 └────────────────────────────────────────┘
```

---

## 3. Incremental Cache Keys

The compilation workspace maintains a `.janus-cache` manifest mapping input file hashes to output targets:

```json
{
  "cacheVersion": "1.0.0",
  "files": {
    "specs/ontology/imbalance/FairValueGap.jds": {
      "hash": "a1b2c3d4e5f6...",
      "outputs": [
        "packages/runtime/generated/FairValueGap.ts",
        "packages/schemas/generated/FairValueGap.schema.ts"
      ]
    }
  }
}
```
