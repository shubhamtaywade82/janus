import { Hono } from "hono";
import { BrainOrchestrator } from "../brain/brain-orchestrator";
import { getDb } from "../queries/connection";
import { brainEpisodes, brainStrategies, brainReflections } from "@db/schema";
import { desc, limit } from "drizzle-orm";

export const brainRouter = new Hono();
const orchestrator = new BrainOrchestrator(true); // Shadow Mode active

// POST /api/brain/decide?symbol=BTCUSDT
brainRouter.post("/decide", async (c) => {
  const symbol = c.req.query("symbol") || "BTCUSDT";
  // Default to User ID 1 for single-user system context
  const userId = 1;
  
  try {
    const result = await orchestrator.decide(symbol, userId);
    return c.json(result);
  } catch (err: any) {
    console.error("[Brain Router] Decide failed:", err);
    return c.json({ error: err.message }, 500);
  }
});

// GET /api/brain/episodes
brainRouter.get("/episodes", async (c) => {
  const limitCount = parseInt(c.req.query("limit") || "50", 10);
  const db = getDb();
  
  try {
    const episodes = await db
      .select()
      .from(brainEpisodes)
      .orderBy(desc(brainEpisodes.timestamp))
      .limit(limitCount);
      
    return c.json(episodes);
  } catch (err: any) {
    console.error("[Brain Router] Fetch episodes failed:", err);
    return c.json({ error: err.message }, 500);
  }
});

// GET /api/brain/strategies
brainRouter.get("/strategies", async (c) => {
  const db = getDb();
  try {
    const strategies = await db.select().from(brainStrategies);
    return c.json(strategies);
  } catch (err: any) {
    console.error("[Brain Router] Fetch strategies failed:", err);
    return c.json({ error: err.message }, 500);
  }
});

// GET /api/brain/reflections
brainRouter.get("/reflections", async (c) => {
  const limitCount = parseInt(c.req.query("limit") || "20", 10);
  const db = getDb();
  try {
    const reflections = await db
      .select()
      .from(brainReflections)
      .orderBy(desc(brainReflections.appliedAt))
      .limit(limitCount);
      
    return c.json(reflections);
  } catch (err: any) {
    console.error("[Brain Router] Fetch reflections failed:", err);
    return c.json({ error: err.message }, 500);
  }
});

// POST /api/brain/evolution/run
brainRouter.post("/evolution/run", async (c) => {
  return c.json({ success: true, message: "Evolution trigger stub (Shadow Mode)" });
});
