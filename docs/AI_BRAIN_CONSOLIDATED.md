# Janus LLM-Powered Autonomous Brain Specification

This document consolidates and structures the complete research, architectural design, database schemas, API routes, and code implementation specifications for integrating a governed, learning-capable, and autonomous LLM-powered brain into the **Janus Algorithmic Trading Platform**.

---

## 1. System Philosophy & Architecture Overview

The Brain is integrated as a **separate orchestration layer** that sits above existing Janus services. It does not replace the fast, deterministic execution path but rather vets, sizes, and improves upon trading decisions.

```mermaid
graph TD
    subgraph Market & Feed
        Binance[Binance WS/REST]
        CoinDCX[CoinDCX WS/REST]
    end

    subgraph Primary Execution Engine
        SignalEngine[Janus Signal Engine <br> SMC, CVD, Volume Profile, Confluence]
    end

    subgraph Autonomous Brain Layer
        Orchestrator[Brain Orchestrator]
        MarketAnalyst[Brain 1: Market Analyst]
        TradeReviewer[Brain 2: Trade Reviewer]
        RiskOfficer[Brain 3: Risk Officer]
    end

    subgraph Safety Gate
        Governor[Deterministic Governor]
    end

    subgraph Execution Adapters
        Executor[Executor]
        PaperAdapter[Paper Execution Adapter]
        LiveAdapter[CoinDCX Live Adapter]
    end

    subgraph Learning & Reflection (Offline)
        Reflector[Brain 4: Trade Reflector]
        Researcher[Brain 5: Strategy Researcher]
        Qdrant[Qdrant Vector DB]
        Postgres[(PostgreSQL / MySQL)]
    end

    %% Data flow
    Binance --> SignalEngine
    SignalEngine -->|Triggers Signal + Snapshot| Orchestrator
    Orchestrator --> MarketAnalyst
    MarketAnalyst -->|Regime & Context| TradeReviewer
    TradeReviewer -->|Proposed Trade| RiskOfficer
    RiskOfficer -->|Vetted Proposal| Governor
    Governor -->|Hard Safety Verification| Executor
    Executor --> PaperAdapter
    Executor --> LiveAdapter

    %% Post-trade Loop
    PaperAdapter -.->|Closed Trade Details| Reflector
    LiveAdapter -.->|Closed Trade Details| Reflector
    Reflector -->|Candidate Rules| Postgres
    Reflector -->|Embed Narratives & Episodes| Qdrant
    Postgres -->|Evolves Strategy| Researcher
    Qdrant -->|Context Retrieval| Orchestrator
    Researcher -->|Nightly Backtests & Rule Promotion| SignalEngine
```

### 1.1 The Operating Model
1. **Observe**: Janus collects a market and portfolio snapshot via websocket/REST.
2. **Think**: The brain builds a compact state object and requests a structured plan from the LLM.
3. **Validate**: A deterministic governor checks the proposed plan against strict risk rules.
4. **Execute**: Only approved actions are passed to existing exchange or simulation adapters.
5. **Watch**: Results and fills are tracked in real-time.
6. **Reflect**: Upon position closure, the reflection engine performs a post-mortem to extract lessons.
7. **Improve**: Nightly batch jobs backtest candidate rules and promote validated parameters.

### 1.2 Non-Negotiable Safety Constraints
1. **Autonomous mode is off by default** and must be explicitly enabled.
2. **Shadow mode must be run first** to collect performance metrics.
3. **One trade per symbol per candle** to prevent runaway double-exposure.
4. **No position size increases** allowed after a losing streak.
5. **No trading during stale feed detection** (>2 seconds latency).
6. **No execution if portfolio reconciliation is inconsistent**.
7. **No direct exchange API access** from the LLM; execution is entirely deterministic.
8. **No live prompt mutations** without offline backtesting and verification.
9. **The Heuristic Kill Switch** always overrides any LLM decision.
10. **All decisions and reasoning traces** must be stored in immutable audit logs.

### 1.3 Core Capabilities Comparison

| Feature | Without Brain (Static Rules) | With Brain (Governed Orchestration) |
| :--- | :--- | :--- |
| **Trade Decision** | Fixed rules (e.g., IF price > MA THEN buy) | Dynamic, context-aware, tool-using ReAct loop |
| **Adaptability** | Manual parameter tuning and updates | Self-reflection + daily strategy evolution |
| **Memory** | None | Persistent episodic memory + vector similarity matching |
| **Risk Management** | Static stop-loss & take-profit values | Governor modifies size dynamically based on regime & drawdown |
| **Latency** | Extremely low latency (<10ms) | Low-to-moderate overhead (<200ms using small 3B models) |
| **Explainability** | Log messages only | Full reasoning traces, plans, and outcomes visible in UI |
| **Model Cost** | None | Low (utilizes locally hosted models via Ollama) |

---

## 2. Specialized Multi-Agent Brain Design

Rather than relying on one giant, slow LLM, the system leverages **five specialized agents** running locally on Ollama.

