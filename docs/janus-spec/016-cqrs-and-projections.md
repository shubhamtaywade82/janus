# JDS-016: CQRS Architecture & Projections Spec
Version: 1.0
Status: Approved

This document specifies the CQRS split and the mechanics of processing events into Read Projections.

## 1. The CQRS Split
Janus decouples write actions from read views:
- **Write Path (Commands)**: Handled by Command Handlers which validate constraints against local snapshots, generate domain events, append them to the Postgres event store, and update the Transactional Outbox.
- **Read Path (Projections)**: Background workers subscribe to published events asynchronously, updating optimized data stores (RedisJSON for dashboards and Qdrant for episodic memory).

---

## 2. Projection Implementations

### 2.1 CurrentPositionsProjection
Updates the real-time position dashboard.
- **Source Events**: `janus.execution.position_opened`, `janus.market.price_updated`, `janus.execution.position_closed`.
- **Target Storage**: RedisJSON key `portfolio:positions:<userId>`.
- **Handler Code Pattern**:
```typescript
class CurrentPositionsProjection {
  public async handle(event: DomainEventEnvelope): Promise<void> {
    switch (event.eventType) {
      case 'janus.execution.position_opened':
        await redis.json.set(`portfolio:positions:${event.payload.userId}`, `$`, event.payload);
        break;
      case 'janus.market.price_updated':
        await redis.json.numincrby(`portfolio:positions:${event.payload.userId}`, `$.markPrice`, event.payload.price);
        break;
      case 'janus.execution.position_closed':
        await redis.json.del(`portfolio:positions:${event.payload.userId}`);
        break;
    }
  }
}
```

### 2.2 ActiveOntologyProjection
Maintains the active structural graph (nodes and edges).
- **Source Events**: `janus.market.ob_detected`, `janus.market.fvg_detected`, `janus.market.level_mitigated`, `janus.market.level_invalidated`.
- **Target Storage**: RedisGraph + Postgres Graph.
