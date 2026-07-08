import os

SPEC_DIR = "/home/nemesis/project/trading-workspace/janus/docs/janus-spec"
os.makedirs(SPEC_DIR, exist_ok=True)

files = {}

# ==================== 000-overview.md ====================
files["000-overview.md"] = """# JDS-000: Janus Platform Overview & System Architecture
Version: 1.0
Status: Approved
Author: Principal Enterprise Architect

## 1. Introduction & Executive Summary
Janus is an autonomous, event-sourced, and market-ontology-driven Market Operating System (MOS) designed for crypto futures trading (specifically targeting CoinDCX and Binance). It represents a shift from static rule-based trading systems to a dynamic, regime-aware, and LLM-governed autonomous decision platform.

The system combines extremely low-latency market features calculation with a polymorphic market ontology graph and a multi-agent AI brain to achieve robust execution under varying market regimes.

```
+--------------------------------------------------------------------------+
|                             JANUS RUNTIME                                |
|                                                                          |
|  +--------------------+      +--------------------+      +------------+  |
|  |   Market Ingestion | ---> | Confluence Engine  | ---> |   Policy   |  |
|  |   (Binance/CoinDCX)|      | (Micro/Intra/Swing)|      |   Engine   |  |
|  +--------------------+      +--------------------+      +------------+  |
|           |                                                    |         |
|           v                                                    v         |
|  +--------------------+                              +------------+      |
|  | 3-Tier Graph State |                              | Det. Gov.  |      |
|  | (Active Ontologies)|                              +------------+      |
|  +--------------------+                                    |             |
|           |                                                v             |
|           +-----------------> +--------------+       +------------+      |
|                               |  LLM Brain   | ----> |  Execution |      |
|                               | Orchestration|       |   Engine   |      |
|                               +--------------+       +------------+      |
+------------------------------------------------------------|-------------+
                                                             |
                                                             v
                                                       [Exchange / REST]
```

## 2. Architectural Pillars

### 2.1 Domain-Driven Design (DDD)
The platform is organized into 7 clearly delineated Bounded Contexts. Business capabilities are encapsulated within Aggregates, ensuring consistent state boundaries and preventing logical leakage across context boundaries. All interactions between contexts are mediated through explicit commands, queries, and immutable domain events.

### 2.2 Event Sourcing & CQRS
The Write Model is an append-only event store. The state of all active components (such as TradeWorkflows, Positions, and Portfolios) is rebuilt by replaying their history.
The Read Model is separated (CQRS) and updated via asynchronous or in-memory projections, allowing low-latency dashboards and decision engines to query optimized representations of the system state.

### 2.3 Polymorphic Market Ontology Graph
Rather than processing market data purely as flat numeric arrays, Janus models the market as a structured graph of semantic entities (`MarketObjects`) connected by typed relationships (`Edges`). Price inefficiencies (Fair Value Gaps), liquidity pools, order blocks, and swings are detected dynamically and mapped to a 3-tier graph hierarchy (Runtime, Session, Historical).

### 2.4 Hybrid AI & Deterministic Governance (The Governed ReAct Loop)
A multi-agent LLM Brain orchestrates high-level planning, market regime classification, trade reviews, and post-trade reflections. However, the model is strictly sandboxed. The model cannot execute trades or modify parameters directly. Decisions are submitted as "proposals" to a **Deterministic Governor** (the Policy Engine) which validates them against hard-coded safety constraints before passing them to the execution adapters.

## 3. High-Level Data Flow

1. **Ingest & Feature Calculation**: Real-time websocket feeds from Binance and CoinDCX stream order books and trades. The `MarketStateManager` updates in-memory ring buffers and recalculates micro features (CVD, imbalance, spread, volatility).
2. **Ontology Detection**: As candles close, structural patterns (swings, FVGs, OBs) are identified and injected as nodes into the active market graph.
3. **Confluence Gating**: The confluence engine scores symbols every 30 seconds. A score >= 75 triggers a Signal Event.
4. **Brain Evaluation**: The `BrainOrchestrator` generates a market narrative and prompts the multi-agent stack. The AI analyzes the regime, retrieves historical episodes from Qdrant, and proposes a trade size, stop-loss, and target exit plan.
5. **Deterministic Validation**: The Policy Pipeline evaluates the proposal against risk limits, drawdown caps, and correlation rules.
6. **Execution**: The validated order is sent to the exchange. The `TradeWorkflow` state machine transitions to `Protected` once filled.
7. **Reflect & Adapt**: Upon workflow closure, the `TradeReflector` runs an offline post-mortem, updating PostgreSQL and Qdrant memory to adapt the system's behavior.
"""

# ==================== 001-ubiquitous-language.md ====================
files["001-ubiquitous-language.md"] = """# JDS-001: Ubiquitous Language & Domain Glossary
Version: 1.0
Status: Approved

This document establishes the ubiquitous language of the Janus platform. Developers, data scientists, domain experts, and AI agents must strictly adhere to these definitions.

| Term | Domain | Definition | Technical Representation |
| :--- | :--- | :--- | :--- |
| **Symbol** | Market | Unique identifier for a tradeable futures contract representing the asset pair (e.g. `BTC-USDT-PERP`). | String / Value Object |
| **Timeframe** | Market | Structured candle duration defining intervals of historical aggregation (e.g., `1m`, `5m`, `1h`, `1d`). | Enum |
| **Tick** | Market | An atomic price, size, and direction update from the exchange websocket. | Value Object |
| **OrderBook** | Market | A real-time Level 2 representation of limit bids and asks, providing depth and spread. | Value Object |
| **Feature** | Market | A mathematically derived indicator or metric calculated on market feeds (e.g. CVD, Imbalance, RSI, ATR). | Value Object |
| **MarketObject** | Market | Polymorphic base entity representing a structural pattern identified in market price action. | Entity (Polymorphic) |
| **Relationship** | Market | A semantic, typed edge connecting two `MarketObject` nodes in the market structure graph. | Value Object (Edge) |
| **MarketState** | Market | The global state snapshot containing all features, active market objects, and relationships. | Aggregate Root |
| **Strategy** | Strategy | The codified logic defining the criteria for market analysis, signal generation, and parameters. | Aggregate Root |
| **Signal** | Strategy | A structured trigger containing score, direction, and supporting data generated by the confluence engine. | Domain Event / Entity |
| **TradeWorkflow** | Execution | The state machine governing the lifecycle of a trade from draft, entry, protection, to exit. | Aggregate Root |
| **ExecutionPlan** | Execution | A set of parameters specifying target entry order, initial stop loss, and take profit targets. | Value Object |
| **Position** | Execution | The active exposure on the exchange, including margin, entry price, leverage, and unrealized PnL. | Entity |
| **Trade** | Execution | An individual executed fill, representing a transaction against an exchange order. | Value Object |
| **Portfolio** | Portfolio | The aggregate representing the user's account balance, equity, aggregate margin, and active exposure limits. | Aggregate Root |
| **Episode** | Brain | A structured log of a complete trade lifecycle including pre-trade market state, AI decisions, and PnL. | Entity / Vector Payload |
| **Reflection** | Brain | A post-mortem narrative assessment generated by the AI Reflector analyzing why a trade succeeded or failed. | Value Object |
| **Memory** | Brain | Vectorized episodic experiences stored in Qdrant, queried using semantic similarity for trade review. | Vector Store Node |

## Contextual Nuances

* **Position vs Trade**: A `Position` represents the ongoing financial liability on the exchange, while a `Trade` represents a single transaction (fill) that changes the position's size.
* **Signal vs Strategy**: A `Strategy` is a long-standing ruleset. A `Signal` is an transient event produced by a Strategy scoring engine.
* **MarketObject vs Feature**: A `Feature` is an atomic, numeric calculation updated on ticks/candles (e.g. RSI). A `MarketObject` is an object with structural bounds and a defined lifecycle (e.g. an OrderBlock).
"""

