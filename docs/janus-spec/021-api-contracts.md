# JDS-021: API Contracts Spec (Hono & tRPC)
Version: 1.0
Status: Approved

Janus uses Hono for REST endpoints and tRPC for dashboard communications.

## 1. tRPC Routers Schema

```typescript
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();

export const appRouter = t.router({
  getMarketSnapshot: t.procedure
    .input(z.object({ symbol: z.string() }))
    .query(async ({ input }) => {
      return {
        symbol: input.symbol,
        price: 42500.5,
        cvd: 1250000,
        regime: 'TREND'
      };
    }),

  dispatchCommand: t.procedure
    .input(z.object({
      commandType: z.enum(['START_WORKFLOW', 'CANCEL_ORDER', 'TRIGGER_KILL_SWITCH']),
      payload: z.any()
    }))
    .mutation(async ({ input }) => {
      // Command Dispatch logic
      return { success: true, commandId: 'uuid-v4' };
    }),

  onGraphUpdate: t.procedure
    .subscription(() => {
      // Return WebSockets event stream
    })
});
```

---

## 2. Hono REST API Routes
- `GET /api/v1/health`: Checks connections to Postgres, Redis, and Qdrant.
- `POST /api/v1/webhook/coindcx`: Callback receiver for exchange fill notifications.
