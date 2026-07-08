# JDS-023: Testing Strategy & Property-Based Verification
Version: 1.0
Status: Approved

This document specifies the quality assurance methodology, including property-based testing of invariants.

## 1. Property-Based Testing
Janus uses property-based testing (via libraries like `fast-check` in TypeScript) to verify mathematical and domain invariants over thousands of generated scenarios.

```typescript
import fc from 'fast-check';

describe('Market Ontology Invariants', () => {
  it('should guarantee that FVG mitigation ratio never leaves the range [0.0, 1.0]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0, max: 100000.0 }), // Current Price
        fc.double({ min: 0.0, max: 100000.0 }), // High
        fc.double({ min: 0.0, max: 100000.0 }), // Low
        (price, high, low) => {
          const fvg = new FairValueGap('fvg-1', 'BTC-USDT', 'BISI', 40000, 41000, 10);
          fvg.checkMitigation(price, high, low);
          return fvg.mitigationRatio >= 0.0 && fvg.mitigationRatio <= 1.0;
        }
      )
    );
  });
});
```

---

## 2. Simulation Verification
- **Deterministic Unit Tests**: Mock price data checks the Confluence calculation.
- **State Machine Verification**: Runs randomized event sequences against the `TradeWorkflow` to verify that invalid state transitions always abort.