# ==================== 002-bounded-contexts.md ====================
files["002-bounded-contexts.md"] = """# JDS-002: Delineation of Bounded Contexts
Version: 1.0
Status: Approved

Janus is partitioned into 7 Bounded Contexts to isolate domains, preserve local consistency, and structure aggregate lifecycles.

```mermaid
graph TD
    MarketContext[Market Context] -->|MarketStateEvents| StrategyContext[Strategy Context]
    MarketContext -->|GraphProjections| BrainContext[Brain Context]
    StrategyContext -->|SignalEvents| ExecutionContext[Execution Context]
    ExecutionContext -->|OrderEvents| RiskContext[Risk Context]
    RiskContext -->|ApprovalEvents| ExecutionContext
    ExecutionContext -->|PositionEvents| PortfolioContext[Portfolio Context]
    ExecutionContext -->|TradeClosingEvents| BrainContext
    BrainContext -->|Proposals| RiskContext
    ResearchContext[Research Context] -->|ParamUpdates| StrategyContext
    PortfolioContext -->|MarginLimits| RiskContext
```

---

## 1. Market Context
* **Responsibility**: Ingestion of raw feeds, calculation of technical features, identification of structural market objects, and maintaining the active Market Graph.
* **Aggregate Roots**: `MarketStateAggregate`
* **Key Entities**: `MarketObject`, `OrderBookSnapshot`
* **Value Objects**: `Tick`, `FeatureMap`, `Edge`
* **Dependencies**: None.

## 2. Strategy Context
* **Responsibility**: Houses strategies, processes market state, runs the confluence signal loop, and generates trade triggers.
* **Aggregate Roots**: `StrategyAggregate`
* **Key Entities**: `Signal`
* **Value Objects**: `ConfluenceScore`, `RuleDefinition`
* **Dependencies**: `Market Context` (subscribes to `MarketStateEvent` and queries active levels).

## 3. Execution Context
* **Responsibility**: Translates signals into exchange orders, manages the `TradeWorkflow` state machine, and monitors trailing execution stop-loss loops.
* **Aggregate Roots**: `TradeWorkflow`
* **Key Entities**: `Position`, `Order`
* **Value Objects**: `ExecutionPlan`, `Trade`
* **Dependencies**: `Risk Context` (pre-execution verification), `Strategy Context` (receives signals).

## 4. Risk Context
* **Responsibility**: Computes leverage limits, monitors account drawdown, acts as the Deterministic Governor, and runs pre-execution checks.
* **Aggregate Roots**: `RiskProfileAggregate`
* **Key Entities**: `KillSwitch`, `SafetyGate`
* **Value Objects**: `RiskScore`, `MarginRequirement`
* **Dependencies**: `Portfolio Context` (leverage & margin balances).

## 5. Portfolio Context
* **Responsibility**: Reconciles local and exchange positions, calculates realized PnL, handles account balance tracking and funding rate payments.
* **Aggregate Roots**: `PortfolioAggregate`
* **Key Entities**: `AccountBalance`, `HistoricalTrade`
* **Value Objects**: `FundingFee`, `SlippageMetric`
* **Dependencies**: `Execution Context` (receives position closed events).

## 6. Brain Context
* **Responsibility**: Coordinates multi-agent LLM analysis, creates market narratives, compiles episodic memory, and maintains Qdrant vector projections.
* **Aggregate Roots**: `BrainEpisodeAggregate`
* **Key Entities**: `Episode`, `MarketNarrative`
* **Value Objects**: `Reflection`, `SemanticEmbedding`
* **Dependencies**: `Market Context` (needs structures), `Portfolio Context` (needs balances), `Execution Context` (needs trade outcomes).

## 7. Research Context
* **Responsibility**: Manages offline backtests, genetic parameter optimizations, and rules promotion pipelines.
* **Aggregate Roots**: `BacktestSuite`
* **Key Entities**: `SimulationResult`, `CandidateRule`
* **Value Objects**: `BacktestReport`
* **Dependencies**: `Market Context` (historical tick database).
"""