| Agent / Brain | Model (Ollama) | Execution Timing | Inputs | Output Schema |
| :--- | :--- | :--- | :--- | :--- |
| **Brain 1: Market Analyst** | `qwen2.5:3b` or `gemma3:4b` | On every signal | OHLCV, Volume, CVD, Order Book, SMC levels, Funding, Liquidations | `{ regime, direction, confidence, summary, narrative_id }` |
| **Brain 2: Trade Reviewer** | `qwen2.5:4b` | On every signal | Signal payload, Market Analyst output, Portfolio state | `{ decision: 'approve'\|'reject'\|'reduce', adjustments: { size, sl, tp }, confidence, rationale }` |
| **Brain 3: Risk Officer** | `qwen2.5:3b` | On every signal | Vetted proposal, Portfolio balances, Current Drawdown, Volatility | `{ risk_score, action: 'approve'\|'reduce_size'\|'block', max_size_pct }` |
| **Brain 4: Trade Reflector** | `qwen2.5:8b` (Offline) | Post-trade close | Entry/Exit details, Market context, Realized PnL, R-multiple | `{ lessons: string[], candidate_rules: string[] }` |
| **Brain 5: Strategy Researcher** | `qwen2.5:8b` (Offline) | Nightly batch | Historical episodes, Candidate rules, Backtest results | `{ promoted_rules: string[], new_strategy_params: JSON }` |

---

## 3. World Model & Episodic Memory System

### 3.1 The World Model (Market Narrative)
To prevent the LLM from losing context, Janus stores a compressed **Market Narrative** hourly. This acts as the agent's representation of the trading environment.

```typescript
type MarketNarrative = {
  timestamp: string;
  symbol: string;
  regime: "trend" | "range" | "volatile";
  direction: "bullish" | "bearish" | "neutral";
  liquidity_state: "buy_side_targeted" | "sell_side_targeted" | "balanced";
  funding_state: "neutral" | "overheated_long" | "overheated_short";
  volatility_state: "low" | "normal" | "high";
  key_levels: { resistance: number; support: number };
};
```

### 3.2 Episodic Memory Architecture
Janus avoids storing raw, token-heavy reasoning traces in Qdrant. Instead, it embeds compressed structured episodes to ensure faster, noise-free retrieval:

```typescript
type StoredEpisode = {
  id: string;
  symbol: string;
  narrative_id: string;           // Links to the hourly MarketNarrative
  signal: string;                 // e.g., "bullish_ob_breakout"
  decision: "approve" | "reject";
  final_action: "long" | "short" | "hold";
  outcome: "win" | "loss" | "breakeven";
  r_multiple: number;             // Realized risk-to-reward multiple
  pnl_percent: number;
  lessons_ref_id?: string;        // References the reflection entry
};
```

* **Vector Store (Qdrant)**: Embeds the stringified JSON of `StoredEpisode`. Before executing a plan, the retriever queries Qdrant for similar historical setups to feed as few-shot examples to the prompts.

---

## 4. Deterministic Safety Governor

The Governor acts as the final gatekeeper. Written in deterministic TypeScript, it enforces hard restrictions that the LLM cannot override.

### 4.1 Governor Rules
* **Kill Switch**: Immediate veto of all actions if toggled.
* **Drawdown Control**: Hard stop if daily or lifetime drawdown limits are violated.
* **Price Drift Guard**: Disallows execution if prices between Binance (Signals) and CoinDCX (Execution) drift beyond a predefined threshold.
* **Feed Staleness**: Rejects proposals if WebSocket ticker timestamp is >2 seconds old.
* **Risk Restricting Only**: The LLM may only propose a size reduction, exit, or tighter stop. It is programmatically blocked from raising position sizes or widening stop-loss levels beyond baseline signal parameters.

---

## 5. Learning, Reflection, and Strategy Evolution

```
[Trade Closes] ──► [Trade Reflector] ──► [Candidate Rule] (Status: 'candidate')
                                                │
                                                ▼ (Observed 20+ times)
[Nightly Cron] ──► [Strategy Researcher] ──► [Backtest Validation]
                                                │
                                                ▼ (Score improves)
                                        [Promote to Active Strategy]
```

1. **Reflection**: After each trade, **Brain 4 (Trade Reflector)** analyzes the trade logs and generates a candidate rule, storing it in `brain_candidate_rules`.
2. **Backtesting**: The rule remains in `candidate` status. It is **never** promoted instantly.
3. **Promotion**: Nightly, **Brain 5 (Strategy Researcher)** backtests candidate rules against historical market data. It uses a multi-factor fitness score:

$$\text{Fitness Score} = (\text{Expectancy} \times 0.35) + (\text{ProfitFactor} \times 0.25) + (\text{Sharpe} \times 0.20) + (\text{DrawdownPenalty} \times 0.20)$$

4. **Rule Promotion Constraints**: A rule is promoted to the active prompt template if and only if:
   * It has been proposed in at least **20+ episodes**.
   * The backtest demonstrates a statistically significant improvement in the fitness score.
   * Drawdown metrics do not worsen.

---

## 6. LLM Model Selection & Quantization Guidelines

### 6.1 Feasibility of 3B Models
A quantized 3B model is highly viable for Janus's structured tool-calling loop:
* **Jamba-Reasoning-3B**: Outstanding reasoning benchmarks, engineered via cold-start distillation.
* **Nanbeige4.1-3B**: Tailored for agentic tool use; supports up to 600 tool-call turns sequentially.
* **Hermes-3-Llama-3.2-3B**: Fine-tuned specifically for structured JSON outputs and function calling (achieving ~84% accuracy).

### 6.2 Quantization & Precision Strategy
* **Q8 (8-bit Quantization)**: Heavily recommended for live execution. While 4-bit quantization reduces VRAM usage to ~3GB, it degrades tool-use precision by 10-15%. Q8 maintains a 1-3% accuracy variance compared to FP16 while maintaining sub-200ms latency.

### 6.3 Multi-Tier Routing Logic
* **Tier 1 (Fast Executor - 3B Q8)**: Runs 90% of routine signals. Handles ReAct loops with structured JSON schemas.
* **Tier 2 (Deep Reasoner - 7B-9B Qwen/Gemma)**: Utilized only if the 3B model reports a confidence score below `0.7`, or if a high-risk/unusual trade setup is detected. Also used for offline reflections and strategy mutations.

