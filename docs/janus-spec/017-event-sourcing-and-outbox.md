# JDS-017: Event Sourcing & Transactional Outbox Pattern
Version: 1.0
Status: Approved

This document specifies the physical schema of the Event Store and outlines the outbox propagation loop.

## 1. Event Store SQL Schema
Janus uses a Postgres schema optimized for event-append operations.

```sql
CREATE TABLE event_store (
  event_id UUID PRIMARY KEY,
  event_type VARCHAR(255) NOT NULL,
  aggregate_id VARCHAR(255) NOT NULL,
  aggregate_type VARCHAR(255) NOT NULL,
  sequence_number INT NOT NULL,
  correlation_id UUID NOT NULL,
  causation_id UUID NOT NULL,
  payload JSONB NOT NULL,
  metadata JSONB NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT unique_aggregate_seq UNIQUE(aggregate_id, sequence_number)
);

CREATE INDEX idx_aggregate_stream ON event_store(aggregate_type, aggregate_id);
```

---

## 2. Transactional Outbox Pattern
To prevent distributed transaction failures, events are saved to an `outbox` table in the same local Postgres transaction as the event store append.

```
[Command Handler]
       │
       ▼ (Atomically write to Postgres in 1 transaction)
+------------------------------------------------+
|  INSERT INTO event_store                       |
|  INSERT INTO outbox_table                      |
+------------------------------------------------+
       │
       ▼ (Background Poller - pg_notify or 100ms interval)
[Outbox Publisher Svc]
       │
       ▼ (Dispatches to)
[Redis Streams / WebSockets]
       │
       ▼ (On successful dispatch ack)
[DELETE FROM outbox_table]
```

### Outbox Recovery Rules
- **Deduplication**: Message brokers enforce deduplication keys based on `event_id`.
- **Retries**: If the message broker is offline, the Outbox Publisher retries using exponential backoff up to a maximum of 5 attempts, before sending the record to a Dead-Letter Queue (DLQ).