# ==================== 003-domain-model.md ====================
files["003-domain-model.md"] = """# JDS-003: Core Domain Model Specification
Version: 1.0
Status: Approved

This document defines the structural entities, value objects, aggregate roots, and associated TypeScript definitions for Janus.

```
+-------------------------------------------------------------------------------+
|                               MARKET CONTEXT                                  |
|                                                                               |
|  +----------------------+                                                     |
|  | MarketStateAggregate |                                                     |
|  |   - Symbol           |                                                     |
|  |   - FeaturesMap      | -----> (List of MarketObjects)                      |
|  |   - Relationships    |                                                     |
|  +----------------------+                                                     |
+-------------------------------------------------------------------------------+
+-------------------------------------------------------------------------------+
|                              EXECUTION CONTEXT                                |
|                                                                               |
|  +-----------------------+        +--------------------+                      |
|  | TradeWorkflow         | -----> | ExecutionPlan      |                      |
|  |   - WorkflowId        |        |   - EntryOrder     |                      |
|  |   - WorkflowState     |        |   - InitialSL      |                      |
|  |   - ActivePosition    |        |   - TargetTP       |                      |
|  +-----------------------+        +--------------------+                      |
+-------------------------------------------------------------------------------+
```

## 1. Market Context

### 1.1 MarketStateAggregate
Represents the complete picture of a single symbol's status at any given timestamp.
```typescript
interface MarketStateAggregate {
  symbol: string;
  timestamp: Date;
  timeframe: string;
  latestPrice: number;
  features: FeatureMap;
  activeObjects: MarketObject[];
  relationships: Relationship[];
}

interface FeatureMap {
  cvd: number;
  rsi: number;
  atr: number;
  volumeImbalance: number;
  orderBookSpread: number;
  fundingRate: number;
}
```

## 2. Strategy Context

### 2.1 StrategyAggregate
Defines the parameters and criteria used to identify trade setups.
```typescript
interface StrategyAggregate {
  strategyId: string;
  name: string;
  isEnabled: boolean;
  confluenceRules: ConfluenceRule[];
  minGatingScore: number; // e.g. 75
}

interface ConfluenceRule {
  ruleId: string;
  component: 'micro' | 'intra' | 'swing';
  weight: number;
  evaluatorCode: string;
}
```

## 3. Execution Context

### 3.1 TradeWorkflow (Aggregate Root)
FSM governing the progression of an active trade.
```typescript
interface TradeWorkflow {
  workflowId: string;
  symbol: string;
  strategyId: string;
  state: 'DRAFT' | 'ENTRY_SUBMITTED' | 'PROTECTED' | 'TRAILING' | 'EXITING' | 'CLOSED';
  executionPlan: ExecutionPlan;
  activeOrders: Order[];
  associatedPosition?: Position;
  createdAt: Date;
  updatedAt: Date;
}

interface ExecutionPlan {
  direction: 'LONG' | 'SHORT';
  sizeMultiplier: number;
  limitPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  trailingStopPct: number;
}

interface Order {
  orderId: string;
  exchangeOrderId: string;
  type: 'LIMIT' | 'MARKET' | 'STOP_MARKET';
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';
}

interface Position {
  positionId: string;
  symbol: string;
  size: number;
  entryPrice: number;
  marginType: 'ISOLATED' | 'CROSS';
  leverage: number;
  unrealizedPnl: number;
}
```

## 4. Risk Context

### 4.1 RiskProfileAggregate
Stores risk boundaries per trading account.
```typescript
interface RiskProfileAggregate {
  accountId: string;
  maxLeverage: number;
  maxPositionSizeUsdt: number;
  maxDailyDrawdownPct: number;
  currentDailyDrawdownPct: number;
  killSwitchActive: boolean;
}
```

## 5. Portfolio Context

### 5.1 PortfolioAggregate
```typescript
interface PortfolioAggregate {
  portfolioId: string;
  userId: string;
  totalBalanceUsdt: number;
  availableMarginUsdt: number;
  maintenanceMarginUsdt: number;
  activeWorkflows: string[]; // workflowIds
}
```

## 6. Brain Context

### 6.1 BrainEpisodeAggregate
```typescript
interface BrainEpisodeAggregate {
  episodeId: string;
  workflowId?: string;
  marketNarrative: MarketNarrative;
  proposals: TradeProposal[];
  decisions: BrainDecision[];
  outcome?: EpisodeOutcome;
}

interface MarketNarrative {
  timestamp: Date;
  regime: 'TREND' | 'RANGE' | 'VOLATILE';
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  contextSummary: string;
}

interface TradeProposal {
  proposedAt: Date;
  suggestedSize: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
}

interface BrainDecision {
  reviewerAgent: string;
  decision: 'APPROVE' | 'REJECT' | 'REDUCE';
  adjustedSize?: number;
  rationale: string;
}

interface EpisodeOutcome {
  realizedPnL: number;
  rMultiple: number;
  reflectionNotes: string;
}
```
"""

# ==================== 004-market-ontology.md ====================
files["004-market-ontology.md"] = """# JDS-004: Market Ontology & Structural Taxonomy
Version: 1.0
Status: Approved

Market structures are modeled as typed nodes inheriting from a common ancestor. This document details the properties of these structures.

```
                  +-------------------------+
                  |   MarketObject (Base)   |
                  +-------------------------+
                               |
       +-----------------------+------------------------+
       |                       |                        |
+--------------+        +--------------+        +---------------+
| FairValueGap |        | LiquidityPool|        |   OrderBlock  |
+--------------+        +--------------+        +---------------+
```

## 1. The Base MarketObject Schema
All ontology objects must subclass `MarketObject` to maintain a unified identity inside our graph projections:

```typescript
abstract class MarketObject {
  id: string; // Unique UUID
  symbol: string; // e.g. BTC-USDT
  timeframe: string; // e.g. 15m
  creationTimestamp: number; // Unix timestamp
  expiryTimestamp?: number; // Optional automatic pruning
  startPrice: number; // Upper/lower boundary
  endPrice: number; // Upper/lower boundary
  candleIndexStart: number; // Relative anchor in series
  candleIndexEnd?: number; // Relative closure in series
  isInvalidated: boolean;
  invalidatedAtTimestamp?: number;
}
```

## 2. Child Market Objects

### 2.1 Fair Value Gap (FVG)
An imbalance caused by rapid movement where three consecutive candles show a gap between the 1st candle's wick and the 3rd candle's wick.

* **Attributes**:
  * `imbalanceType`: `'BISI'` (Buyside Imbalance Sellside Inefficiency - bullish gap) or `'SIBI'` (Sellside Imbalance Buyside Inefficiency - bearish gap).
  * `volumeImbalanceRatio`: Number representing relative volume within the imbalance zone.
  * `mitigationPct`: Percentage of the gap filled by subsequent price action.

### 2.2 Liquidity Pool
Zones containing significant pending stop orders, usually located above key swing highs or below swing lows.

* **Attributes**:
  * `poolType`: `'BUY_SIDE'` (above resistance) or `'SELL_SIDE'` (below support).
  * `accumulatedVolume`: Estimated liquidity volume clustered around the level.
  * `sweepCount`: Number of times this level has been pierced without invalidation.

### 2.3 Order Block (OB)
The candle sequence preceding a sharp directional move, indicating institutional order positioning.

* **Attributes**:
  * `obDirection`: `'BULLISH'` or `'BEARISH'`.
  * `volumePOC`: Point of control volume value within the order block candle.
  * `isMitigated`: Boolean showing whether the price has re-entered this block.

### 2.4 Swing High / Swing Low
Local extrema used to build market structures.

* **Attributes**:
  * `swingType`: `'HIGH'` or `'LOW'`.
  * `strength`: Number of surrounding candles checked for the peak (e.g., 5-candle swing, 9-candle swing).
  * `isSwept`: True if a subsequent wick has breached the extreme.
"""

