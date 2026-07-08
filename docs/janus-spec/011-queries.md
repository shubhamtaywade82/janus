# JDS-011: Queries Specification
Version: 1.0
Status: Approved

Queries retrieve optimized read model projections. They are read-only and bypass the event store pipeline.

## 1. Query Catalog

### `GetMarketSnapshot`
- **Input**: `{ symbol: string, timeframe: string }`
- **Output Schema**:
```typescript
interface MarketSnapshotOutput {
  symbol: string;
  price: number;
  spread: number;
  cvd24h: number;
  rsi: number;
  volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH';
}
```

### `GetActiveLevels`
- **Input**: `{ symbol: string }`
- **Output Schema**:
```typescript
interface ActiveLevelsOutput {
  activeOrderBlocks: OrderBlockNode[];
  activeFairValueGaps: FvgNode[];
  liquidityPools: LiquidityPoolNode[];
}
```

### `GetPositionStatus`
- **Input**: `{ workflowId: string }`
- **Output Schema**:
```typescript
interface PositionStatusOutput {
  workflowId: string;
  state: string;
  entryPrice: number;
  currentMarkPrice: number;
  unrealizedPnlUsdt: number;
  rMultiple: number;
  stopPrice: number;
}
```

### `GetSimilarEpisodes`
- **Input**: `{ embedding: number[] }`
- **Output Schema**:
```typescript
interface SimilarEpisodesOutput {
  episodes: Array<{
    episodeId: string;
    similarity: number;
    outcome: 'WIN' | 'LOSS';
    pnlUsdt: number;
    lessons: string[];
  }>;
}
```
