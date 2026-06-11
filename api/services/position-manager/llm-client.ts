// ─── Position Manager LLM Client ────────────────────────────────────────────
//
// PAPER positions  → local Ollama (env: OLLAMA_ENDPOINT, OLLAMA_MODEL)
//                    No API key. Fast. Private.
//
// LIVE positions   → Ollama.com cloud (3-key rotation, next key on failure)
//
//   Option A — DB keys (preferred):
//     Add 3 entries to llm_api_keys with labels: pm-live-1, pm-live-2, pm-live-3
//     Set endpoint to the Ollama.com cloud base URL and provider to "ollama"
//
//   Option B — env vars (fallback when no DB keys with pm-live-* label):
//     PM_OLLAMA_CLOUD_ENDPOINT=https://ollama.com   (Ollama.com base URL)
//     PM_OLLAMA_CLOUD_MODEL=llama3.2
//     PM_OLLAMA_CLOUD_KEY_1=<key>
//     PM_OLLAMA_CLOUD_KEY_2=<key>
//     PM_OLLAMA_CLOUD_KEY_3=<key>
//
// Existing env vars reused for local:
//     OLLAMA_ENDPOINT=http://localhost:11434
//     OLLAMA_MODEL=llama3.2

import { getDb } from "../../queries/connection";
import { llmApiKeys } from "@db/schema";
import { eq, asc } from "drizzle-orm";
import type { AiRecommendation } from "./types";
import { PositionAction } from "./types";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LlmKey {
  id: number;
  label: string;
  endpoint: string;
  apiKey: string;
  model: string;
  priority: number;
}

type KeyScope = "paper" | "live";

// ─── Backoff state ───────────────────────────────────────────────────────────

const unhealthyUntil = new Map<number, number>();

const envKeysSeenInvalid = new Set<string>();

function isHealthy(id: number): boolean {
  const until = unhealthyUntil.get(id);
  return !until || Date.now() > until;
}

function markUnhealthy(id: number, status: number): void {
  const durationMs =
    status === 429 ? 5 * 60_000 :   // rate-limited → 5 min
    status === 503 ? 2 * 60_000 :   // overloaded  → 2 min
    status === 401 ? 60_000 :       // auth error  → 1 min
    30_000;                          // other error → 30 s
  unhealthyUntil.set(id, Date.now() + durationMs);
}

// ─── Key loading ─────────────────────────────────────────────────────────────

let cachedLiveKeys: LlmKey[] = [];
let lastLiveLoad = 0;
const KEY_TTL_MS = 60_000;

async function loadLiveKeysFromDb(): Promise<LlmKey[]> {
  if (Date.now() - lastLiveLoad < KEY_TTL_MS && cachedLiveKeys.length > 0) {
    return cachedLiveKeys;
  }
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(llmApiKeys)
      .where(eq(llmApiKeys.isActive, true))
      .orderBy(asc(llmApiKeys.priority));

    // Convention: any key whose label starts with "pm-live-" is a live cloud key
    const pmLiveRows = rows.filter((r) => r.label.startsWith("pm-live-"));

    cachedLiveKeys = pmLiveRows.map((r) => ({
      id: r.id,
      label: r.label,
      endpoint: r.endpoint,
      apiKey: r.apiKey ?? "",
      model: r.model,
      priority: r.priority,
    }));
    lastLiveLoad = Date.now();
  } catch {
    // DB not ready — return cached or empty
  }
  return cachedLiveKeys;
}

function envLiveKeys(): LlmKey[] {
  const endpoint =
    process.env.PM_OLLAMA_CLOUD_ENDPOINT ?? "https://ollama.com";
  const model =
    process.env.PM_OLLAMA_CLOUD_MODEL ?? "gpt-oss:120b";

  const keys: LlmKey[] = [];
  for (let i = 1; i <= 3; i++) {
    const apiKey = process.env[`PM_OLLAMA_CLOUD_KEY_${i}`];
    if (apiKey) {
      if (
        /^(YOUR_KEY|test|placeholder|null|undefined|)$/.test(apiKey.trim()) &&
        !envKeysSeenInvalid.has(`pm-live-env-${i}`)
      ) {
        envKeysSeenInvalid.add(`pm-live-env-${i}`);
        console.warn(
          `[pm-llm] PM_OLLAMA_CLOUD_KEY_${i} appears to be a placeholder. Set valid Ollama.com cloud keys or unset these vars to silence LLM calls.`
        );
      }
      keys.push({
        id: -(100 + i), // negative = env-seeded, no DB row
        label: `pm-live-env-${i}`,
        endpoint,
        apiKey,
        model,
        priority: i,
      });
    }
  }
  return keys;
}

function localPaperKey(): LlmKey {
  return {
    id: -1,
    label: "local-paper",
    endpoint:
      process.env.OLLAMA_ENDPOINT ??
      process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    apiKey: "",  // local Ollama needs no key
    model: process.env.OLLAMA_MODEL ?? "llama3.2",
    priority: 1,
  };
}