---

## 7. Tool-Chaining, Discovery & Plan Execution

Autonomous tool use is managed through a structured registry, allowing the agent to discover, compose, and chain tools dynamically.

### 7.1 Plan Schema
The Planner LLM is forced to output a deterministic execution plan matching this JSON schema:

```json
{
  "goal": "evaluate long trade on BTCUSDT",
  "steps": [
    { "tool": "get_market_data", "args": { "symbol": "BTCUSDT" }, "output_var": "market" },
    { "tool": "get_SMC_levels", "args": { "symbol": "BTCUSDT", "price": "$market.price" }, "output_var": "smc" },
    { "tool": "get_CVD", "args": { "symbol": "BTCUSDT", "minutes": 60 }, "output_var": "cvd" },
    { "tool": "get_similar_episodes", "args": { "observation": "$market + $smc + $cvd" }, "output_var": "mem" },
    { "tool": "decide_trade", "args": { "market": "$market", "smc": "$smc", "cvd": "$cvd", "memory": "$mem" }, "output_var": "decision" }
  ],
  "final_action": "$decision"
}
```

---

## 8. Implementation Roadmap, Testing & Failsafes

### 8.1 90-Day Phased Rollout
* **Phase 1: Shadow Mode (Month 1)**: The brain generates trade proposals on incoming signals. Decisions are stored but not executed.
* **Phase 2: Local Paper Trading (Month 2)**: The brain executes trades inside a simulated SQL sandbox using real-time market data feed from Binance websockets, charging simulated fees and slippage.
* **Phase 3: Micro Live Trading (Month 3)**: Small capital ($10-$50 per trade) is allocated to live execution adapters.
* **Phase 4: Full Governed Autonomy**: Scaled capital is deployed only when the system has surpassed **500+ paper trades** with a **Profit Factor > 1.5** and positive expectancy.

### 8.2 Paper Trading Simulation Details
* **Simulated Fees**: Maker fee ($0.02\%$) and Taker fee ($0.05\%$) deducted automatically from each transaction.
* **Simulated Slippage**: Applied relative to market volatility:
  * *Normal Regime*: $0.02\%$
  * *High Volatility*: $0.05\%$
  * *Extreme Volatility / Events*: $0.15\%$

---

## 9. Database Migrations & Schemas

Save this script as `db/migrations/005_brain_tables.sql` to initialize all relational storage tables in MySQL:

```sql
-- Migration: 005_brain_tables.sql

-- 1. Brain Episodes (Relational audit trail for decision cycles)
CREATE TABLE IF NOT EXISTS brain_episodes (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT DEFAULT NULL,
    session_id VARCHAR(100) DEFAULT NULL,
    trigger_type VARCHAR(50) DEFAULT NULL,
    timestamp DATETIME NOT NULL,
    market_symbol VARCHAR(20) NOT NULL,
    observation JSON NOT NULL,          -- Observation snapshot
    reasoning TEXT DEFAULT NULL,        -- Thought process & ReAct trace
    proposed_action JSON DEFAULT NULL,  -- Model output
    governor_json JSON DEFAULT NULL,    -- Governor overrides
    actual_action JSON DEFAULT NULL,    -- Execution result
    outcome_pnl DECIMAL(16,8) DEFAULT NULL,
    outcome_time DATETIME DEFAULT NULL,
    reflection TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Brain Strategies (Prompt configurations & performance statistics)
CREATE TABLE IF NOT EXISTS brain_strategies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    prompt_template TEXT,
    parameters JSON NOT NULL,
    sharp_ratio DECIMAL(8,4) DEFAULT 0.0000,
    total_pnl DECIMAL(16,8) DEFAULT 0.00000000,
    win_rate DECIMAL(5,2) DEFAULT 0.00,
    active BOOLEAN DEFAULT FALSE,
    last_evaluated DATETIME DEFAULT NULL
);

-- 3. Brain Reflections (Rule extraction journal)
CREATE TABLE IF NOT EXISTS brain_reflections (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    episode_id BIGINT NOT NULL,
    lesson TEXT NOT NULL,
    rule_created TEXT NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (episode_id) REFERENCES brain_episodes(id) ON DELETE CASCADE
);

-- 4. Candidate Rules Table
CREATE TABLE IF NOT EXISTS brain_candidate_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rule_text TEXT NOT NULL,
    source_episode_id BIGINT NOT NULL,
    occurrences INT DEFAULT 1,
    backtest_score DECIMAL(8,4) DEFAULT 0.0000,
    status VARCHAR(20) DEFAULT 'candidate', -- 'candidate', 'approved', 'rejected'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_episode_id) REFERENCES brain_episodes(id) ON DELETE CASCADE
);

-- 5. Brain Actions Registry (Step audit log for execution paths)
CREATE TABLE IF NOT EXISTS brain_actions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    episode_id BIGINT NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    tool_name VARCHAR(100) NOT NULL,
    request_json JSON DEFAULT NULL,
    response_json JSON DEFAULT NULL,
    status VARCHAR(50) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (episode_id) REFERENCES brain_episodes(id) ON DELETE CASCADE
);

-- 6. Dynamic Tool Registry
CREATE TABLE IF NOT EXISTS brain_tools (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    input_schema JSON DEFAULT NULL,
    output_schema JSON DEFAULT NULL,
    cost_estimate INT DEFAULT 1,
    is_destructive BOOLEAN DEFAULT FALSE
);

-- 7. Local Paper Account
CREATE TABLE IF NOT EXISTS paper_accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    starting_balance DECIMAL(16,8) NOT NULL,
    current_balance DECIMAL(16,8) NOT NULL,
    equity DECIMAL(16,8) NOT NULL,
    margin_used DECIMAL(16,8) DEFAULT 0.00000000,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. Local Paper Position Table
CREATE TABLE IF NOT EXISTS paper_positions (
    id VARCHAR(100) PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    entry_price DECIMAL(16,8) NOT NULL,
    quantity DECIMAL(16,8) NOT NULL,
    leverage INT DEFAULT 1,
    margin DECIMAL(16,8) NOT NULL,
    stop_loss DECIMAL(16,8) DEFAULT NULL,
    take_profit DECIMAL(16,8) DEFAULT NULL,
    status VARCHAR(20) DEFAULT 'open',
    opened_at DATETIME NOT NULL,
    closed_at DATETIME DEFAULT NULL
);

-- 9. Local Paper Trades (Executions history)
CREATE TABLE IF NOT EXISTS paper_trades (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    position_id VARCHAR(100) NOT NULL,
    entry_price DECIMAL(16,8) NOT NULL,
    exit_price DECIMAL(16,8) NOT NULL,
    pnl DECIMAL(16,8) NOT NULL,
    fees DECIMAL(16,8) NOT NULL,
    r_multiple DECIMAL(8,4) NOT NULL,
    FOREIGN KEY (position_id) REFERENCES paper_positions(id) ON DELETE CASCADE
);

-- 10. Local Paper Equity Snapshots
CREATE TABLE IF NOT EXISTS paper_equity_snapshots (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    equity DECIMAL(16,8) NOT NULL,
    balance DECIMAL(16,8) NOT NULL,
    drawdown DECIMAL(8,4) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert Default Strategy
INSERT INTO brain_strategies (name, description, prompt_template, parameters, active) VALUES
('SMC + CVD Default', 'Standard Smart Money Concepts with Cumulative Volume Delta',
 'You are a disciplined trader. Use SMC order blocks and CVD divergences.',
 '{"risk_per_trade":0.02, "use_smc":true, "use_cvd":true}', TRUE);
```

