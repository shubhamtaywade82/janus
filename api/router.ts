import { authRouter } from "./auth-router";
import { marketRouter } from "./routers/market-router";
import { tradingRouter } from "./routers/trading-router";
import { signalRouter } from "./routers/signal-router";
import { logsRouter } from "./routers/logs-router";
import { telegramRouter } from "./routers/telegram-router";
import { botRouter } from "./routers/bot-router";
import { autoExecutorRouter } from "./routers/auto-executor-router";
import { llmRouter } from "./routers/llm-router";
import { positionManagerRouter } from "./routers/position-manager-router";
import { alertsRouter } from "./routers/alerts-router";
import { exportRouter } from "./routers/export-router";
import { healthRouter } from "./routers/health-router";
import { brainTrpcRouter } from "./routers/brain-trpc-router";
import { performanceRouter } from "./routers/performance-router";
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
  autoExecutor: autoExecutorRouter,
  llm: llmRouter,
  positionManager: positionManagerRouter,
  alerts: alertsRouter,
  exports: exportRouter,
  health: healthRouter,
  brain: brainTrpcRouter,
  performance: performanceRouter,
});

export type AppRouter = typeof appRouter;