# ==================== 005-capabilities.md ====================
files["005-capabilities.md"] = """# JDS-005: Composed Capabilities & Polymorphic Traits
Version: 1.0
Status: Approved

To avoid deep inheritance trees, Janus applies a mixin/trait design pattern. MarketObjects compose behaviors through explicit runtime Capabilities.

```
       +---------------------------------------------+
       |                 MarketObject                |
       +---------------------------------------------+
         /                   |                     \\
+-----------------+ +-------------------+ +-----------------+
|   Mitigatable   | |   Invalidatable   | |    Tradable     |
|  - isMitigated  | |  - isInvalidated  | |  - targetEntry  |
|  - mitigation%  | |  - invalidAtPrice | |  - targetSL     |
+-----------------+ +-------------------+ +-----------------+
```

## 1. Traits Definitions

### 1.1 Mitigatable
Applied to objects that can be filled, retested, or partially offset by price action over time.
```typescript
interface Mitigatable {
  isMitigated: boolean;
  mitigationPrice: number;
  mitigationRatio: number; // Value between 0.0 (open) and 1.0 (fully filled)
  checkMitigation(currentPrice: number, high: number, low: number): void;
}
```

### 1.2 Invalidatable
Applied to structures that are considered broken or defunct once price crosses a terminal threshold.
```typescript
interface Invalidatable {
  isInvalidated: boolean;
  invalidatedAtPrice?: number;
  invalidationReason?: 'VIOLATED' | 'EXPIRED' | 'OVERRIDDEN';
  checkInvalidation(price: number): boolean;
}
```

### 1.3 Structural
Designates an object as a foundational anchor point for drawing market bias lines or swing zones.
```typescript
interface Structural {
  strengthRating: number; // scale 1 to 10
  significance: 'MINOR' | 'MAJOR' | 'REGIME_LEVEL';
  getAnchorLevel(): number;
}
```

### 1.4 Tradable
Applied to objects that can directly serve as parameters for order setups.
```typescript
interface Tradable {
  getOptimalEntry(direction: 'LONG' | 'SHORT'): number;
  getLogicalStopLoss(direction: 'LONG' | 'SHORT'): number;
  getLogicalTakeProfit(direction: 'LONG' | 'SHORT', riskReward: number): number;
}
```

## 2. Composed Concrete Examples

| MarketObject | Mitigatable | Invalidatable | Structural | Tradable |
| :--- | :---: | :---: | :---: | :---: |
| **Fair Value Gap (FVG)** | Yes | Yes | No | Yes |
| **Order Block (OB)** | Yes | Yes | Yes | Yes |
| **Swing Low** | No | Yes | Yes | Yes |
| **Liquidity Pool** | No | Yes | Yes | Yes |
| **Volume Profile Node** | No | No | Yes | No |
"""

# ==================== 006-relationships.md ====================
files["006-relationships.md"] = """# JDS-006: Relationship Ontology & Graph Projections
Version: 1.0
Status: Approved

Markets are not disjointed objects; they are semantic graphs. This spec defines the edges that connect `MarketObjects` and the 3-Tier Graph projection architecture.

```
 [OrderBlock A] -- INVALIDATES --> [FairValueGap B]
 [Swing High C] -- SWEEPS --------> [LiquidityPool D]
```

## 1. Relationship Types (Edges)

### 1.1 FILLS
* **Source**: Price Action / Candle
* **Target**: `FairValueGap` (Mitigatable)
* **Meaning**: Price has entered the FVG gap boundaries, reducing its inefficiency.

### 1.2 CONTAINS
* **Source**: `MarketObject` (Higher Timeframe)
* **Target**: `MarketObject` (Lower Timeframe)
* **Meaning**: Represents multi-timeframe nested structures (e.g. 4H OrderBlock contains a 15M OrderBlock).

### 1.3 TRIGGERS
* **Source**: `Swing`
* **Target**: `MarketStructureShift` (MSS)
* **Meaning**: Breach of a swing extreme initiates a structural change of trend.

### 1.4 INVALIDATES
* **Source**: Price Action
* **Target**: `MarketObject` (Invalidatable)
* **Meaning**: Price closed past the invalidation threshold of an active structure.

### 1.5 SWEEPS
* **Source**: Price Action / Wick
* **Target**: `LiquidityPool`
* **Meaning**: High or Low wick penetrated the pool before reversing.

### 1.6 RETESTS
* **Source**: Price Action
* **Target**: `OrderBlock` or `Swing`
* **Meaning**: Price has returned to the boundary of a previously established level.

---

## 2. The 3-Tier Graph Architecture

To handle data volume and execution speeds, graph projections are stratified:

```
+-------------------------------------------------------------------------+
|                              3-TIER GRAPH                               |
|                                                                         |
|  +---------------------------+                                          |
|  |       Runtime Graph       |  --> In-memory Ring Buffers (0-30s)      |
|  +---------------------------+                                          |
|                |                                                        |
|  +---------------------------+                                          |
|  |       Session Graph       |  --> RedisJSON Warm Cache (24 hours)     |
|  +---------------------------+                                          |
|                |                                                        |
|  +---------------------------+                                          |
|  |     Historical Graph      |  --> PostgreSQL (Weeks/Months)           |
|  +---------------------------+                                          |
+-------------------------------------------------------------------------+
```

### 2.1 Tier 1: Runtime Graph (Memory)
* **Storage**: In-memory TypeScript collections and sliding window buffers.
* **Lookback**: 0 - 30 seconds.
* **Latency**: < 1ms.
* **Purpose**: Feeds the fast execution trailing engines and immediate safety governors.

### 2.2 Tier 2: Session Graph (Warm Cache)
* **Storage**: RedisJSON and RedisGraph.
* **Lookback**: Up to 24 hours.
* **Latency**: 5 - 20ms.
* **Purpose**: Underpins the 30-second Confluence Strategy Loop and the AI Brain Analyst.

### 2.3 Tier 3: Historical Graph (Deep Storage)
* **Storage**: PostgreSQL with specialized node/edge tables or TimescaleDB.
* **Lookback**: Weeks to Months.
* **Latency**: 100 - 500ms.
* **Purpose**: Feeds the offline Trade Reflector and nightly Researcher backtesting engines.
"""

