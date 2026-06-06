/**
 * Brain Reflection — Post-Trade LLM Analysis
 *
 * Triggered when a position closes. Uses LLM (qwen3:4b via Ollama) to:
 * 1. Analyze what went right or wrong
 * 2. Extract a concrete candidate rule
 * 3. Store reflection + candidate rule for nightly evolution review
 *
 * GATED: LLM reflection only runs when ≥ 20 brain episodes exist.
 * Candidate rules are NEVER auto-promoted — they stay in "candidate" status
 * until backtested by the nightly evolution job.
 */

import { getDb } from "../queries/connection";
import { brainReflections, brainCandidateRules, brainEpisodes } from "@db/schema";
import { memoryStore } from "./brain-memory";
import { callLLM } from "../services/ollama";
import { eq, count } from "drizzle-orm";

const MIN_EPISODES_FOR_REFLECTION = 20;

export async function reflectOnTrade(episodeId: number, pnl: number, actualAction: any) {
  const db = getDb();

  // 1. Gate: require minimum episode count before trusting LLM reflections
  const [episodeCountRow] = await db.select({ value: count() }).from(brainEpisodes);
  const totalEpisodes = episodeCountRow?.value ?? 0;
  if (totalEpisodes < MIN_EPISODES_FOR_REFLECTION) {
    console.log(`[Brain Reflection] Skipping LLM reflection — only ${totalEpisodes} episodes (need ${MIN_EPISODES_FOR_REFLECTION}). Saving stub.`);
    await memoryStore.updateEpisodeOutcome(episodeId, { pnl, action: actualAction, reflection: `Stub: ${totalEpisodes} episodes — LLM reflection gated` });
    return;
  }

  // 2. Fetch source episode
  const episode = await memoryStore.getEpisode(episodeId);
  if (!episode) {
    console.warn(`[Brain Reflection] No episode found for ID ${episodeId}`);
    return;
  }

  // 3. Formulate prompt for Brain 4 (Trade Reflector)
  const reflectionPrompt = `You are a quantitative trading supervisor. Analyze this recently closed trade and extract a concrete rule.
Symbol: ${episode.marketSymbol}
Outcome PnL: ${pnl} USDT
Planned action: ${JSON.stringify(episode.proposedAction)}
Executed action: ${JSON.stringify(actualAction)}
Brain verdict: ${episode.brainVerdict || "unknown"}
Governor verdict: ${episode.governorVerdict || "unknown"}
Your reasoning trace was:
${episode.reasoning}

Respond in exactly this JSON format (no markdown, no other text):
{
  "lesson": "<One sentence describing what went right or wrong>",
  "rule": "<One concrete conditional rule to prevent this loss or maximize this win, e.g.: If CVD is negative and spread > 0.01%, do not long.>",
  "confidence": <0.0-1.0>
}`;

  console.log(`[Brain Reflection] Prompting LLM for reflection on episode ${episodeId}...`);
  const rawReflection = await callLLM(reflectionPrompt);

  if (!rawReflection) {
    console.warn("[Brain Reflection] LLM returned empty response. Saving stub reflection.");
    await memoryStore.updateEpisodeOutcome(episodeId, { pnl, action: actualAction, reflection: "Reflection unavailable (LLM Timeout)" });
    return;
  }

  // 4. Parse and persist reflection in Postgres
  try {
    const cleanJsonText = rawReflection.match(/\{[\s\S]*\}/)?.[0] ?? rawReflection;
    const { lesson, rule, confidence } = JSON.parse(cleanJsonText);

    // Save reflection row
    await db.insert(brainReflections).values({
      episodeId,
      lesson,
      ruleCreated: rule
    });

    // Update parent episode with outcome PnL and reflection snippet
    await memoryStore.updateEpisodeOutcome(episodeId, { pnl, action: actualAction, reflection: lesson });
    console.log(`[Brain Reflection] Saved reflection for episode ${episodeId}: "${lesson}"`);

    // 5. Save as candidate rule — NEVER auto-promote to active strategy
    await db.insert(brainCandidateRules).values({
      ruleText: rule,
      sourceEpisodeId: episodeId,
      occurrences: 1,
      backtestScore: "0.0000",
      status: "candidate",
    });
    console.log(`[Brain Reflection] Saved candidate rule (status=candidate): "${rule}"`);

  } catch (err: any) {
    console.error("[Brain Reflection] Failed to parse reflection response:", rawReflection);
    await memoryStore.updateEpisodeOutcome(episodeId, { pnl, action: actualAction, reflection: `Parse error: ${err.message}` });
  }
}
