# JDS-003: Market Ontology Specification
Version: 1.0
Status: Approved

This document details the formal semantic levels of the Janus Market Ontology. The model is strictly strategy-agnostic, defining how raw market inputs evolve into semantic narratives.

```
 +-----------------------------------------------------------------------------+
 |                         SEMANTIC HIERARCHY LEVELS                           |
 |                                                                             |
 |  Level 5: Stories     --> Textual Market Narratives                         |
 |  Level 4: Sentences   --> The 3-Tier Directed Graph of Structures           |
 |  Level 3: Phrases     --> Nested structures & overlaps (e.g. FVG in OB)     |
 |  Level 2: Semantics   --> Detected MarketObjects (OB, FVG, Swing)           |
 |  Level 1: Syntax      --> Candle aggregates (OHLCV, volume deltas)          |
 |  Level 0: Lexicon     --> Raw atomic feeds (trades, L2 order books)        |
 +-----------------------------------------------------------------------------+
```

---

## 1. Level 0: Lexicon (Raw Ticks)
The base layer consists of raw, atomic, unstructured data events streamed directly from exchange nodes.
- **Elements**: Trade ticks, Level 2 order book limit updates, mark price ticks.
- **Characteristics**: Extremely high throughput, unordered delivery, unstructured context.

## 2. Level 1: Syntax (Candles & Features)
Aggregates Level 0 data into fixed temporal intervals or volume buckets.
- **Elements**: Candlesticks (Open, High, Low, Close, Volume), Cumulative Volume Delta (CVD), Open Interest (OI) changes.
- **Characteristics**: Regular structural grids that form the foundation for detecting price anomalies.

## 3. Level 2: Semantics (MarketObjects/Nodes)
The first layer of semantic identification. Syntactic irregularities are modeled as discrete structures with distinct spatial and temporal bounds.
- **Elements**: Fair Value Gaps (FVG), Order Blocks (OB), Swing Highs, Swing Lows, Volume Profile Nodes.
- **Characteristics**: Identified nodes have physical lifecycles, states, and capabilities (e.g. mitigation limits).

## 4. Level 3: Phrases (Overlaps & Subgraphs)
Identifies interactions between multiple local structures, forming semantic phrases.
- **Elements**: An FVG that resides within an OrderBlock; a Swing High that sweeps a Liquidity Pool.
- **Characteristics**: Spatial and temporal nesting of nodes, representing high-probability institutional activity zones.

## 5. Level 4: Sentences (Graphs)
The assembly of level 2 and level 3 structures into a unified, multi-timeframe directed graph.
- **Elements**: A 15-minute FVG nested within a 4-hour OrderBlock, connected by structural edges.
- **Characteristics**: High-level semantic relationships, modeling how current structures are invalidating or retesting historical ones.

## 6. Level 5: Stories (Narratives)
Translates the structural directed graph of Level 4 into a semantic, compressed, human-readable summary.
- **Elements**: Textual reports outlining market trends, liquidations, CVD absorption, and structural bias.
- **Characteristics**: Used directly in LLM prompts, providing a rich, token-efficient summary of the current market state.\n