async function resolveKeys(scope: KeyScope): Promise<LlmKey[]> {
  if (scope === "paper") {
    return [localPaperKey()];
  }

  // Live: prefer DB keys, fall back to env vars
  const dbKeys = await loadLiveKeysFromDb();
  if (dbKeys.length > 0) return dbKeys;
  return envLiveKeys();
}

// ─── HTTP dispatch ────────────────────────────────────────────────────────────
// All paths use Ollama-compatible /api/generate.
// Ollama.com cloud uses the same format as local Ollama but requires Bearer auth.

async function callOllama(key: LlmKey, prompt: string): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key.apiKey) headers["Authorization"] = `Bearer ${key.apiKey}`;

  const res = await fetch(`${key.endpoint}/api/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: key.model,
      prompt,
      stream: false,
      think: false,                      // qwen3.x are reasoning models — without this the
                                          // output lands in `thinking` and `response` is empty
      keep_alive: "30m",
      options: { num_predict: 512 },
    }),
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

// ─── Key rotation with fallback ───────────────────────────────────────────────

async function callWithRotation(
  keys: LlmKey[],
  prompt: string
): Promise<{ raw: string; key: LlmKey } | null> {
  const ordered = keys
    .filter((k) => isHealthy(k.id))
    .sort((a, b) => a.priority - b.priority);

  for (const key of ordered) {
    try {
      const raw = await callOllama(key, prompt);
      return { raw, key };
    } catch (err: any) {
      markUnhealthy(key.id, err?.status ?? 0);
      console.warn(
        `[pm-llm] Key "${key.label}" failed (${err?.status ?? err?.message}) — trying next`
      );
    }
  }
  return null;
}

// ─── Response parsing ────────────────────────────────────────────────────────

const VALID_ACTIONS: PositionAction[] = Object.values(PositionAction);

function parseResponse(
  raw: string,
  key: LlmKey,
  latencyMs: number
): AiRecommendation | null {
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) return null;

  let parsed: {
    action?: string;
    confidence?: number;
    reasoning?: string;
    newStopLoss?: number | null;
    newTakeProfit?: number | null;
    exitSizePct?: number | null;
  };

  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  const action: PositionAction =
    VALID_ACTIONS.includes(parsed.action as PositionAction)
      ? (parsed.action as PositionAction)
      : PositionAction.KEEP_OPEN;

  return {
    action,
    confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
    reasoning: String(parsed.reasoning ?? "").slice(0, 300),
    newStopLoss: parsed.newStopLoss ?? undefined,
    newTakeProfit: parsed.newTakeProfit ?? undefined,
    exitSizePct: parsed.exitSizePct ?? undefined,
    source: "AI",
    provider: key.label,
    latencyMs,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call the appropriate LLM for position management.
 * @param prompt   - formatted assessment prompt
 * @param isPaper  - true = use local Ollama; false = use Ollama.com cloud (3-key rotation)
 */
const exhaustedWarningIssued = new Set<string>();

export async function callPositionManagementLlm(
  prompt: string,
  isPaper: boolean
): Promise<AiRecommendation | null> {
  const scope: KeyScope = isPaper ? "paper" : "live";
  const keys = await resolveKeys(scope);

  if (keys.length === 0) {
    if (!exhaustedWarningIssued.has(scope)) {
      exhaustedWarningIssued.add(scope);
      console.warn(`[pm-llm] No ${scope} keys available — falling back to code logic`);
    }
    return null;
  }

  const t0 = Date.now();
  const result = await callWithRotation(keys, prompt);
  if (!result) {
    if (!exhaustedWarningIssued.has(scope)) {
      exhaustedWarningIssued.add(scope);
      console.warn(`[pm-llm] All ${scope} keys exhausted — falling back to code logic`);
    }
    return null;
  }

  return parseResponse(result.raw, result.key, Date.now() - t0);
}

/** Health snapshot — useful for the router status endpoint */
export function getLlmKeyHealth(): {
  scope: string;
  label: string;
  healthy: boolean;
  unhealthyUntilMs: number | null;
}[] {
  const paper = localPaperKey();
  const live = [...cachedLiveKeys, ...envLiveKeys()];
  // Deduplicate live by label
  const seen = new Set<string>();
  const deduped = live.filter((k) => {
    if (seen.has(k.label)) return false;
    seen.add(k.label);
    return true;
  });

  const format = (k: LlmKey, scope: string) => ({
    scope,
    label: k.label,
    healthy: isHealthy(k.id),
    unhealthyUntilMs: unhealthyUntil.get(k.id) ?? null,
  });

  return [
    format(paper, "paper"),
    ...deduped.map((k) => format(k, "live")),
  ];
}
