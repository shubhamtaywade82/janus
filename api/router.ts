import { authRouter } from "./auth-router";
import { marketRouter } from "./routers/market-router";
import { tradingRouter } from "./routers/trading-router";
import { signalRouter } from "./routers/signal-router";
import { logsRouter } from "./routers/logs-router";
import { telegramRouter } from "./routers/telegram-router";
import { botRouter } from "./routers/bot-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  market: marketRouter,
  trading: tradingRouter,
  signal: signalRouter,
  logs: logsRouter,
  telegram: telegramRouter,
  bot: botRouter,
});

export type AppRouter = typeof appRouter;