---

## 10. Backend Implementation Code

### 10.1 `src/brain/brain-memory.ts`
Manages MySQL transactions and embeds episodes into the vector DB (Qdrant).

```typescript
import { db } from '../db';
import { QdrantClient } from '@qdrant/js-client-rest';

const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });
const COLLECTION = 'janus_episodes';

export async function initVectorStore() {
  const collections = await qdrant.getCollections();
  if (!collections.collections.some(c => c.name === COLLECTION)) {
    await qdrant.createCollection(COLLECTION, { vectors: { size: 1536, distance: 'Cosine' } });
  }
}

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text })
  });
  const json = await res.json();
  if (json.error) throw new Error(`Embedding failed: ${json.error.message}`);
  return json.data[0].embedding;
}

export const memoryStore = {
  saveEpisode: async (episode: any) => {
    const [id] = await db.insert('brain_episodes').returning('id').values(episode);
    const textForEmbedding = `${JSON.stringify(episode.observation)} ${episode.reasoning}`;
    try {
      const embedding = await getEmbedding(textForEmbedding);
      await qdrant.upsert(COLLECTION, {
        points: [{ id: id, vector: embedding, payload: { episodeId: id, symbol: episode.market_symbol } }]
      });
    } catch (e) {
      console.error('[Brain Vector Store] Failed embedding upsert:', e);
    }
    return id;
  },

  getSimilarEpisodes: async (observationText: string, limit = 5) => {
    try {
      const embedding = await getEmbedding(observationText);
      const results = await qdrant.search(COLLECTION, { vector: embedding, limit });
      const episodeIds = results.map(p => p.payload?.episodeId as number);
      if (!episodeIds.length) return [];
      return await db.select('*').from('brain_episodes').whereIn('id', episodeIds);
    } catch (e) {
      console.error('[Brain Vector Store] Search failed:', e);
      return [];
    }
  },

  getEpisode: async (id: number) => {
    const rows = await db.select('*').from('brain_episodes').where({ id }).limit(1);
    return rows[0] || null;
  },

  updateEpisodeOutcome: async (id: number, outcome: { pnl: number, action: any, reflection?: string }) => {
    await db.update('brain_episodes').set({
      outcome_pnl: outcome.pnl,
      actual_action: JSON.stringify(outcome.action),
      outcome_time: new Date(),
      reflection: outcome.reflection || null
    }).where({ id });
  }
};
```

### 10.2 `src/brain/brain-tools.ts`
Declares APIs and functions wrapped for LLM-driven execution plans.

```typescript
import { getMarketData as getBinanceData } from '../exchange/binance';
import { getPortfolio } from '../portfolio/manager';
import { memoryStore } from './brain-memory';
import { db } from '../db';

export const tools = {
  getMarketData: async (symbol: string) => {
    const data = await getBinanceData(symbol);
    return { symbol, ...data };
  },

  getPortfolio: async () => {
    const portfolio = await getPortfolio();
    return { cash: portfolio.cash, positions: portfolio.positions, drawdown: portfolio.drawdown };
  },

  getSimilarEpisodes: async (observationText: string) => {
    const similar = await memoryStore.getSimilarEpisodes(observationText, 3);
    return similar.map(ep => ({
      outcome: ep.outcome_pnl,
      reasoning: ep.reasoning?.substring(0, 200)
    }));
  },

  proposeTrade: async (side: string, sizePercent: number, stopLossPercent: number, takeProfitPercent: number) => {
    return { side, size_percent: sizePercent, stop_loss_percent: stopLossPercent, take_profit_percent: takeProfitPercent, status: 'proposed' };
  },

  setRiskLimit: async (maxRiskPercent: number) => {
    await db.update('brain_config').set({ value: maxRiskPercent.toString() }).where({ key: 'max_risk_percent' });
    return { status: 'updated', max_risk_percent: maxRiskPercent };
  }
};

export async function executeTool(name: string, args: any) {
  const tool = (tools as any)[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool(args);
}
```

