import { z } from "zod";

export const brainDecisionSchema = z.object({
  mode: z.enum(["hold", "enter", "scale_in", "scale_out", "exit", "pause"]),
  symbol: z.string().optional(),
  side: z.enum(["long", "short"]).optional(),
  confidence: z.number().min(0).max(1), // 0 to 1
  rationale: z.string(),
  sizePct: z.number().optional(),
  stopLossPct: z.number().optional(),
  takeProfitPct: z.number().optional(),
  timeInForce: z.enum(["ioc", "gtt", "market", "limit"]).optional(),
  riskNotes: z.array(z.string()).default([]),
  evidence: z.object({
    market: z.array(z.string()).default([]),
    memory: z.array(z.string()).default([]),
    signals: z.array(z.string()).default([]),
  }).default({ market: [], memory: [], signals: [] })
});

export type BrainDecision = z.infer<typeof brainDecisionSchema>;

export const brainInputSchema = z.object({
  userId: z.number(),
  symbol: z.string(),
  market: z.any(), // MarketSnapshot
  portfolio: z.any(), // PortfolioSnapshot
  memory: z.array(z.any()).default([]),
  rules: z.array(z.string()).default([]),
});

export type BrainInput = z.infer<typeof brainInputSchema>;
