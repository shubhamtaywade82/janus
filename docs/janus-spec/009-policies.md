# JDS-009: Pre-Execution Policy Engine & Pipeline
Version: 1.0
Status: Approved

The Policy Engine acts as the strict safety gate. All proposed trades must pass through this pipeline before execution.

```typescript
class PolicyPipeline {
  private filters: PolicyFilter[] = [];

  public addFilter(filter: PolicyFilter): void {
    this.filters.push(filter);
  }

  public async execute(proposal: ExecutionPlan, context: SystemContext): Promise<PolicyResult> {
    let activePlan = { ...proposal };
    for (const filter of this.filters) {
      const result = await filter.evaluate(activePlan, context);
      if (!result.passed) {
        return { passed: false, rejectReason: `${filter.name}: ${result.rejectReason}` };
      }
      if (result.adjustedPlan) {
        activePlan = result.adjustedPlan;
      }
    }
    return { passed: true, adjustedPlan: activePlan };
  }
}
```

---

## 1. Concrete Policy Rules

### 1.1 RiskPolicy
- **Rule 1**: Absolute Drawdown limit check. Current daily equity drop must be < 5.0%.
- **Rule 2**: Maximum Position Size check. A single trade cannot allocate more than 2% of total capital.
- **Rule 3**: Leverage constraint. Hard ceiling of 5x.

### 1.2 NewsPolicy
- **Rule 1**: Prevents new executions within 15 minutes of major economic reports (CPI, FOMC rates).
- **Rule 2**: Automatically raises SL buffers by 50% if in shadow mode during high volatility announcements.

### 1.3 SessionPolicy
- **Rule 1**: Prevents trading during low-liquidity exchange maintenance sessions.
- **Rule 2**: Gated spread check. Bid-Ask spread must be < 0.05% of asset price.

### 1.4 AIPolicy
- **Rule 1**: Trade is blocked if LLM confidence score < 70%.
- **Rule 2**: Rejects trade size proposals that exceed 1.5x of the baseline size if the AI reviewer confidence is medium.