# ==================== 007-state-machines.md ====================
files["007-state-machines.md"] = """# JDS-007: MarketObject State Machines & Lifecycles
Version: 1.0
Status: Approved

Each `MarketObject` maintains a state lifecycle to control indexing efficiency and prevent stale structures from gating trades.

## 1. Liquidity Pool State Machine

```mermaid
stateDiagram-v2
    [*] --> Detected : Swing High/Low Confirmed
    Detected --> Swept : Wick crosses extreme boundary
    Swept --> Consumed : Close price breaches extreme
    Swept --> Invalidated : Expired or trend regime shift
    Consumed --> [*]
    Invalidated --> [*]
```

### Transition Triggers
* **Detected -> Swept**: Triggered when a tick or candle wick penetrates the level, producing a `LiquiditySweptEvent`.
* **Swept -> Consumed**: Triggered when a candle closes beyond the level, turning resistance into support or vice versa.
* **Swept -> Invalidated**: Triggered if the structure is active too long without action, or the Risk Context flags a market regime reversal.

---

## 2. Fair Value Gap (FVG) State Machine

```mermaid
stateDiagram-v2
    [*] --> Open : 3-candle sequence imbalance
    Open --> PartiallyMitigated : Price enters gap zone
    PartiallyMitigated --> FullyMitigated : 100% of gap is filled
    PartiallyMitigated --> Invalidated : Price closes past gap invalidation extreme
    FullyMitigated --> [*]
    Invalidated --> [*]
```

### Transition Triggers
* **Open -> PartiallyMitigated**: Triggered when a subsequent price tick crosses into the gap zone.
* **PartiallyMitigated -> FullyMitigated**: Triggered when the cumulative price path covers the start-to-end price of the gap.
* **PartiallyMitigated -> Invalidated**: Triggered when a candle closes completely past the invalidation price boundary.
"""

# ==================== 008-events.md ====================
files["008-events.md"] = """# JDS-008: Core Domain Event Catalog
Version: 1.0
Status: Approved

Domain events are published to notify subscribers of state modifications across all Bounded Contexts.

## 1. Market Context Events

### `MarketDataReceived`
* **Payload**: `symbol`, `timestamp`, `bid`, `ask`, `lastTradePrice`, `volume`.
* **Description**: Raw ticker information normalized from websocket feed.

### `FairValueGapDetected`
* **Payload**: `gapId`, `symbol`, `direction` ('BULLISH'|'BEARISH'), `startPrice`, `endPrice`, `candleIndex`.
* **Description**: A new FVG has been identified in market structure.

### `LiquiditySwept`
* **Payload**: `poolId`, `symbol`, `sweepPrice`, `sweptVolume`, `timestamp`.
* **Description**: A wick swept an active liquidity pool.

---

## 2. Strategy Context Events

### `SignalGated`
* **Payload**: `signalId`, `symbol`, `strategyId`, `score`, `direction`, `indicatorsSnapshot`.
* **Description**: Confluence loop finished scoring a symbol and met the gating score threshold (>=75).

---

## 3. Execution Context Events

### `TradeWorkflowStarted`
* **Payload**: `workflowId`, `symbol`, `strategyId`, `direction`, `targetEntry`.
* **Description**: Initiates a new trade execution state.

### `OrderSubmitted`
* **Payload**: `orderId`, `workflowId`, `exchangeOrderId`, `price`, `qty`, `side`.
* **Description**: Order successfully sent to the remote exchange.

### `PositionOpened`
* **Payload**: `positionId`, `workflowId`, `symbol`, `entryPrice`, `qty`, `timestamp`.
* **Description**: Entry order fill confirmed. Position is now active.

### `TrailingStopUpdated`
* **Payload**: `workflowId`, `previousSL`, `newSL`, `triggerPrice`.
* **Description**: Trailing stop loss has locked in additional profit or reduced risk.

---

## 4. Risk Context Events

### `RiskThresholdBreached`
* **Payload**: `accountId`, `metric`, `breachedValue`, `allowedValue`.
* **Description**: Pre-flight or active limits crossed, triggering immediate adjustments or trade block.

### `KillSwitchTriggered`
* **Payload**: `reason`, `triggeredBy`, `timestamp`.
* **Description**: Emergency halt of all execution and immediate order cancellation.

---

## 5. Brain Context Events

### `BrainPlanProposed`
* **Payload**: `episodeId`, `proposalId`, `suggestedAction`, `sizeMultiplier`, `rationale`.
* **Description**: AI multi-agent planner has formulated a trade proposal.

### `EpisodeReflected`
* **Payload**: `episodeId`, `pnl`, `lessons`, `promotedCandidates`.
* **Description**: Post-trade analysis completed by the LLM Trade Reflector.
"""