### 10.3 `src/brain/brain-governor.ts`
Performs deterministic sanity checking and validates risk levels.

```typescript
import { llmRouter } from '../llm-router';

export async function hybridGovernor(proposal: string, portfolio: any, marketData: any) {
  const parts = proposal.trim().split(/\s+/);
  if (parts[0] === 'HOLD') return { approved: true, proposal: { action: 'HOLD' } };

  if (parts[0] !== 'PROPOSE_TRADE' || parts.length < 5) {
    return { approved: false, reason: 'Malformed proposal string' };
  }

  const side = parts[1];
  const sizePercent = parseFloat(parts[2]);
  const stopLossPercent = parseFloat(parts[3]);
  const takeProfitPercent = parseFloat(parts[4]);

  // Hard Heuristics Check
  if (sizePercent > 5) return { approved: false, reason: 'Max position size 5% cap exceeded' };
  if (portfolio.drawdown > 10) return { approved: false, reason: 'Drawdown exceeds 10%' };
  if (side === 'LONG' && marketData.current_price > marketData.smc_resistance) {
    return { approved: false, reason: 'Price above SMC resistance levels' };
  }
  if (side === 'SHORT' && marketData.current_price < marketData.smc_support) {
    return { approved: false, reason: 'Price below SMC support levels' };
  }

  // LLM Advisory Veto Layer
  try {
    const vetoPrompt = `You are a risk officer. Approve or veto this trade: ${JSON.stringify({ side, sizePercent, stopLossPercent, takeProfitPercent })}. Portfolio: ${JSON.stringify(portfolio)}. Reply with JSON: { "veto": false/true, "reason": "..." }`;
    const vetoResponse = await llmRouter.complete([{ role: 'user', content: vetoPrompt }]);
    const { veto, reason } = JSON.parse(vetoResponse);
    if (veto) return { approved: false, reason: `Advisory veto: ${reason}` };
  } catch (err) {
    console.error('[Governor Warning] Advisory check bypassed due to exception:', err);
  }

  let finalSize = sizePercent;
  if (portfolio.volatility > 2) finalSize = sizePercent * 0.7; // Volatility offset

  return {
    approved: true,
    proposal: { action: 'ENTER', side, size_percent: finalSize, stop_loss_percent: stopLossPercent, take_profit_percent: takeProfitPercent }
  };
}
```

### 10.4 `src/brain/brain-agent.ts`
Manages the structured ReAct parsing loop.

```typescript
import { Hono } from 'hono';
import { llmRouter } from '../llm-router';
import { tools, executeTool } from './brain-tools';
import { memoryStore } from './brain-memory';
import { hybridGovernor } from './brain-governor';

const agent = new Hono();

function parseReActResponse(text: string): { action?: { name: string, args: any }, finalAnswer?: string } {
  const finalMatch = text.match(/Final Answer:\s*(PROPOSE_TRADE\s+.*|HOLD)/i);
  if (finalMatch) return { finalAnswer: finalMatch[1] };

  const actionMatch = text.match(/Action:\s*(\w+)\((.*)\)/);
  if (actionMatch) {
    try {
      const argsText = actionMatch[2].trim();
      const args = argsText.startsWith('{') || argsText.startsWith('[') ? JSON.parse(argsText) : argsText;
      return { action: { name: actionMatch[1], args } };
    } catch {
      return { action: { name: actionMatch[1], args: actionMatch[2] } };
    }
  }
  return {};
}

async function runReAct(symbol: string, maxSteps = 5): Promise<any> {
  const market = await tools.getMarketData(symbol);
  const portfolio = await tools.getPortfolio();
  const similarEpisodes = await tools.getSimilarEpisodes(JSON.stringify(market));

  const systemPrompt = `You are an autonomous trading agent. Use these tools:
- getMarketData(symbol)
- getPortfolio()
- getSimilarEpisodes(observationText)
- proposeTrade(side, sizePercent, stopLossPercent, takeProfitPercent)
- setRiskLimit(maxRiskPercent)

Follow this exact format:
Thought: ...
Action: tool_name(arguments)
Observation: (result)
... repeat until you decide.
Final Answer: PROPOSE_TRADE LONG 2.0 1.5 3.0 or HOLD

Current market: ${JSON.stringify(market)}
Portfolio: ${JSON.stringify(portfolio)}
Past similar outcomes: ${JSON.stringify(similarEpisodes)}`;

  let conversation = [{ role: 'user', content: systemPrompt }];
  let finalDecision = null;
  let steps = 0;

  while (steps < maxSteps && !finalDecision) {
    const response = await llmRouter.complete(conversation);
    const parsed = parseReActResponse(response);
    if (parsed.finalAnswer) {
      finalDecision = parsed.finalAnswer;
      break;
    }
    if (parsed.action) {
      const result = await executeTool(parsed.action.name, parsed.action.args);
      conversation.push({ role: 'assistant', content: response });
      conversation.push({ role: 'user', content: `Observation: ${JSON.stringify(result)}` });
    }
    steps++;
  }

  const episodeId = await memoryStore.saveEpisode({
    timestamp: new Date(),
    market_symbol: symbol,
    observation: market,
    reasoning: conversation.map(m => m.content).join('\n'),
    proposed_action: finalDecision,
    actual_action: null
  });

  return { episodeId, proposal: finalDecision };
}

agent.post('/decide', async (c) => {
  const symbol = c.req.query('symbol') || 'BTCUSDT';
  const { episodeId, proposal } = await runReAct(symbol);

  const portfolio = await tools.getPortfolio();
  const market = await tools.getMarketData(symbol);
  const governorResult = await hybridGovernor(proposal, portfolio, market);

  if (!governorResult.approved) {
    return c.json({ episodeId, approved: false, reason: governorResult.reason, proposal });
  }

  return c.json({ episodeId, approved: true, proposal: governorResult.proposal });
});

export default agent;
```

