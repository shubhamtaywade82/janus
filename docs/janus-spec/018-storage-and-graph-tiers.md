# JDS-018: 3-Tier Graph Storage & Memory Layout
Version: 1.0
Status: Approved

This document specifies the technical runtime databases and indexing models used for the 3-Tier Graph.

```
+--------------------------------------------------------------------------+
|                             3-TIER GRAPH LAYOUT                          |
|                                                                          |
|  HOT TIER (0-30s): In-Memory Graphology Ring Buffer                      |
|  WARM TIER (24h):  RedisJSON & RedisGraph for Strategy Loops             |
|  COLD TIER (Deep): PostgreSQL JSONB Relational Tables                     |
+--------------------------------------------------------------------------+
```

## 1. Hot Tier: In-Memory (Node.js Graphology)
- **Technology**: JS `graphology` library.
- **Indexes**: Hash maps tracking node IDs and spatial coordinates.
- **Pruning**: Sliding time window. Nodes older than 30 seconds are evicted from memory to preserve performance.

## 2. Warm Tier: Session (RedisJSON & RedisGraph)
- **Technology**: RedisJSON modules.
- **Indices**: RediSearch index configured on JSON fields:
```
FT.CREATE idx:market_objects ON JSON SCHEMA
  $.id AS id TEXT
  $.symbol AS symbol TAG
  $.isInvalidated AS isInvalidated TAG
  $.startPrice AS startPrice NUMERIC
```
- **Sync Routine**: Level detection events write directly to Redis.

## 3. Cold Tier: Deep Storage (PostgreSQL Node/Edge Tables)
- **Technology**: Relational schema mapping nodes and edges:
```sql
CREATE TABLE graph_nodes (
  node_id VARCHAR(255) PRIMARY KEY,
  symbol VARCHAR(50) NOT NULL,
  object_type VARCHAR(100) NOT NULL,
  price_start NUMERIC,
  price_end NUMERIC,
  properties JSONB NOT NULL
);

CREATE TABLE graph_edges (
  edge_id VARCHAR(255) PRIMARY KEY,
  source_id VARCHAR(255) REFERENCES graph_nodes(node_id),
  target_id VARCHAR(255) REFERENCES graph_nodes(node_id),
  relationship_type VARCHAR(100) NOT NULL
);
```