# ==================== 009-event-envelope.md ====================
files["009-event-envelope.md"] = """# JDS-009: Domain Event Envelope Schema
Version: 1.0
Status: Approved

Every event published within the Janus platform must adhere to the standard envelope schema to guarantee traceability, deduplication, and transactional auditability.

## 1. Schema Definition

```typescript
interface DomainEventEnvelope<T = any> {
  // Tracing Headers
  eventId: string;          // UUID v4 unique to this execution instance
  eventType: string;        // e.g. "janus.market.fvg_detected"
  aggregateId: string;      // ID of the target aggregate (e.g. workflowId or symbol)
  aggregateType: string;    // e.g. "TradeWorkflow", "MarketState"
  sequenceNumber: number;   // Monotonically increasing index for the aggregate stream
  
  // Tracing Context
  correlationId: string;    // Traces the origin request (e.g. SignalGated -> OrderSubmitted)
  causationId: string;      // Traces the immediate preceding cause event
  
  // Metadata & Timestamps
  timestamp: string;        // ISO 8601 UTC string
  engineVersion: string;    // e.g. "1.0.0"
  actor: {
    id: string;             // System component or agent ID (e.g., "confluence-loop")
    type: 'SYSTEM' | 'LLM_AGENT' | 'OPERATOR';
  };
  
  // Custom Payload
  payload: T;
}
```

## 2. Correlation and Causation Propagation Rules

```
[WebSocket Ticks]
       |
       v (Event 101, Correlation A, Causation A)
[SignalGatedEvent]
       |
       v (Event 102, Correlation A, Causation 101)
[BrainPlanProposedEvent]
       |
       v (Event 103, Correlation A, Causation 102)
[OrderSubmittedEvent]
```

1. **Root Event Creation**: When a root event is generated (e.g. a tick received), a new `correlationId` is generated. The `causationId` is set equal to the `eventId`.
2. **Downstream Propagation**: Any event generated as a consequence of handling a previous event MUST clone the incoming `correlationId`. The `causationId` of the new event MUST be set to the `eventId` of the trigger event.
3. **Audit Tracking**: Projections and monitoring tools trace these IDs to construct timelines of why decisions were made.
"""

# ==================== 010-cqrs.md ====================
files["010-cqrs.md"] = """# JDS-010: CQRS Command & Query Model Separation
Version: 1.0
Status: Approved

Janus uses Command Query Responsibility Segregation (CQRS) to isolate complex state manipulation logic from performant query views.

```
       [Command]
           |
           v
  +------------------+
  | Command Handler  |
  +------------------+
           | (Validation)
           v
  +------------------+
  |   Event Store    | ---> [Immutable Event Logs]
  +------------------+
           | (Publish Async)
           v
  +------------------+
  |  Projection Svc  |
  +------------------+
           |
           v
  +------------------+
  |    Read Model    | <--- [Query / Dashboard]
  +------------------+
```

## 1. Write Model (Event Store)
The Write Model processes incoming state modifications via **Commands**. It is strictly append-only:
* **State Mutation**: The state of an aggregate is never modified directly. Instead, a command handler verifies the command, generates domain events, and appends them to the aggregate's event stream.
* **Concurrency**: Optimistic concurrency control is enforced by matching the target `sequenceNumber` during append. If the database sequence has advanced, the transaction aborts and the system retries.

## 2. Read Model (Projections)
The Query side listens to events and rebuilds views optimized for lookups and UI visualizations:
* **Asynchronous Updates**: Read model updates are separated from the main transaction, preventing database contention from slowing execution.
* **Storage Customization**: While write logs are serialized in PostgreSQL tables, read models can be stored in Redis (for fast trailing stops) or Qdrant (for vector similarity).
* **Direct Access**: Read models are accessed via Hono/tRPC and cannot mutate state directly. They must use the command dispatch channel.
"""

# ==================== 011-projections.md ====================
files["011-projections.md"] = """# JDS-011: Read Models & Graph Projections Spec
Version: 1.0
Status: Approved

This specification maps domain events to active Read Models and details the projection rebuilding (replay) strategy.

## 1. CurrentPositionReadModel
Maintains the real-time status of active exposures. Updated in RedisJSON.

```typescript
interface CurrentPositionReadModel {
  positionId: string;
  workflowId: string;
  symbol: string;
  entryPrice: number;
  currentMarkPrice: number;
  size: number;
  unrealizedPnL: number;
  rMultiple: number;
  trailingStopPrice: number;
  lastUpdated: string;
}
```
* **Event Handlers**:
  * `PositionOpened`: Create record.
  * `MarkPriceUpdated`: Recompute `unrealizedPnL` and `rMultiple`.
  * `TrailingStopUpdated`: Update `trailingStopPrice`.
  * `TradeWorkflowClosed`: Delete or flag as closed.

## 2. ActiveMarketObjectsReadModel
Maintains active (unmitigated/uninvalidated) key levels.

* **Event Handlers**:
  * `FairValueGapDetected`: Add FVG.
  * `OrderBlockDetected`: Add OB.
  * `PriceWickSwept`: Check mitigation ratios, update mitigation metrics.
  * `MarketObjectInvalidated`: Remove or flag as inactive.

---

## 3. Projection Rebuilding & Replay Strategy

If the read models are corrupted, they can be fully reconstructed using the **Event Store Replay Engine**:

```
[Target: AggregateId / Timestamp]
              │
              ▼
[Raw Event Store Postgres (Truncate Read Table)]
              │
              ▼
[Sequentially Stream Events (Chronological Order)]
              │
              ▼
[Apply Events to Projection Reducers]
              │
              ▼
[Write Rebuilt Records to Redis/Postgres Graph]
```

1. **Truncation**: Empty the targeted read model tables or Redis keys.
2. **Sequential Stream**: Query the PostgreSQL event store for all events, ordered by `timestamp` and `sequenceNumber` ascending.
3. **Reduce**: Pass the event stream through the projection's reducer logic.
4. **Bulk Upsert**: Write the finalized state to the warm store.
"""

# ==================== 012-workflows.md ====================
files["012-workflows.md"] = """# JDS-012: TradeWorkflow Finite State Machine Spec
Version: 1.0
Status: Approved

The `TradeWorkflow` manages the lifecycle of trade execution and risk protection. It prevents race conditions and duplicate order placement.

```mermaid
stateDiagram-v2
    [*] --> Draft : Signal gating >= 75
    Draft --> EntrySubmitted : AI Vetting & Governor approve
    EntrySubmitted --> Protected : Entry order filled completely
    Protected --> Trailing : Price moves in favor (R-Multiple > 1.0)
    Trailing --> Exiting : Trailing stop or profit target hit
    Protected --> Exiting : Stop loss breached
    Exiting --> Closed : Order filled & cleaned
    Closed --> [*]
```

## 1. States & Transitions

### 1.1 Draft
* **Description**: Triggered by a signal score >= 75. A tentative plan is formulated.
* **Transition**: Moves to `EntrySubmitted` once the LLM Brain and Deterministic Governor approve size and risk parameters.

### 1.2 EntrySubmitted
* **Description**: Entry orders (limit) are placed on the exchange.
* **Transition**:
  * Moves to `Protected` on fill confirmation (`PositionOpened`).
  * Moves to `Closed` if the order is cancelled (timeout or price deviation).

### 1.3 Protected
* **Description**: Position is active. Stop-loss and take-profit orders are set.
* **Transition**:
  * Moves to `Trailing` when price movement reaches target ratios.
  * Moves to `Exiting` if the stop-loss is hit.

### 1.4 Trailing
* **Description**: Stop-loss is dynamically tracked upward/downward behind price.
* **Transition**: Moves to `Exiting` if trailing stop triggers are hit.

### 1.5 Exiting
* **Description**: Order is submitted to close the active position.
* **Transition**: Moves to `Closed` when position sizes return to zero.

### 1.6 Closed
* **Description**: Trade workflow completed. Ephemeral parameters cleared.
"""