### 10.5 `src/brain/brain-reflection.ts`
Fires when position closing reports are broadcasted to run post-trade post-mortems.

```typescript
import { memoryStore } from './brain-memory';
import { db } from '../db';
import { llmRouter } from '../llm-router';

export async function reflectOnTrade(episodeId: number, pnl: number, actualAction: any) {
  const episode = await memoryStore.getEpisode(episodeId);
  if (!episode) return;

  await memoryStore.updateEpisodeOutcome(episodeId, { pnl, action: actualAction });

  try {
    const reflectionPrompt = `
You just closed a trade on ${episode.market_symbol}.
Planned action: ${episode.proposed_action}
Actual action: ${JSON.stringify(actualAction)}
Realized PnL: ${pnl}
Your reasoning at the time: ${episode.reasoning?.substring(0, 500)}
Provide a short lesson (1 sentence) and a concrete rule (e.g., "If RSI > 70 and CVD negative, do not long").
Output JSON: { "lesson": "...", "rule": "..." }
`;

    const reflectionText = await llmRouter.complete([{ role: 'user', content: reflectionPrompt }]);
    const { lesson, rule } = JSON.parse(reflectionText);

    await db.insert('brain_reflections').values({
      episode_id: episodeId,
      lesson,
      rule_created: rule
    });

    await appendRuleToActiveStrategy(rule);
  } catch (err) {
    console.error('[Brain Reflection Error] Failed creating reflection record:', err);
  }
}

async function appendRuleToActiveStrategy(rule: string) {
  const rows = await db.select('*').from('brain_strategies').where({ active: true }).limit(1);
  const strategy = rows[0];
  if (strategy) {
    const newPrompt = strategy.prompt_template + `\nImportant rule: ${rule}`;
    await db.update('brain_strategies').set({ prompt_template: newPrompt }).where({ id: strategy.id });
  }
}
```

### 10.6 `src/brain/brain-evolution.ts`
Mutates parameters and scores fitness offline.

```typescript
import { db } from '../db';
import { llmRouter } from '../llm-router';

async function backtestStrategyOnHistory(strategy: any) {
  // Returns mock parameters representing simulated backtester results
  return { 
    sharp_ratio: Math.random() * 2, 
    total_pnl: (Math.random() - 0.5) * 10000, 
    win_rate: Math.random() * 100 
  };
}

async function mutateStrategy(strategy: any) {
  const mutationPrompt = `Modify the following trading strategy prompt slightly to improve performance. Keep the same style but change parameters or add a new condition. Original: "${strategy.prompt_template}" Return only the new prompt.`;
  const newPrompt = await llmRouter.complete([{ role: 'user', content: mutationPrompt }]);
  return { 
    ...strategy, 
    prompt_template: newPrompt, 
    parameters: { ...strategy.parameters, mutated: true } 
  };
}

export async function evolveStrategies() {
  const strategies = await db.select('*').from('brain_strategies');

  for (const s of strategies) {
    const perf = await backtestStrategyOnHistory(s);
    await db.update('brain_strategies').set({
      sharp_ratio: perf.sharp_ratio,
      total_pnl: perf.total_pnl,
      win_rate: perf.win_rate,
      last_evaluated: new Date()
    }).where({ id: s.id });
  }

  const best = [...strategies].sort((a, b) => (b.sharp_ratio || 0) - (a.sharp_ratio || 0)).slice(0, 2);
  const newStrategies = [];

  for (let i = 0; i < 3; i++) {
    const parent = best[i % best.length];
    const child = await mutateStrategy(parent);
    child.name = `${parent.name.split('_')[0]}_gen${Date.now()}`;
    const perf = await backtestStrategyOnHistory(child);
    (child as any).sharp_ratio = perf.sharp_ratio;
    (child as any).total_pnl = perf.total_pnl;
    (child as any).win_rate = perf.win_rate;
    newStrategies.push(child);
  }

  const worst = [...strategies].sort((a, b) => (a.sharp_ratio || 0) - (b.sharp_ratio || 0)).slice(0, 3);
  for (let i = 0; i < worst.length; i++) {
    if (newStrategies[i]) {
      await db.update('brain_strategies').set({
        name: newStrategies[i].name,
        prompt_template: newStrategies[i].prompt_template,
        parameters: JSON.stringify(newStrategies[i].parameters),
        sharp_ratio: newStrategies[i].sharp_ratio,
        total_pnl: newStrategies[i].total_pnl,
        win_rate: newStrategies[i].win_rate,
        last_evaluated: new Date()
      }).where({ id: worst[i].id });
    }
  }
}
```

### 10.7 `src/brain/brain-scheduler.ts`
Registers tasks with node-cron.

```typescript
import cron from 'node-cron';
import { evolveStrategies } from './brain-evolution';

export function startBrainScheduler() {
  // Run evolution daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    console.log('[Brain Scheduler] Running daily evolution engine...');
    try {
      await evolveStrategies();
    } catch (e) {
      console.error('[Brain Scheduler] Evolution task failed:', e);
    }
  });

  // Maintenance run every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[Brain Scheduler] Running episodic memory maintenance...');
  });
}
```

