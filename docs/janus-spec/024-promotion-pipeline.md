# JDS-024: Simulation Promotion Pipeline Spec
Version: 1.0
Status: Approved

Before code changes or strategy parameters are permitted to execute on real capital, they must progress through the four execution levels.

```
+--------------------------------------------------------------------------+
|                            PROMOTION GATES                               |
|                                                                          |
|  Tier 1: Pure Functions   --> Tier 2: Paper   --> Tier 3: Ghost  --> Live|
+--------------------------------------------------------------------------+
```

## 1. Promotion Criteria Matrix

| Gate | Execution Level | Data Source | Matcher Adapter | Promotion Thresholds |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1**| Pure Functions | Mock historical price Arrays | None | 100% unit test pass rate |
| **Tier 2**| Paper Simulation | Live WebSocket feed | Mock matching engine | > 50 trades, Profit Factor > 1.3 |
| **Tier 3**| Ghost Replay | Live WebSocket feed | Active order checks (mock fill) | 72 hours execution, 0 runtime errors |
| **Tier 4**| Live Trading | Live exchange feed | CoinDCX API wrapper | Handled using pilot size caps (1%) |

---

## 2. Automated Promotion Protocol
- If a strategy in **Tier 3 (Ghost Replay)** triggers any unhandled exception or policy validation failure, its promotion progress is reset to zero, and the system reverts the strategy to Tier 2.
- Weekly performance reviews automatically adjust maximum leverage and position caps based on live profit ratios.
