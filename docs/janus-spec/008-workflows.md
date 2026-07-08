# JDS-008: TradeWorkflow Execution Specifications
Version: 1.0
Status: Approved

The `TradeWorkflow` coordinate complex async operations across Strategy, Risk, and Execution.

## 1. Step-by-Step Execution Narrative

### 1.1 Phase 1: Gating
1. Confluence Signal loop registers composite score of 78 on `BTC-USDT-PERP`.
2. Emits `SignalGatedEvent` containing indicator snapshots.
3. Execution Context initializes `TradeWorkflow` in `Draft` state.

### 1.2 Phase 2: AI Brain Vetting
1. `BrainOrchestrator` captures `SignalGatedEvent`.
2. Generates a semantic text narrative of `BTC-USDT-PERP` and pulls 3 historical episodes from Qdrant.
3. Multi-agent review (Market Analyst + Risk Officer) evaluates setup.
4. Emits `BrainPlanProposed` with a vetted plan and confidence rating.

### 1.3 Phase 3: Policy Execution
1. Deterministic Governor catches `BrainPlanProposed`.
2. Passes proposal through the chain of responsibility (Risk, News, Session limits).
3. If valid, emits `RiskAuthorizationGranted`, changing workflow state to `Gated`.

### 1.4 Phase 4: Order Dispatch & Protection
1. Execution Engine creates a Limit order and dispatches it to the exchange REST endpoint. Transitions workflow to `EntrySubmitted`.
2. Upon fill confirmation, updates state to `Protected` and submits stop-loss and take-profit limit orders on the exchange.

### 1.5 Phase 5: Trailing & Termination
1. TrailingStopEngine monitors ticks. If price moves past 1.0 R-Multiple, transitions to `Trailing` and adjusts SL.
2. If SL/TP is hit, transitions to `Exiting`, submits market close order, and clears orders.
3. On size 0, transitions to `Closed`, triggering post-trade reflection.

---

## 2. Error Reconciliation Loops
- **Partial Fill Timeout**: If entry is partially filled after 60s, cancel the remaining quantity. If size > min_size, recalculate SL/TP and proceed to `Protected`; else, close position.
- **Slippage Breach**: If exit slippage exceeds 1.5%, alert the operator via Telegram and execution continues with a market order safety net.
- **WebSocket Disconnection**: The reconciler polls the REST API every 5 minutes to synchronize missing execution fills.
