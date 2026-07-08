# JDS-001: Ubiquitous Language & Domain Glossary
Version: 1.0
Status: Approved

This document forms the official ubiquitous language dictionary of the Janus platform. Terms are grouped by domain context and are mapped to their specific technical representations.

## 1. Market & Ontology Glossary

| Term | Bounded Context | Description | Technical Representation |
| :--- | :--- | :--- | :--- |
| **Symbol** | Market | Unique identifier for an asset futures contract (e.g. `BTC-USDT-PERP`). | `string` (Value Object) |
| **Timeframe** | Market | Aggregation window duration for candle processing (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`). | `Enum` (Value Object) |
| **Tick** | Market | The atomic transaction update (price, volume, side) received from the exchange WebSocket. | `interface Tick` |
| **OrderBook** | Market | Real-time L2 order depth containing bids and asks. | `class OrderBook` |
| **Spread** | Market | The delta between the highest bid and the lowest ask price. | `number` (calculated) |
| **Depth** | Market | The cumulative volume of pending orders at specific price levels. | `array` of price-qty levels |
| **CVD** | Market | Cumulative Volume Delta: the rolling sum of buy volume minus sell volume of market trades. | `number` (rolling sum) |
| **Volume Profile** | Market | Distribution of traded volume across price levels over a specified session. | `class VolumeProfile` |
| **POC** | Market | Point of Control: The price level containing the highest volume in a volume profile. | `number` |
| **Value Area (VA)** | Market | The price range where 70% of volume occurred in a volume profile. | `range` (low, high prices) |
| **HVN** | Market | High Volume Node: A peak price level indicating high institutional activity. | `number` |
| **LVN** | Market | Low Volume Node: A valley price level indicating rapid price rejection. | `number` |
| **MarketObject** | Market | Base polymorphic entity representing a structural pattern in price/volume action. | `abstract class MarketObject` |
| **FairValueGap (FVG)**| Market | A 3-candle imbalance zone where the 1st candle's extreme does not overlap the 3rd. | `class FairValueGap` |
| **OrderBlock (OB)** | Market | A candle sequence showing institutional accumulation/distribution before a major trend. | `class OrderBlock` |
| **Liquidity Pool** | Market | Price zone where a cluster of pending stop-loss and limit orders are situated. | `class LiquidityPool` |
| **Swing High** | Market | A local price peak surrounded by lower peaks. | `class Swing` |
| **Swing Low** | Market | A local price trough surrounded by higher troughs. | `class Swing` |
| **MSS** | Market | Market Structure Shift: The breach of a key swing level indicating early trend changes. | `class MarketStructureShift` |
| **CHoCH** | Market | Change of Character: The initial violation of structure indicating a potential regime reversal. | `class ChangeOfCharacter` |
| **Breaker Block** | Market | A mitigated OrderBlock that was broken by price and now acts as support/resistance in reverse. | `class BreakerBlock` |
| **Mitigation Block** | Market | Similar to a breaker block, but formed from a failed swing high/low that did not sweep liquidity. | `class MitigationBlock` |
| **Relationship** | Market | Directed edge in the market graph connecting two `MarketObjects`. | `class Relationship` (Edge) |
| **Runtime Graph** | Market | Low-latency, in-memory graph containing active structural objects (<30s). | `class RuntimeGraph` |
| **Session Graph** | Market | Redis-stored graph representing structures detected within the last 24 hours. | `class SessionGraph` |
| **Historical Graph** | Market | PostgreSQL relational graph storage mapping long-term structures. | `class HistoricalGraph` |
| **SpatialObject** | Market | Capability trait indicating an object has defined boundaries in price space. | `interface SpatialObject` |
| **TemporalObject** | Market | Capability trait indicating an object has a defined lifespans and decay bounds in time. | `interface TemporalObject` |
| **Mitigatable** | Market | Capability trait allowing an object to be partially/fully filled by price. | `interface Mitigatable` |
| **Invalidatable** | Market | Capability trait allowing an object to be neutralized when price crosses a limit. | `interface Invalidatable` |
| **Structural** | Market | Capability trait identifying an object as a core pivot in trend determination. | `interface Structural` |
| **Tradable** | Market | Capability trait that calculates optimal stop loss and entry prices from the object. | `interface Tradable` |
| **VolumeWeighted** | Market | Capability trait tracking volume characteristics inside the object's price range. | `interface VolumeWeighted` |
| **Level 0 (Lexicon)** | Market | Raw market feeds (ticks, trades, order book lines). | Data Stream |
| **Level 1 (Syntax)** | Market | Aggregated candles (OHLCV metrics). | Data Stream |
| **Level 2 (Semantics)**| Market | Detected MarketObjects (OBs, FVGs). | Graph Nodes |
| **Level 3 (Phrases)** | Market | Multiple overlapping MarketObjects (e.g. FVG in OB). | Nested Subgraphs |
| **Level 4 (Sentences)**| Market | Directed graph connecting levels across timeframes. | Graph Projection |
| **Level 5 (Stories)**  | Market | Human-readable and semantic hourly summaries of the market state. | Text Narrative |

## 2. Strategy & Execution Glossary

| Term | Bounded Context | Description | Technical Representation |
| :--- | :--- | :--- | :--- |
| **Strategy** | Strategy | Long-lived configuration defining target indicators and rules. | `class Strategy` (Aggregate) |
| **Confluence** | Strategy | Mathematical scoring combining micro, intra, and swing signals. | `class ConfluenceEngine` |
| **Micro Feature** | Strategy | Very short-term feature (<1m) such as order book imbalances. | `number` |
| **Intra Feature** | Strategy | Medium-term feature (1m-15m) such as RSI and ATR bands. | `number` |
| **Swing Feature** | Strategy | Long-term feature (1h+) such as swing highs and breaker zones. | `number` |
| **Signal** | Strategy | Gated event generated when the composite score is >= 75. | `class Signal` (Entity) |
| **TradeWorkflow** | Execution | State machine governing a single trade setup from start to close. | `class TradeWorkflow` |
| **ExecutionPlan** | Execution | Target size, limit price, stop-loss, and take-profit bounds. | `interface ExecutionPlan` |
| **Position** | Execution | Active financial liability on the exchange. | `class Position` (Entity) |
| **Order** | Execution | Request submitted to the exchange matching engine. | `class Order` (Entity) |
| **Trade** | Execution | Single fill transaction detailing filled price, quantity, and fee. | `interface Trade` |
| **Trailing Stop** | Execution | A stop-loss order that adjusts in favor of the trade direction. | `class TrailingStopEngine` |
| **Reconciler** | Execution | Background job verifying that local state matches the exchange database. | `class PositionReconciler` |
| **Outbox** | Infrastructure | Relational log table storing events to be published to brokers. | `class OutboxEvent` |
| **Upcaster** | Infrastructure | Class responsible for converting historical event JSON payloads to new schemas. | `interface EventUpcaster` |
| **Replay** | Infrastructure | Process of streaming historical events to rebuild projections. | `class ReplayEngine` |
| **Snapshot** | Infrastructure | Serialized state of an aggregate stored at specific sequence numbers. | `interface Snapshot` |

## 3. Risk & Portfolio Glossary

| Term | Bounded Context | Description | Technical Representation |
| :--- | :--- | :--- | :--- |
| **Kill Switch** | Risk | Hard override that cancels all active orders and closes all positions. | `class KillSwitchState` |
| **Drawdown** | Risk | Drop in account equity measured from peak balance. | `number` (percentage) |
| **Risk Profile** | Risk | Configured risk parameters per user account. | `class RiskProfile` (Aggregate) |
| **Correlation** | Risk | Measure of price direction synchronization between open positions. | `number` (covariance ratio) |
| **Margin** | Portfolio | Collateral allocated to back active positions. | `number` |
| **Maintenance Margin**| Portfolio | Minimum balance required to keep a position open without liquidation. | `number` |
| **Isolated Margin** | Portfolio | Margin assigned strictly to a single position. | Value |
| **Cross Margin** | Portfolio | Margin shared across all active positions in the account. | Value |
| **Funding Rate** | Portfolio | Periodic payment made between long and short contract holders. | `number` |
| **Account Balance** | Portfolio | Total equity plus/minus realized trading outcomes. | `class Balance` |

## 4. AI & Semantic Layer Glossary

| Term | Bounded Context | Description | Technical Representation |
| :--- | :--- | :--- | :--- |
| **Episode** | Brain | Log containing pre-trade narrative context, AI decisions, and outcomes. | `class Episode` (Aggregate) |
| **Reflection** | Brain | Narrative post-mortem generated by the LLM Trade Reflector. | `interface Reflection` |
| **Memory** | Brain | Vectorized representation of past episodes stored in Qdrant. | `interface MemoryNode` |
| **Narrative** | Brain | Structured text summary describing current market regimes. | `class MarketNarrative` |
| **Semantic Layer** | Brain | Orchestrator converting raw events into narratives and memories. | `class SemanticOrchestrator` |
| **EpisodeBuilder** | Brain | Component compiling workflow execution data into episodes. | `class EpisodeBuilder` |
| **NarrativeBuilder** | Brain | Component summarizing graph and feature metrics into text. | `class NarrativeBuilder` |
| **SemanticEncoder** | Brain | Transformer wrapper embedding text strings into vector arrays. | `class SemanticEncoder` |
| **Qdrant** | Brain | External database optimized for high-dimensional vector search. | Vector DB |\n