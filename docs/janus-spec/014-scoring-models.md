# JDS-014: Confluence Scoring Model Specification
Version: 1.0
Status: Approved

The Confluence Engine scores symbols every 30 seconds. The composite score is the weighted sum of three subcomponent scores.

```
                  +--------------------------+
                  |  Confluence Engine 30s   |
                  +--------------------------+
                   /            |           \
                  v             v            v
           +-------------+ +------------+ +-------------+
           | Micro (20%) | | Intra (45%)| | Swing (35%) |
           +-------------+ +------------+ +-------------+
                  \             |            /
                   v            v           v
                  +--------------------------+
                  |  Composite Score >= 75   |
                  +--------------------------+
```

## 1. Score Breakdown

### 1.1 Micro Component (20% Weight)
- **Calculated over**: 1-minute lookback windows.
- **Features Checked**:
  - Order Book Imbalance (OBI) index.
  - CVD tick momentum (5-candle derivative).
  - Ticker spread volatility.

### 1.2 Intra-Candle Component (45% Weight)
- **Calculated over**: 5-minute and 15-minute timeframes.
- **Features Checked**:
  - RSI extreme reversals (oversold/overbought boundaries).
  - Volatility band breakouts (Bollinger / Keltner channels).
  - Volume surges (relative volume index > 2.0).

### 1.3 Swing Component (35% Weight)
- **Calculated over**: 1-hour and 4-hour timeframes.
- **Features Checked**:
  - Distance from active OrderBlocks.
  - Presence of unmitigated Fair Value Gaps.
  - Sweep of liquidity pool highs/lows.

---

## 2. Gating Formulation
Let $S_{	ext{micro}}$, $S_{	ext{intra}}$, and $S_{	ext{swing}}$ represent normalized score indices between 0 and 100.

$$	ext{CompositeScore} = 0.20(S_{	ext{micro}}) + 0.45(S_{	ext{intra}}) + 0.35(S_{	ext{swing}})$$

- **Gating Decision Rule**:
  - If $	ext{CompositeScore} \ge 75$, then publish `SignalGatedEvent` with `isGated = true`.
  - Else, discard the setup.
