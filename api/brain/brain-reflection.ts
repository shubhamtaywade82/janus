import { getDb } from "../queries/connection";
import { brainReflections, brainStrategies } from "@db/schema";
import { memoryStore } from "./brain-memory";
import { callLLM } from "../services/ollama";
import { eq } from "drizzle-orm";

export async function reflectOnTrade(episodeId: number, pnl: number, actualAction: any) {
  const db = getDb();
  
  // 1. Fetch source episode
  const episode = await memoryStore.getEpisode(episodeId);
  if (!episode) {
    console.warn(`[Brain Reflection] No episode found for ID ${episodeId}`);
    return;
  }

  // 2. Formulate prompt for Brain 4 (Trade Reflector)
  const reflectionPrompt = `You are a quantitative trading supervisor. Analyze this recently closed trade and extract a concrete rule.
Symbol: ${episode.marketSymbol}
Outcome PnL: ${pnl} USDT
Planned action: ${JSON.stringify(episode.proposedAction)}
Executed action: ${JSON.stringify(actualAction)}
Your reasoning trace was:
${episode.reasoning}

Respond in exactly this JSON format (no markdown, no other text):
{
  "lesson": "<One sentence describing what went right or wrong>",
  "rule": "<One concrete conditional rule to prevent this loss or maximize this win, e.g.: If CVD is negative and spread > 0.01%, do not long.>"
}`;

  console.log(`[Brain Reflection] Prompting LLM for reflection on episode ${episodeId}...`);
  const rawReflection = await callLLM(reflectionPrompt);

  if (!rawReflection) {
    console.warn("[Brain Reflection] LLM returned empty response. Saving stub reflection.");
    await memoryStore.updateEpisodeOutcome(episodeId, { pnl, action: actualAction, reflection: "Reflection unavailable (LLM Timeout)" });
    return;
  }

  // 3. Parse and persist reflection in Postgres
  try {
    const cleanJsonText = rawReflection.match(/\{[\s\S]*\}/)?.[0] ?? rawReflection;
    const { lesson, rule } = JSON.parse(cleanJsonText);

    // Save reflection row
    await db.insert(brainReflections).values({
      episodeId,
      lesson,
      ruleCreated: rule
    });

    // Update parent episode with outcome PnL and reflection snippet
    await memoryStore.updateEpisodeOutcome(episodeId, { pnl, action: actualAction, reflection: lesson });
    console.log(`[Brain Reflection] Saved reflection rule: "${rule}"`);

    // 4. Optionally append candidate rule to the current active strategy prompt
    await appendRuleToActiveStrategy(rule);
  } catch (err: any) {
    console.error("[Brain Reflection] Failed to parse reflection response:", rawReflection);
    await memoryStore.updateEpisodeOutcome(episodeId, { pnl, action: actualAction, reflection: `Parse error: ${err.message}` });
  }
}

async function appendRuleToActiveStrategy(rule: string) {
  const db = getDb();
  const rows = await db.select().from(brainStrategies).where(eq(brainStrategies.active, true)).limit(1);
  const activeStrategy = rows[0];

  if (activeStrategy) {
    const updatedPrompt = `${activeStrategy.promptTemplate || ""}\n- Veto Constraint: ${rule}`;
    await db.update(brainStrategies)
      .set({ promptTemplate: updatedPrompt })
      .where(eq(brainStrategies.id, activeStrategy.id));
    console.log(`[Brain Reflection] Appended veto rule to active strategy '${activeStrategy.name}'`);
  }
}
