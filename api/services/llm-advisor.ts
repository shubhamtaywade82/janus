/**
 * LLM Advisor
 * Multi-provider HTTP client with key rotation.
 * Supports Ollama (local/cloud), OpenAI, Anthropic.
 *
 * Key rotation:
 * - Keys sorted by priority ASC (1 = primary, 2 = first fallback...)
 * - On 429 → 5min backoff
 * - On 503 → 2min backoff
 * - On network error → 30s backoff
 * - All keys unhealthy → allow execute with sizeMult=0.5 (conservative)
 */

import { getDb } from "../queries/connection";
import { llmApiKeys } from "@db/schema";
import { eq, asc } from "drizzle-orm";
import { env } from "../lib/env";

export interface SignalContext {
  symbol: string;
  direction: string;
  compositeScore: number;
  threshold: number;
  regime: string;
  strategy: string;
  currentPrice: number;
  drawdownPct: number;
  tradeCount: number;
  openPositions: number;
  rsi?: number;
  ema20?: number;
  ema50?: number;
  spread?: number;
  imbalance?: number;
  atrPct?: number;
}

export interface LlmDecision {
  decision: "execute" | "skip" | "reduce_size";
  confidence: number;      // 0–100
  reasoning: string;
  sizeMult: number;        // 0.5 | 1.0 | 1.5
  keyUsed: string;
  latencyMs: number;
  error?: string;
  stopLossPct?: number;
  takeProfitPct?: number;
}

interface LlmKey {
  id: number;
  label: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  priority: number;
}

export class LlmAdvisor {
  private keys: LlmKey[] = [];
  private unhealthyUntil = new Map<number, number>(); // keyId → timestamp

  async init(): Promise<void> {
    await this.refreshKeys();
    // Seed env-level Ollama keys if no DB keys exist
    if (this.keys.length === 0 && env.ollamaApiKeys.length > 0) {
      env.ollamaApiKeys.forEach((key, i) => {
        this.keys.push({
          id: -(i + 1), // negative ID = env-seeded
          label: i === 0 ? "env-primary" : `env-backup-${i}`,
          provider: "ollama",
          endpoint: env.ollamaEndpoint,
          apiKey: key,
          model: env.ollamaModel,
          priority: i + 1,
        });
      });
    }
    // If no API keys but Ollama endpoint set, add keyless local entry
    if (this.keys.length === 0) {
      this.keys.push({
        id: -99,
        label: "local-ollama",
        provider: "ollama",
        endpoint: env.ollamaEndpoint,
        apiKey: "",
        model: env.ollamaModel,
        priority: 1,
      });
    }

    // Refresh DB keys every 60s so UI changes take effect
    setInterval(() => this.refreshKeys().catch(() => {}), 60_000);
    console.log(`[llm-advisor] Initialized with ${this.keys.length} key(s)`);
  }

