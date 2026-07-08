# JDS-010: Commands Catalog
Version: 1.0
Status: Approved

Commands represent intent to change the state of Janus aggregates. All command payloads are validated using strict Zod schemas.

## 1. Command List

### `StartTradeWorkflow`
- **Target**: `TradeWorkflow` (Aggregate)
- **Validation Schema**:
```typescript
const StartTradeWorkflowSchema = z.object({
  symbol: z.string(),
  strategyId: z.string(),
  direction: z.enum(['LONG', 'SHORT']),
  suggestedSize: z.number().positive(),
  initialStopLoss: z.number().positive(),
  initialTakeProfit: z.number().positive(),
  correlationId: z.string().uuid()
});
```

### `PlaceLimitOrder`
- **Target**: `Order` (Entity)
- **Validation Schema**:
```typescript
const PlaceLimitOrderSchema = z.object({
  workflowId: z.string().uuid(),
  symbol: z.string(),
  price: z.number().positive(),
  quantity: z.number().positive(),
  side: z.enum(['BUY', 'SELL'])
});
```

### `AdjustTrailingStop`
- **Target**: `TradeWorkflow` (Aggregate)
- **Validation Schema**:
```typescript
const AdjustTrailingStopSchema = z.object({
  workflowId: z.string().uuid(),
  newStopPrice: z.number().positive(),
  reason: z.string()
});
```

### `ExecuteKillSwitch`
- **Target**: `RiskProfileAggregate`
- **Validation Schema**:
```typescript
const ExecuteKillSwitchSchema = z.object({
  accountId: z.string(),
  reason: z.string(),
  triggeredBy: z.enum(['SYSTEM_HEURISTIC', 'OPERATOR', 'AI_BRAIN'])
});
```