# ==================== 013-policy-engine.md ====================
files["013-policy-engine.md"] = """# JDS-013: Pre-Execution Policy Engine & Pipeline
Version: 1.0
Status: Approved

The Policy Engine serves as the **Deterministic Governor**. It is the last line of defense before any order is submitted to the exchange wrapper.

```
       [Proposed Trade Plan]
                |
                v
       +------------------+
       |   Risk Policy    | ---> (Verify sizes and drawdown)
       +------------------+
                |
                v
       +------------------+
       |   News Policy    | ---> (Check calendar for volatility)
       +------------------+
                |
                v
       +------------------+
       |  Session Policy  | ---> (Assess hour limits & spreads)
       +------------------+
                |
                v
       +------------------+
       |    AI Policy     | ---> (Verify confidence score)
       +------------------+
                |
                v
       [Authorized Trade Plan]
```

## 1. Pipeline Execution Model
The engine is structured as a pipeline of independent filters (Chain of Responsibility). If any filter fails, the pipeline aborts, logs the failure cause, and marks the proposal as rejected.

```typescript
interface PolicyFilter {
  name: string;
  evaluate(proposal: ExecutionPlan, context: SystemContext): Promise<PolicyResult>;
}

interface PolicyResult {
  passed: boolean;
  rejectReason?: string;
  adjustedPlan?: ExecutionPlan; // Can trim sizes but never expand risk parameters
}
```

## 2. Standard Filters

### 2.1 Risk Policy
* **Drawdown Constraint**: Aborts execution if the daily account drawdown is >= 5%.
* **Size Cap**: Restricts order size to a maximum percentage of account equity.
* **Leverage Cap**: Gated strictly to 5x for isolated, 3x for cross-margin setups.

### 2.2 News Policy
* **Macro Buffer**: Prevents new entries within 15 minutes before or 15 minutes after high-impact economic news releases.

### 2.3 Session Policy
* **Regime Check**: Aborts if bid-ask spread is higher than the historical 95th percentile, indicating abnormal volatility.

### 2.4 AI Policy
* **Vetting Verification**: Rejects any trade proposed by the Signal Engine if the LLM Brain's confidence score is < 70%.
"""

# ==================== 014-ai.md ====================
files["014-ai.md"] = """# JDS-014: AI Brain & Semantic Layers Specification
Version: 1.0
Status: Approved

This document details the Semantic Layer, specialized agent communication, and Qdrant memory integration.

```
 +-----------------------------------------------------------------------------+
 |                              NARRATIVE PIPELINE                             |
 |                                                                             |
 |  [Raw Market Data] ---> [NarrativeBuilder] ---> Market Narrative (JSON)     |
 |                                                      |                      |
 |  [Trade Outcome]  ---> [EpisodeBuilder]   ---> Episode Log                  |
 |                                                      |                      |
 |  [Episode Log]    ---> [SemanticEncoder]  ---> Qdrant (Vector DB)           |
 +-----------------------------------------------------------------------------+
```

## 1. Episode Builder
The `EpisodeBuilder` formats the context, decisions, and outcome of a trade into a structured payload for semantic storage.

```typescript
interface Episode {
  episodeId: string;
  timestamp: string;
  symbol: string;
  narrativeText: string;
  scoreSnapshot: number;
  reasoningTrace: string;
  actionTaken: 'LONG' | 'SHORT' | 'SKIPPED';
  resultPnLUstd: number;
  rMultiple: number;
}
```

## 2. Narrative Builder
Compresses real-time market data into a semantic summary. This narrative is injected into LLM prompts, providing historical continuity.

* **Inputs**:
  * 3-Tier market graph structures.
  * CVD momentum.
  * Funding rates.
* **Outputs**: Textual summary: `"Market is in a bullish expansion, sweeping sell-side liquidity at 42100. CVD shows long absorption, and funding is neutral."`

## 3. Qdrant Episodic Memory
Episodes are embedded using sentence-transformers and stored in a Qdrant collection named `janus_episodes`.

```json
{
  "vectors": {
    "size": 384,
    "distance": "Cosine"
  },
  "payload": {
    "episodeId": "uuid-v4",
    "symbol": "BTC-USDT",
    "result": "LOSS",
    "rMultiple": -1.0,
    "regime": "TREND"
  }
}
```

### Retrieval Logic
Before authorizing a trade proposal:
1. Embed the current market narrative.
2. Search `janus_episodes` for the top 3 similar past episodes.
3. Inject those outcomes into the `TradeReviewer` prompt to prevent repeating historical mistakes.
"""

