---
type: "query"
date: "2026-06-16T07:31:18.267050+00:00"
question: "Why does getDb() connect Auto Executor & Database Queries to Position Management & AI Advisor and all other core backend modules?"
contributor: "graphify"
source_nodes: ["getDb()", "connection.ts"]
---

# Q: Why does getDb() connect Auto Executor & Database Queries to Position Management & AI Advisor and all other core backend modules?

## Answer

Expanded from original query via vocab: [get, connection, position, management, executor, queries, advisor, schema]. getDb() (api/queries/connection.ts:L11) is the global database client initializer. Every module requiring persistent state storage—such as Auto Executor (config checks), Position Manager (snapshots and transaction ledgers), and Paper Trading Adapter (balances and virtual wallets)—calls getDb() to instantiate query builders and execute database transactions, making it the central state bridge of the application.

## Source Nodes

- getDb()
- connection.ts