// ─── Position Manager LLM Client ────────────────────────────────────────────
// Self-contained LLM caller. Reads keys from the shared llm_api_keys table
// but does NOT modify llm-advisor.ts. Implements its own key selection and
// HTTP dispatch to support position-management-specific prompts.

import { getDb } from "../../queries/connection";
import { llmApiKeys } from "@db/schema";
import { eq, asc } from "drizzle-orm";
import type { AiRecommendation, PositionAction } from "./types";

interface LlmKey {
  id: number;
  label: string;
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  priority: number;
}

const unhealthyUntil = new Map<number, number>();
let cachedKeys: LlmKey[] = [];
let lastKeyLoad = 0;
const KEY_TTL = 60_000;

async function loadKeys(): Promise<LlmKey[]> {
  if (Date.now() - lastKeyLoad < KEY_TTL && cachedKeys.length > 0) {
    return cachedKeys;
  }
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(llmApiKeys)
      .where(eq(llmApiKeys.isActive, true))
      .orderBy(asc(llmApiKeys.priority));

    cachedKeys = rows.map((r) => ({
      id: r.id,
      label: r.label,
      provider: r.provider,
      endpoint: r.endpoint,
      apiKey: r.apiKey ?? "",
      model: r.model,
      priority: r.priority,
    }));
    lastKeyLoad = Date.now();
  } catch {
    // DB not ready — return empty
  }
  return cachedKeys;
}

function pickHealthy(keys: LlmKey[]): LlmKey | null {
  const now = Date.now();
  return (
    keys
      .filter((k) => {
        const t = unhealthyUntil.get(k.id);
        return !t || now > t;
      })
      .sort((a, b) => a.priority - b.priority)[0] ?? null
  );
}

async function callLlm(key: LlmKey, prompt: string): Promise<string> {
  if (key.provider === "ollama") {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key.apiKey) headers["Authorization"] = `Bearer ${key.apiKey}`;
    const res = await fetch(`${key.endpoint}/api/generate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: key.model, prompt, stream: false }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      const err: any = new Error(`LLM ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json() as { response?: string };
    return json.response ?? "";
  }

  // OpenAI-compatible (OpenAI, Anthropic with OpenAI-compat proxy)
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
      max_tokens: 150,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const err: any = new Error(`LLM ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

const VALID_ACTIONS = [
  "KEEP_OPEN", "MOVE_TO_BREAKEVEN", "TRAIL_SL", "PARTIAL_EXIT",
  "FULL_EXIT", "REDUCE_SIZE", "SCALE_IN", "EXTEND_TP", "TIGHTEN_TP",
];

export async function callPositionManagementLlm(
  prompt: string
): Promise<AiRecommendation | null> {
  const keys = await loadKeys();
  const key = pickHealthy(keys);
  if (!key) return null;

  const t0 = Date.now();
  try {
    const raw = await callLlm(key, prompt);
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as {
      action?: string;
      confidence?: number;
      reasoning?: string;
      newStopLoss?: number | null;
      newTakeProfit?: number | null;
      exitSizePct?: number | null;
    };

    const action = VALID_ACTIONS.includes(parsed.action ?? "")
      ? (parsed.action as PositionAction)
      : ("KEEP_OPEN" as PositionAction);

    return {
      action,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
      reasoning: String(parsed.reasoning ?? "").slice(0, 300),
      newStopLoss: parsed.newStopLoss ?? undefined,
      newTakeProfit: parsed.newTakeProfit ?? undefined,
      exitSizePct: parsed.exitSizePct ?? undefined,
      source: "AI",
      provider: key.provider,
      latencyMs: Date.now() - t0,
    };
  } catch (err: any) {
    const status = err?.status ?? 0;
    if (status === 429) unhealthyUntil.set(key.id, Date.now() + 5 * 60_000);
    else if (status === 503) unhealthyUntil.set(key.id, Date.now() + 2 * 60_000);
    else unhealthyUntil.set(key.id, Date.now() + 30_000);
    return null;
  }
}