  private async refreshKeys(): Promise<void> {
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(llmApiKeys)
        .where(eq(llmApiKeys.isActive, true))
        .orderBy(asc(llmApiKeys.priority));
      
      const dbKeys = rows.map((r) => ({
        id: r.id,
        label: r.label,
        provider: r.provider,
        endpoint: r.endpoint,
        apiKey: r.apiKey ?? "",
        model: r.model,
        priority: r.priority,
      }));

      if (dbKeys.length > 0) {
        this.keys = dbKeys;
      } else {
        const fallbacks: LlmKey[] = [];
        if (env.ollamaApiKeys.length > 0) {
          env.ollamaApiKeys.forEach((key, i) => {
            fallbacks.push({
              id: -(i + 1),
              label: i === 0 ? "env-primary" : `env-backup-${i}`,
              provider: "ollama",
              endpoint: env.ollamaEndpoint,
              apiKey: key,
              model: env.ollamaModel,
              priority: i + 1,
            });
          });
        }
        if (fallbacks.length === 0) {
          fallbacks.push({
            id: -99,
            label: "local-ollama",
            provider: "ollama",
            endpoint: env.ollamaEndpoint,
            apiKey: "",
            model: env.ollamaModel,
            priority: 1,
          });
        }
        this.keys = fallbacks;
      }
    } catch {
      // DB not ready yet — keep existing keys
    }
  }

  private pickHealthyKey(): LlmKey | null {
    const now = Date.now();
    return (
      this.keys
        .filter((k) => {
          const unhealthyTs = this.unhealthyUntil.get(k.id);
          return !unhealthyTs || now > unhealthyTs;
        })
        .sort((a, b) => a.priority - b.priority)[0] ?? null
    );
  }

  private markUnhealthy(keyId: number, durationMs: number) {
    this.unhealthyUntil.set(keyId, Date.now() + durationMs);
  }

  private async updateKeyStats(keyId: number, success: boolean): Promise<void> {
    if (keyId < 0) return; // env-seeded keys have no DB row
    try {
      const db = getDb();
      const row = await db
        .select({ requestCount: llmApiKeys.requestCount, errorCount: llmApiKeys.errorCount })
        .from(llmApiKeys)
        .where(eq(llmApiKeys.id, keyId))
        .limit(1);
      if (row[0]) {
        await db
          .update(llmApiKeys)
          .set({
            requestCount: (row[0].requestCount ?? 0) + 1,
            errorCount: success ? (row[0].errorCount ?? 0) : (row[0].errorCount ?? 0) + 1,
            lastUsedAt: new Date(),
          })
          .where(eq(llmApiKeys.id, keyId));
      }
    } catch { /* non-fatal */ }
  }

  private buildPrompt(ctx: SignalContext): string {
    return `You are a professional crypto futures trader reviewing a trade signal.

Symbol: ${ctx.symbol} perpetual
Market regime: ${ctx.regime} → active strategy: ${ctx.strategy}
Signal direction: ${ctx.direction.toUpperCase()} (composite score ${ctx.compositeScore.toFixed(1)} / threshold ${ctx.threshold})
Current price: ${ctx.currentPrice}
${ctx.rsi != null ? `RSI(14): ${ctx.rsi.toFixed(1)}` : ""}
${ctx.ema20 != null ? `EMA20: ${ctx.ema20.toFixed(2)}  EMA50: ${ctx.ema50?.toFixed(2)}` : ""}
${ctx.spread != null ? `Spread: ${ctx.spread.toFixed(3)}%  Book imbalance: ${ctx.imbalance?.toFixed(3)}` : ""}
${ctx.atrPct != null ? `ATR%: ${ctx.atrPct.toFixed(2)}%` : ""}
Portfolio: ${ctx.drawdownPct.toFixed(2)}% daily loss used, ${ctx.tradeCount} trades today, ${ctx.openPositions} open positions

Decide whether to execute this signal. Respond ONLY with valid JSON — no markdown, no explanation outside JSON:
{"decision":"execute","confidence":85,"reasoning":"one sentence max","sizeMult":1.0}

decision must be one of: execute | skip | reduce_size
confidence: integer 0-100
sizeMult: 0.5 (reduce) | 1.0 (normal) | 1.5 (increase, only if very high conviction)`;
  }

  private async callOllama(key: LlmKey, prompt: string): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key.apiKey) headers["Authorization"] = `Bearer ${key.apiKey}`;

    const res = await fetch(`${key.endpoint}/api/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: key.model, prompt, stream: false }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const err: any = new Error(`LLM HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const json = await res.json() as { response?: string };
    return json.response ?? "";
  }

  private async callOpenAI(key: LlmKey, prompt: string): Promise<string> {
    const res = await fetch(`${key.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key.apiKey}`,
      },
      body: JSON.stringify({
        model: key.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 120,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const err: any = new Error(`LLM HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const json = await res.json() as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? "";
  }

  private async callLlm(key: LlmKey, prompt: string): Promise<string> {
    if (key.provider === "openai" || key.provider === "anthropic") {
      return this.callOpenAI(key, prompt);
    }
    return this.callOllama(key, prompt);
  }

  private parseResponse(raw: string): Omit<LlmDecision, "keyUsed" | "latencyMs"> {
    // Extract JSON from response (model may wrap in markdown)
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error("No JSON in LLM response");

    const parsed = JSON.parse(jsonMatch[0]) as {
      decision?: string;
      confidence?: number;
      reasoning?: string;
      sizeMult?: number;
    };

    const decision = (["execute", "skip", "reduce_size"].includes(parsed.decision ?? "")
      ? parsed.decision
      : "execute") as LlmDecision["decision"];

    return {
      decision,
      confidence: Math.min(100, Math.max(0, Math.round(parsed.confidence ?? 70))),
      reasoning: String(parsed.reasoning ?? "").slice(0, 200),
      sizeMult: [0.5, 1.0, 1.5].includes(parsed.sizeMult ?? 1.0)
        ? (parsed.sizeMult ?? 1.0)
        : 1.0,
    };
  }

  private defaultDecision(error: string): LlmDecision {
    return {
      decision: "execute",
      confidence: 50,
      reasoning: `LLM unavailable (${error}) — proceeding with reduced size`,
      sizeMult: 0.5,
      keyUsed: "none",
      latencyMs: 0,
      error,
    };
  }

  async analyzeSignal(ctx: SignalContext, depth = 0): Promise<LlmDecision> {
    const t0 = Date.now();
    try {
      const { BrainOrchestrator } = await import("../brain/brain-orchestrator");
      const shadowModeEnv = process.env.BRAIN_SHADOW_MODE !== "false";
      
      const orchestrator = new BrainOrchestrator(shadowModeEnv);
      const brainResult = await orchestrator.decide(ctx.symbol, 1, ctx);
      
      const parsedDecision = brainResult.decision;
      const isApproved = brainResult.approved;
      
      let decision: LlmDecision["decision"] = "skip";
      if (isApproved && parsedDecision.mode === "enter") {
        decision = parsedDecision.sizePct && parsedDecision.sizePct <= 2.5 ? "reduce_size" : "execute";
      }
      
      return {
        decision,
        confidence: Math.round((parsedDecision.confidence ?? 0.8) * 100),
        reasoning: parsedDecision.rationale || (isApproved ? "Approved by Safety Governor" : brainResult.rejectReason || "Rejected by Safety Governor"),
        sizeMult: parsedDecision.sizePct ? (parsedDecision.sizePct / 5.0) : 1.0,
        keyUsed: `Ollama (ReAct Brain - ${shadowModeEnv ? "Shadow" : "Live"})`,
        latencyMs: Date.now() - t0,
        stopLossPct: parsedDecision.stopLossPct ? (parsedDecision.stopLossPct / 100) : undefined,
        takeProfitPct: parsedDecision.takeProfitPct ? (parsedDecision.takeProfitPct / 100) : undefined,
      };
    } catch (err: any) {
      console.error("[llm-advisor] ReAct Brain failed, falling back to legacy LLM pipeline:", err.message);
      return this.analyzeSignalLegacy(ctx, depth);
    }
  }

  async analyzeSignalLegacy(ctx: SignalContext, depth = 0): Promise<LlmDecision> {
    if (depth >= this.keys.length) {
      return this.defaultDecision("all keys exhausted or unhealthy");
    }

    const key = this.pickHealthyKey();
    if (!key) return this.defaultDecision("no healthy key available");

    const prompt = this.buildPrompt(ctx);
    const t0 = Date.now();

    try {
      const raw = await this.callLlm(key, prompt);
      const parsed = this.parseResponse(raw);
      await this.updateKeyStats(key.id, true);
      return { ...parsed, keyUsed: key.label, latencyMs: Date.now() - t0 };
    } catch (err: any) {
      const status = err?.status ?? 0;
      if (status === 429) this.markUnhealthy(key.id, 5 * 60_000);
      else if (status === 503) this.markUnhealthy(key.id, 2 * 60_000);
      else this.markUnhealthy(key.id, 30_000);

      await this.updateKeyStats(key.id, false);
      console.warn(`[llm-advisor] Key "${key.label}" error (${status || err.message}) — trying next`);
      return this.analyzeSignalLegacy(ctx, depth + 1);
    }
  }

  async generateMarketSummary(symbol: string, data: any): Promise<string> {
    const key = this.pickHealthyKey();
    if (!key) return "AI Summary unavailable (no healthy LLM key configured).";

    const prompt = `You are an institutional crypto futures research analyst. Summarize this market data structure and provide a concise, high-conviction narrative and trade setup recommendation for ${symbol}.
    
    Data:
    - Overall Bias: ${data.overallBias} (${data.confidence}% structure confidence)
    - Multi-timeframe trend: ${JSON.stringify(data.mtf)}
    - Nearest Order Block: ${JSON.stringify(data.nearestOB)}
    - Nearest FVG: ${JSON.stringify(data.nearestFVG)}
    - Open Interest: ${JSON.stringify(data.openInterest)}
    - Funding Rate: ${JSON.stringify(data.funding)}
    - CVD Trend: ${JSON.stringify(data.cvd)}
    - Order Book Imbalance Ratio: ${data.orderbook.ratio} (Dominant side: ${data.orderbook.dominant_side})
    - Volume Profile Position: ${data.volumeProfile.current_position} (POC: ${data.volumeProfile.poc})
    
    Provide a professional, concise 3-4 sentence narrative verdict summarizing the market phase and warning signals. Respond ONLY with the plain text summary, do not add JSON formatting or intro/outro text.`;

    try {
      const raw = await this.callLlm(key, prompt);
      return raw.trim();
    } catch (err: any) {
      console.warn("[llm-advisor] Failed to generate market summary:", err.message);
      return "AI Summary generation failed. (LLM request timed out or returned an error).";
    }
  }

  getKeyById(id: number): LlmKey | undefined {
    return this.keys.find((k) => k.id === id);
  }

  async testSpecificKey(key: LlmKey): Promise<LlmDecision> {
    const testCtx: SignalContext = {
      symbol: "BTCUSDT",
      direction: "long",
      compositeScore: 80,
      threshold: 75,
      regime: "intraday_trend",
      strategy: "intraday",
      currentPrice: 100000,
      drawdownPct: 0,
      tradeCount: 0,
      openPositions: 0,
    };
    const prompt = this.buildPrompt(testCtx);
    const t0 = Date.now();
    const raw = await this.callLlm(key, prompt);
    const parsed = this.parseResponse(raw);
    return { ...parsed, keyUsed: key.label, latencyMs: Date.now() - t0 };
  }

  getKeyStatus(): { id: number; label: string; provider: string; model: string; healthy: boolean; requestCount?: number }[] {
    const now = Date.now();
    return this.keys.map((k) => ({
      id: k.id,
      label: k.label,
      provider: k.provider,
      model: k.model,
      healthy: !this.unhealthyUntil.has(k.id) || now > this.unhealthyUntil.get(k.id)!,
    }));
  }
}

export const globalLlmAdvisor = new LlmAdvisor();
