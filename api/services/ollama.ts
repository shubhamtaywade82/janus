/**
 * Ollama / OpenAI-compatible LLM Advisor
 *
 * Supports multiple API keys (comma-separated OLLAMA_API_KEYS or
 * numbered OLLAMA_API_KEY_1, OLLAMA_API_KEY_2, …).
 * When a key receives a 429 it is marked exhausted for COOLDOWN_MS and
 * the pool rotates to the next available key.
 * If every key is exhausted the advisor returns a neutral pass-through so
 * the execution pipeline is never blocked by the LLM.
 */

import type { ConfluenceScore } from "./confluence";
import type { RegimeResult } from "./regime-detector";

// ─── Config ───

const BASE_URL   = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL      = process.env.OLLAMA_MODEL     ?? "llama3.2";
const TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS ?? "15000", 10);
const COOLDOWN_MS = 5 * 60 * 1000; // 5 min after a 429

// ─── Key Pool ───

interface ApiKey {
  key: string;
  exhaustedUntil: number;  // 0 = available
  requestCount: number;
  errorCount: number;
}

function loadKeyPool(): ApiKey[] {
  const pool: ApiKey[] = [];

  // Comma-separated batch: OLLAMA_API_KEYS=key1,key2,key3
  const batch = process.env.OLLAMA_API_KEYS;
  if (batch) {
    batch.split(",").map((k) => k.trim()).filter(Boolean).forEach((k) =>
      pool.push({ key: k, exhaustedUntil: 0, requestCount: 0, errorCount: 0 })
    );
  }

  // Numbered fallback: OLLAMA_API_KEY_1, OLLAMA_API_KEY_2, …
  for (let i = 1; i <= 20; i++) {
    const k = process.env[`OLLAMA_API_KEY_${i}`];
    if (k && !pool.find((p) => p.key === k)) {
      pool.push({ key: k, exhaustedUntil: 0, requestCount: 0, errorCount: 0 });
    }
  }

  // Single key fallback
  const single = process.env.OLLAMA_API_KEY;
  if (single && !pool.find((p) => p.key === single)) {
    pool.push({ key: single, exhaustedUntil: 0, requestCount: 0, errorCount: 0 });
  }

  // Local Ollama needs no key — add a sentinel so the pool always has one entry
  if (pool.length === 0) {
    pool.push({ key: "local", exhaustedUntil: 0, requestCount: 0, errorCount: 0 });
  }

  return pool;
}

const keyPool: ApiKey[] = loadKeyPool();
let poolCursor = 0;

function nextAvailableKey(): ApiKey | null {
  const now = Date.now();
  for (let i = 0; i < keyPool.length; i++) {
    const idx = (poolCursor + i) % keyPool.length;
    const entry = keyPool[idx];
    if (entry.exhaustedUntil === 0 || now > entry.exhaustedUntil) {
      if (entry.exhaustedUntil !== 0) entry.exhaustedUntil = 0; // recovered
      poolCursor = (idx + 1) % keyPool.length;
      return entry;
    }
  }
  return null; // all exhausted
}

function markExhausted(entry: ApiKey) {
  entry.exhaustedUntil = Date.now() + COOLDOWN_MS;
  entry.errorCount++;
  console.warn(`[ollama] Key …${entry.key.slice(-6)} rate-limited — cooldown ${COOLDOWN_MS / 60_000}m`);
}

// ─── HTTP helper ───

