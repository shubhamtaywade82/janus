# 📄 JDS-002: Financial Kernel Intermediate Representation (FKIR)
Version: 1.0.0
Status: DRAFT
Owner: Compiler Architecture

## 1. Core Philosophy: Describing Finance, Not Software
The **Financial Kernel Intermediate Representation (FKIR)** is the technology-agnostic, canonical representation of temporal financial market knowledge. Unlike traditional intermediate representations that describe software constructs (e.g. classes, variables, database tables), FKIR describes the mathematical and physical structure of financial markets as a **Directed Semantic Temporal Graph**.

By separating the JDS language frontend from the generators, FKIR allows multiple runtimes (e.g. TS strategy engines, Rust execution kernels, Python research harnesses) to compile their target configurations from a single financial ontology, preserving identical logic.

```
                    ┌────────────────────────┐
                    │ JDS Source Code (.jds)  │
                    └───────────┬────────────┘
                                │
                                ▼ (Frontend Parser)
                    ┌────────────────────────┐
                    │  Financial Kernel IR   │ (FKIR Graph Node/Edges)
                    └───────────┬────────────┘
                                │
                                ▼ (Pass Manager)
                    ┌────────────────────────┐
                    │  Optimized JIR Graph   │
                    └───────────┬────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌────────────────┐      ┌────────────────┐      ┌────────────────┐
│   Live Trading │      │  Ghost Replay  │      │  AI Narratives │
│ (TS Execution) │      │ (Rust Kernel)  │      │ (Episodic Gen) │
└────────────────┘      └────────────────┘      └────────────────┘
```

---

## 2. Graph-Native FKIR Schema Reference

Every compiled JDS source represents market knowledge as nodes, edges, annotations, components, and constraints:

```json
{
  "fkir_version": "1.0.0",
  "compiledAt": 1720425600000,
  
  "graph": {
    "options": { "type": "directed", "multi": true },
    
    // --- NODES (MARKET PHYSICS & ONTOLOGY OBJECTS) ---
    "nodes": [
      {
        "key": "ontology.imbalance.FairValueGap",
        "attributes": {
          "type": "NODE",
          "annotations": {
            "domain": "Imbalance",
            "spatial": "Zone",
            "lifecycle": "Finite",
            "execution": "Tradable"
          },
          "components": {
            "upperPrice": "float",
            "lowerPrice": "float",
            "direction": "enum(BULLISH, BEARISH)"
          },
          "stateGraph": {
            "states": ["FORMING", "ACTIVE", "RESOLVED"],
            "transitions": [
              { "from": "FORMING", "to": "ACTIVE", "on": "CandleClose" },
              { "from": "ACTIVE", "to": "RESOLVED", "on": "PriceClosedBeyond", "outcome": "MITIGATED" }
            ]
          }
        }
      }
    ],
    
    // --- EDGES (TEMPORAL & CAUSAL RELATIONSHIPS) ---
    "edges": [
      {
        "key": "edge:FairValueGap:MitigatedBy:MarketInteraction",
        "source": "ontology.imbalance.FairValueGap",
        "target": "ontology.interaction.MarketInteraction",
        "attributes": {
          "type": "EDGE",
          "kind": "MITIGATED_BY",
          "family": "CAUSAL",
          "constraints": [
            {
              "type": "CausalityConstraint",
              "expression": "edge.createdAt >= source.createdAt"
            }
          ]
        }
      }
    ]
  }
}
```

---

## 3. Reflection System API
FKIR includes a runtime Reflection System. Instead of parsing text files, Visualizers, IDE LSPs, and AI agents query this metadata to introspect entities:

```typescript
export interface IFkirReflection {
  reflect(nodeKey: string): {
    facets: FacetSignature;
    components: Record<string, string>;
    lifecycle: StateGraph;
    physics: Constraint[];
  };
}
```