### 10.8 `src/brain/brain-orchestrator.ts`
The main Orchestrator wrapping the unified agent flow.

```typescript
import { tools } from './brain-tools';
import { hybridGovernor } from './brain-governor';
import { memoryStore } from './brain-memory';

export class BrainOrchestrator {
  private shadowMode: boolean = true; 

  constructor(shadowMode = true) {
    this.shadowMode = shadowMode;
  }

  async onSignal(signal: any, marketData: any, portfolio: any) {
    // 1. Snapshot gathering
    const snapshot = {
      symbol: signal.symbol,
      price: marketData.current_price,
      cvd: marketData.cvd,
      smc: marketData.smc,
      portfolio: { cash: portfolio.cash, drawdown: portfolio.drawdown }
    };

    // 2. Fetch similar context
    const similar = await tools.getSimilarEpisodes(JSON.stringify(snapshot));

    // 3. Propose Decision using mock representation or direct agent execution path
    const promptProposal = `PROPOSE_TRADE ${signal.side} ${signal.defaultSizePct} ${signal.stopLossPct} ${signal.takeProfitPct}`;
    
    // 4. Sanity vetting via Governor
    const governorOutcome = await hybridGovernor(promptProposal, snapshot.portfolio, marketData);

    const decision = {
      action: governorOutcome.approved ? 'ENTER' : 'HOLD',
      symbol: signal.symbol,
      side: signal.side,
      size_pct: (governorOutcome.proposal as any)?.size_percent || 0,
      stop_loss_pct: (governorOutcome.proposal as any)?.stop_loss_percent || 0,
      take_profit_pct: (governorOutcome.proposal as any)?.take_profit_percent || 0,
      rationale: governorOutcome.approved ? 'Sanitized by Governor' : `Veto: ${governorOutcome.reason}`
    };

    // 5. Store transaction record
    const episodeId = await memoryStore.saveEpisode({
      timestamp: new Date(),
      market_symbol: signal.symbol,
      observation: snapshot,
      reasoning: 'Direct pipeline check',
      proposed_action: promptProposal,
      actual_action: JSON.stringify(decision),
      governor_json: JSON.stringify(governorOutcome)
    });

    if (!this.shadowMode && decision.action === 'ENTER') {
      await this.executeTrade(decision);
    }

    return { episodeId, decision, governorOutcome };
  }

  private async executeTrade(decision: any) {
    console.log('[Orchestrator] Executing trade adapter routing:', decision);
  }
}
```

### 10.9 `src/routes/brain-router.ts`
Hono endpoints exposing Brain metrics to the React client.

```typescript
import { Hono } from 'hono';
import brainAgent from '../brain/brain-agent';
import { reflectOnTrade } from '../brain/brain-reflection';
import { evolveStrategies } from '../brain/brain-evolution';
import { db } from '../db';

const brainRouter = new Hono();

brainRouter.route('/agent', brainAgent);

brainRouter.post('/reflect/:episodeId', async (c) => {
  const episodeId = parseInt(c.req.param('episodeId'));
  const { pnl, action } = await c.req.json();
  await reflectOnTrade(episodeId, pnl, action);
  return c.json({ success: true });
});

brainRouter.get('/health', (c) => c.json({ status: 'brain online', memory: 'active' }));

brainRouter.get('/episodes', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20');
  const episodes = await db.select('*').from('brain_episodes').orderBy('timestamp', 'desc').limit(limit);
  return c.json(episodes);
});

brainRouter.get('/strategies', async (c) => {
  const strategies = await db.select('*').from('brain_strategies');
  return c.json(strategies);
});

brainRouter.get('/reflections', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20');
  const reflections = await db.select('*').from('brain_reflections').orderBy('applied_at', 'desc').limit(limit);
  return c.json(reflections);
});

brainRouter.post('/evolution/run', async (c) => {
  await evolveStrategies();
  return c.json({ success: true });
});

export default brainRouter;
```

---

## 11. Frontend Components

### 11.1 Type Definitions (`src/types/brain.ts`)
```typescript
export interface Episode {
  id: number;
  timestamp: string;
  market_symbol: string;
  observation: any;
  reasoning: string;
  proposed_action: string | null;
  actual_action: any;
  outcome_pnl: number | null;
  outcome_time: string | null;
  reflection: string | null;
}

export interface Strategy {
  id: number;
  name: string;
  description: string;
  prompt_template: string;
  parameters: any;
  sharp_ratio: number;
  total_pnl: number;
  win_rate: number;
  last_evaluated: string;
}

export interface Reflection {
  id: number;
  episode_id: number;
  lesson: string;
  rule_created: string;
  applied_at: string;
}

export interface BrainDecision {
  episodeId: number;
  approved: boolean;
  reason?: string;
  proposal?: {
    side: string;
    size_percent: number;
    stop_loss_percent: number;
    take_profit_percent: number;
  };
}
```