# ==================== 015-storage.md ====================
files["015-storage.md"] = """# JDS-015: Storage Architecture & Infrastructure Stratification
Version: 1.0
Status: Approved

Janus uses a tiered data layout, selecting storage technologies according to latency, reliability, and search requirements.

| Layer | Technology | Data Elements | Latency Target |
| :--- | :--- | :--- | :--- |
| **Write Model & Logs** | PostgreSQL (Drizzle) | Domain Events, Audits, Core tables | < 5ms |
| **Warm Graph & FSM** | RedisJSON & RedisGraph | Active positions, transient variables | < 1ms |
| **Episodic Memory** | Qdrant | Vector embeddings of market episodes | < 15ms |

```
                +----------------------------+
                |     Inbound Data Events    |
                +----------------------------+
                 /             |            \\
                v              v             v
       +-------------+  +-------------+  +-------------+
       | PostgreSQL  |  |    Redis    |  |   Qdrant    |
       | Event Store |  | JSON/Graph  |  | Vector DB   |
       +-------------+  +-------------+  +-------------+
```

## 1. PostgreSQL Schema (Drizzle ORM Mapping)
Core table definition for the append-only event store:

```sql
CREATE TABLE domain_events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(255) NOT NULL,
  aggregate_id VARCHAR(255) NOT NULL,
  aggregate_type VARCHAR(255) NOT NULL,
  sequence_number INT NOT NULL,
  correlation_id VARCHAR(255) NOT NULL,
  causation_id VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  metadata JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT unique_aggregate_sequence UNIQUE(aggregate_id, sequence_number)
);

CREATE INDEX idx_correlation_id ON domain_events(correlation_id);
```

## 2. Redis Configuration
* **Persistence**: Append Only File (AOF) enabled with `everysec` updates to survive crashes without blocking writes.
* **Data Types**:
  * RedisJSON for active position state.
  * Redis Streams for inter-process communication.

## 3. Qdrant Setup
* **Index Configuration**: Scalar quantization enabled to reduce memory footprints.
* **Vector Fields**: `384-dimensional` vector mapped to `nomic-embed-text` embeddings.
"""

# ==================== 016-api-contracts.md ====================
files["016-api-contracts.md"] = """# JDS-016: Internal API Contracts & Schema Spec
Version: 1.0
Status: Approved

Janus processes internal communication using Hono and tRPC, ensuring type safety from backend to dashboard.

## 1. Queries (tRPC Schemas)

### `getMarketState`
* **Input**: `z.object({ symbol: z.string(), timeframe: z.string() })`
* **Output**: `z.object({ latestPrice: z.number(), activeMarketObjects: z.array(MarketObjectSchema) })`

### `getActivePositions`
* **Input**: `z.object({ userId: z.string() })`
* **Output**: `z.array(PositionSchema)`

---

## 2. Mutations

### `dispatchCommand`
* **Input**:
```typescript
const CommandEnvelopeSchema = z.object({
  commandId: z.string().uuid(),
  commandType: z.enum(['START_WORKFLOW', 'CANCEL_ORDER', 'TRIGGER_KILL_SWITCH']),
  payload: z.any()
});
```
* **Output**: `z.object({ success: z.boolean(), eventId: z.string().uuid().optional() })`

---

## 3. WebSocket Subscriptions

### `subscribeMarketGraph`
* **Channel**: `/market/graph-updates`
* **Broadcast Payload**:
```json
{
  "symbol": "BTC-USDT",
  "newNodes": [],
  "updatedNodes": [],
  "removedNodes": []
}
```
"""

# ==================== 017-versioning.md ====================
files["017-versioning.md"] = """# JDS-017: System Evolution & Schema Versioning
Version: 1.0
Status: Approved

This specification defines strategies for event evolution, transactional outbox publishing, and snapshot management.

## 1. Event Schema Versioning (Upcasters)
Events are immutable and stored permanently. When payloads evolve, Janus uses **Upcasters** (schema migrators) to transform old event structures into new versions at query time, avoiding database updates.

```
[Postgres (v1 Event)] ---> [v1-to-v2 Upcaster Class] ---> [Aggregate Root (v2 Payload)]
```

```typescript
interface EventUpcaster {
  targetEventType: string;
  sourceVersion: number;
  targetVersion: number;
  upcast(rawPayload: any): any;
}

// Example Upcaster for adding sizeMultiplier to the plan
class TradeWorkflowStartedUpcaster implements EventUpcaster {
  targetEventType = 'janus.execution.workflow_started';
  sourceVersion = 1;
  targetVersion = 2;
  
  upcast(rawPayload: any): any {
    return {
      ...rawPayload,
      sizeMultiplier: rawPayload.sizeMultiplier ?? 1.0 // Default fallback value
    };
  }
}
```

## 2. Transactional Outbox Pattern
To prevent dual-write failures (e.g. event is saved to Postgres but WebSocket publish fails), Janus uses the Transactional Outbox pattern:

1. **Atomic Write**: In a single database transaction, the command handler saves the entity state changes and writes an Event record to the `outbox` table.
2. **Outbox Poller**: A background process reads unprocessed records from the `outbox` table and publishes them to the message broker (Redis stream / websocket).
3. **Mark Processed**: Once delivery is confirmed, the record is flagged as processed or deleted.

## 3. Snapshotting
To prevent slow boot times when replaying long event streams, Janus takes state snapshots every 100 events:
* When load requests are processed, the system fetches the latest snapshot and replays only the events starting after the snapshot's `sequenceNumber`.
"""

# ==================== 018-testing.md ====================
files["018-testing.md"] = """# JDS-018: Simulation-First Testing Ruleset
Version: 1.0
Status: Approved

Janus mandates a simulation-first lifecycle to protect trading capital and ensure algorithm safety. No strategy or rule can be deployed directly to live trading.

```
 [Pure Functions] ---> [Paper Simulation] ---> [Ghost Replay] ---> [Live Execution]
 (Deterministic)      (Market Feed Mock)      (Shadow Mode)        (Active Capital)
```

## 1. The Execution Tiers

### 1.1 Tier 1: Pure Function Level
* **Scope**: Mathematical indicators, feature calculation, SMC detection.
* **Rule**: Must be pure functions without external DB or API calls. Tested using static historical mock arrays.

### 1.2 Tier 2: Paper Simulation Level
* **Scope**: Confluence score scoring, FSM state transitions, order matching.
* **Rule**: Executed in a sandbox container. Trades are matched against real-time websocket prices, incorporating realistic spread, fee, and slippage assumptions.

### 1.3 Tier 3: Ghost Replay Level (Shadow Mode)
* **Scope**: Full system integration, multi-agent AI brain reviews, governor pipelines.
* **Rule**: Runs in production parallel to the active trading engine. The engine generates real orders, processes the entire pipeline, but the execution adapter mocks the trade fills. This verifies latency and system stability.

### 1.4 Tier 4: Live Execution
* **Scope**: Capital routing.
* **Rule**: Must complete 72 hours of shadow mode execution with zero exceptions before promotion. Capital size is initially restricted to the 1% pilot limit.
"""

# Now write them out
for filename, content in files.items():
    filepath = os.path.join(SPEC_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content.strip() + "\n")
    print(f"Created: {filepath}")

print("All 19 files processed successfully!")