export async function callLLM(prompt: string): Promise<string> {
  const entry = nextAvailableKey();
  if (!entry) {
    console.warn("[ollama] All keys exhausted — skipping LLM call");
    return "";
  }

  const isLocal = entry.key === "local";
  const url = isLocal
    ? `${BASE_URL}/api/generate`
    : `${BASE_URL}/v1/chat/completions`;

  const body = isLocal
    ? JSON.stringify({ model: MODEL, prompt, stream: false })
    : JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!isLocal) headers["Authorization"] = `Bearer ${entry.key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    entry.requestCount++;
    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });

    if (res.status === 429) {
      markExhausted(entry);
      // Retry with next key
      return callLLM(prompt);
    }

    if (!res.ok) {
      console.error(`[ollama] HTTP ${res.status} from LLM`);
      return "";
    }

    const json: any = await res.json();
    // Local Ollama: json.response; OpenAI-compat: json.choices[0].message.content
    return json?.response ?? json?.choices?.[0]?.message?.content ?? "";
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.warn("[ollama] LLM request timed out");
    } else {
      console.error("[ollama] Fetch error:", err.message);
    }
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// ─── Types ───

export interface LLMAdvice {
  approved: boolean;
  confidence: number;   // 0-100
  reasoning: string;
  skipped: boolean;     // true if LLM was unavailable
}

// ─── Signal Analysis Prompt ───

export async function analyzeSignalWithLLM(
  signal: Pick<ConfluenceScore, "symbol" | "direction" | "compositeScore" | "microScore" | "intraScore" | "swingScore" | "indicators">,
  regime: RegimeResult | null,
  recentPrices: number[]
): Promise<LLMAdvice> {
  const last  = recentPrices.at(-1) ?? 0;
  const prev5 = recentPrices.at(-6) ?? last;
  const pct5  = prev5 > 0 ? (((last - prev5) / prev5) * 100).toFixed(2) : "0";

  const prompt = `You are a concise crypto trading risk advisor. Respond in JSON only — no markdown, no explanation outside JSON.

Market signal:
- Symbol: ${signal.symbol}
- Direction: ${signal.direction}
- Composite score: ${signal.compositeScore}/100 (threshold: 75)
- Micro: ${signal.microScore} | Intra: ${signal.intraScore} | Swing: ${signal.swingScore}
- RSI: ${signal.indicators.rsi?.toFixed(1)} | Spread: ${signal.indicators.spread?.toFixed(4)}
- EMA20: ${signal.indicators.ema20?.toFixed(2)} | EMA50: ${signal.indicators.ema50?.toFixed(2)}
- Trend strength (ADX): ${signal.indicators.trendStrength?.toFixed(1)}
- Volatility regime: ${signal.indicators.volatilityRegime ?? "unknown"}

Market regime: ${regime?.regime ?? "unknown"} → strategy: ${regime?.strategy ?? "unknown"}
Regime reason: ${regime?.reason ?? "n/a"}

Recent price (last 6 candles): current=${last.toFixed(2)} change=${pct5}%

Based on these signals, should we execute this trade?
Respond with exactly: {"approved": true|false, "confidence": 0-100, "reasoning": "<one sentence>"}`;

  const raw = await callLLM(prompt);

  if (!raw) {
    return { approved: true, confidence: 50, reasoning: "LLM unavailable — defaulting to pass", skipped: true };
  }

  try {
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
    return {
      approved:   Boolean(parsed.approved),
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
      reasoning:  String(parsed.reasoning ?? ""),
      skipped:    false,
    };
  } catch {
    console.warn("[ollama] Failed to parse LLM response:", raw.slice(0, 200));
    return { approved: true, confidence: 50, reasoning: "LLM parse error — defaulting to pass", skipped: true };
  }
}

// ─── Key Pool Status (for bot status endpoint) ───

export function getOllamaPoolStatus() {
  const now = Date.now();
  return {
    model: MODEL,
    baseUrl: BASE_URL,
    keys: keyPool.map((k, i) => ({
      index: i + 1,
      suffix: k.key.slice(-6),
      available: k.exhaustedUntil === 0 || now > k.exhaustedUntil,
      exhaustedUntilMs: k.exhaustedUntil,
      requests: k.requestCount,
      errors: k.errorCount,
    })),
    availableCount: keyPool.filter((k) => k.exhaustedUntil === 0 || now > k.exhaustedUntil).length,
  };
}