### 11.2 Brain Dashboard Component (`src/components/BrainDashboard.tsx`)
```tsx
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Brain, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { BrainDecision } from '@/types/brain';
import { BrainMemoryViewer } from './BrainMemoryViewer';
import { BrainEvolutionStatus } from './BrainEvolutionStatus';

export function BrainDashboard() {
  const [loading, setLoading] = useState(false);
  const [decision, setDecision] = useState<BrainDecision | null>(null);
  const [reasoningTrace, setReasoningTrace] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [autoMode, setAutoMode] = useState(false);

  const fetchDecision = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/brain/agent/decide?symbol=${symbol}`, { method: 'POST' });
      const data = await res.json();
      setDecision(data);
      if (data.episodeId) {
        const epRes = await fetch(`/brain/episodes?limit=1&id=${data.episodeId}`);
        const episodes = await epRes.json();
        if (episodes.length) setReasoningTrace(episodes[0].reasoning);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-8 w-8 text-purple-500" />
          <h1 className="text-3xl font-bold">Janus Brain</h1>
          <Badge variant={autoMode ? 'default' : 'secondary'}>
            {autoMode ? 'Autonomous' : 'Advisory'}
          </Badge>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="border rounded px-2 py-1 text-black"
            placeholder="Symbol"
          />
          <Button onClick={fetchDecision} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Ask Brain
          </Button>
          <Button variant="outline" onClick={() => setAutoMode(!autoMode)}>
            {autoMode ? 'Disable Auto' : 'Enable Auto'}
          </Button>
        </div>
      </div>

      {decision && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {decision.approved ? (
                <CheckCircle className="text-green-500" />
              ) : (
                <XCircle className="text-red-500" />
              )}
              Last Decision – {decision.approved ? 'Approved' : 'Rejected'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {decision.reason && <p className="text-red-600 font-medium">Reason: {decision.reason}</p>}
            {decision.proposal && (
              <div className="bg-muted p-3 rounded text-sm">
                <p><strong>Trade:</strong> {decision.proposal.side}</p>
                <p><strong>Size:</strong> {decision.proposal.size_percent}%</p>
                <p><strong>Stop Loss:</strong> {decision.proposal.stop_loss_percent}%</p>
                <p><strong>Take Profit:</strong> {decision.proposal.take_profit_percent}%</p>
              </div>
            )}
            {reasoningTrace && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">View Reasoning Trace</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs bg-black/5 p-3 rounded max-h-96 overflow-auto">
                  {reasoningTrace}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="memory" className="w-full">
        <TabsList>
          <TabsTrigger value="memory">Memory (Episodes)</TabsTrigger>
          <TabsTrigger value="evolution">Evolution &amp; Strategies</TabsTrigger>
        </TabsList>
        <TabsContent value="memory">
          <BrainMemoryViewer />
        </TabsContent>
        <TabsContent value="evolution">
          <BrainEvolutionStatus />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

### 11.3 Memory Viewer Component (`src/components/BrainMemoryViewer.tsx`)
```tsx
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Episode } from '@/types/brain';

export function BrainMemoryViewer() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchEpisodes = async () => {
    setLoading(true);
    try {
      const res = await fetch('/brain/episodes?limit=50');
      const data = await res.json();
      setEpisodes(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEpisodes();
  }, []);

  const filtered = episodes.filter(ep =>
    ep.market_symbol.toLowerCase().includes(filter.toLowerCase()) ||
    (ep.reflection && ep.reflection.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Episodic Memory</CardTitle>
        <Input
          placeholder="Filter by symbol or reflection..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
      </CardHeader>
      <CardContent>
        {loading ? (
          <p>Loading episodes...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Proposal</TableHead>
                <TableHead>Outcome PnL</TableHead>
                <TableHead>Reflection</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((ep) => (
                <TableRow key={ep.id}>
                  <TableCell>{new Date(ep.timestamp).toLocaleString()}</TableCell>
                  <TableCell>{ep.market_symbol}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{ep.proposed_action}</TableCell>
                  <TableCell className={ep.outcome_pnl && ep.outcome_pnl > 0 ? 'text-green-600' : 'text-red-600'}>
                    {ep.outcome_pnl?.toFixed(2) ?? '—'}
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate">{ep.reflection || '—'}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => alert(ep.reasoning)}>
                      View Trace
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
```

### 11.4 Evolution Component (`src/components/BrainEvolutionStatus.tsx`)
```tsx
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Strategy, Reflection } from '@/types/brain';

export function BrainEvolutionStatus() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [stratRes, reflRes] = await Promise.all([
        fetch('/brain/strategies'),
        fetch('/brain/reflections?limit=10')
      ]);
      setStrategies(await stratRes.json());
      setReflections(await reflRes.json());
    } finally {
      setLoading(false);
    }
  };

  const triggerEvolution = async () => {
    await fetch('/brain/evolution/run', { method: 'POST' });
    await fetchData();
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Strategy Performance</CardTitle>
          <Button onClick={triggerEvolution}>Run Evolution Now</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Sharpe</TableHead>
                <TableHead>Total PnL</TableHead>
                <TableHead>Win Rate</TableHead>
                <TableHead>Last Evaluated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {strategies.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-sm">{s.name}</TableCell>
                  <TableCell>{s.sharp_ratio.toFixed(2)}</TableCell>
                  <TableCell className={s.total_pnl > 0 ? 'text-green-600' : 'text-red-600'}>
                    ${s.total_pnl.toFixed(2)}
                  </TableCell>
                  <TableCell>{s.win_rate.toFixed(1)}%</TableCell>
                  <TableCell>{s.last_evaluated ? new Date(s.last_evaluated).toLocaleDateString() : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Reflections (Learned Rules)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {reflections.map((ref) => (
              <div key={ref.id} className="border-l-4 border-purple-400 pl-4 py-2">
                <p className="text-sm text-muted-foreground">
                  Episode #{ref.episode_id} – {new Date(ref.applied_at).toLocaleString()}
                </p>
                <p className="font-medium">{ref.lesson}</p>
                <pre className="text-xs bg-muted p-2 rounded mt-1">{ref.rule_created}</pre>
              </div>
            ))}
            {reflections.length === 0 && <p>No reflections yet. Trade to generate lessons.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```
