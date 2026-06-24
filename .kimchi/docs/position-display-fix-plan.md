# Fix Plan: Live Position Display Bug + LLM 401

## Root Causes

1. **DB Unique Constraint** (`db/schema.ts`): `uq_positions_open` enforces `(userId, symbol, side)` must be unique for `status = 'open'`. This makes it impossible to have 2 live positions on the same symbol+side.
2. **Merge Logic Bug** (`api/services/trading-service.ts`): `fetchPortfolioData` uses `dbPositions.find()` which always returns the FIRST match. When CoinDCX returns >1 position for the same symbol+side, both exchange positions get mapped to the same DB row, producing duplicate IDs in the stream.
3. **React Duplicate Key Risk** (`src/pages/Portfolio.tsx`): `key={pos.id}` renders 2 rows with the same key when merge produces duplicate IDs.
4. **LLM 401** (`api/services/position-manager/llm-client.ts`): Expired `PM_OLLAMA_CLOUD_KEY_*` env vars cause endless 401 retries.

---

## Chunks

### Chunk 1 — DB Schema: Remove `uq_positions_open` unique index
**File**: `db/schema.ts`
- Remove `uqOpenPosition: uniqueIndex(...)` from the positions table definition.
- Keep the regular indexes (`userIdStatusIdx`, `symbolIdx`).
- Run `npm run db:push` after build (or document it).

**Acceptance**: Schema no longer contains `uq_positions_open`. Drizzle push succeeds.

### Chunk 2 — Backend Merge Logic: `fetchPortfolioData`
**File**: `api/services/trading-service.ts`
- Replace `.find()` matching with a `Map<string, Position[]>` that groups DB positions by `symbol:side`.
- Track consumed DB matches per exchange position: for each exchange position, shift the next available unmatched DB position.
- After the merge loop, append any **unmatched DB live positions** (`!isPaper`) to `mergedLive` so orphaned DB rows still appear.
- Ensure orphan exchange positions get synthetic IDs (`10000 + i`).

**Acceptance**: No duplicate IDs in `mergedLive`. All DB live positions appear in `allPositions`.

### Chunk 3 — Frontend Rendering Guard
**File**: `src/pages/Portfolio.tsx`
- Change `key={pos.id}` to `key={pos.id + '-' + (pos.exchangeOrderId ?? pos.symbol ?? idx)}` so duplicate IDs don't collapse rows.
- In `livePositionsOnlyDb` merge, de-duplicate by ID before rendering.

**Acceptance**: Even if backend produces duplicate IDs temporarily, all rows render.

### Chunk 4 — LLM 401: Add env-aware fallback
**File**: `api/services/position-manager/llm-client.ts`
- Add early-return in `envLiveKeys()`: if `PM_OLLAMA_CLOUD_KEY_1` is set but looks like a placeholder or test value, log a clear warning instead of endlessly retrying.
- After exhausting all keys, increase backoff to 60s and log a clear ONCE-style warning.
(No env var changes — the fix is code-only logging/backoff. The real fix is updating env vars, which is ops.)

**Acceptance**: 401 errors no longer spam logs every 30s; single clear warning + 60s backoff.

---

## Verification
- Open 2 positions on CoinDCX for same symbol+side → both appear in portfolio list.
- Backend logs show unique array length matching exchange count.
- React console shows no duplicate-key warnings.
