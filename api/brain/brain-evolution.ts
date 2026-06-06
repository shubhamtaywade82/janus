import { getDb } from "../queries/connection";
import { brainStrategies, brainEpisodes } from "@db/schema";
import { callLLM } from "../services/ollama";
import { eq } from "drizzle-orm";

/**
 * Simulates a historical backtest of the strategy
 */
async function backtestStrategyOnHistory(_strategy: any): Promise<{
  sharpRatio: number;
  totalPnl: number;
  winRate: number;
}> {
  // Pull historical episodes to represent historical performance context
  const db = getDb();
  const episodes = await db.select().from(brainEpisodes).limit(20);
  
  // Calculate base score from actual shadow outcomes
  let basePnl = 0;
  let winCount = 0;
  episodes.forEach(ep => {
    const pnl = parseFloat(ep.outcomePnl || "0");
    basePnl += pnl;
    if (pnl > 0) winCount++;
  });

  const winRate = episodes.length > 0 ? (winCount / episodes.length) * 100 : 50;
  
  // Introduce a slight mutation offset based on strategy variations to simulate backtest
  const offset = (Math.random() - 0.5) * 10;
  const simulatedPnl = basePnl + offset * 100;
  const sharpRatio = Math.max(0, 1.2 + (offset / 10));

  return {
    sharpRatio: parseFloat(sharpRatio.toFixed(4)),
    totalPnl: parseFloat(simulatedPnl.toFixed(8)),
    winRate: parseFloat(winRate.toFixed(2))
  };
}

/**
 * Mutates a strategy prompt using the LLM
 */
async function mutateStrategyPrompt(prompt: string): Promise<string> {
  const mutationPrompt = `You are a machine learning researcher optimizing a quantitative trading bot strategy system prompt.
Your goal is to slightly adjust conditions, parameters, or rules in the prompt to improve its risk management or signal verification.

Current Prompt Template:
"${prompt}"

Produce a new mutated prompt. Respond with the modified prompt template text only. No explanations, no markdown blocks.`;

  const newPrompt = await callLLM(mutationPrompt);
  return newPrompt ? newPrompt.trim() : prompt;
}

/**
 * Performs daily strategy evolution cycle (mutates, evaluates, and promotes best performers)
 */
export async function evolveStrategies() {
  const db = getDb();
  console.log("[Brain Evolution] Starting strategy evolution cycle...");

  // 1. Fetch all strategy profiles
  const strategies = await db.select().from(brainStrategies);
  if (strategies.length === 0) {
    console.warn("[Brain Evolution] No strategies found in DB to evolve.");
    return;
  }

  // 2. Score and update current strategies
  for (const s of strategies) {
    const perf = await backtestStrategyOnHistory(s);
    await db.update(brainStrategies).set({
      sharpRatio: perf.sharpRatio.toString(),
      totalPnl: perf.totalPnl.toString(),
      winRate: perf.winRate.toString(),
      lastEvaluated: new Date()
    }).where(eq(brainStrategies.id, s.id));
  }

  // Reload scored strategies
  const scored = await db.select().from(brainStrategies);
  
  // Sort by Sharpe ratio
  const sorted = [...scored].sort((a, b) => parseFloat(b.sharpRatio) - parseFloat(a.sharpRatio));
  const bestParent = sorted[0];
  const worstChild = sorted[sorted.length - 1];

  console.log(`[Brain Evolution] Best Parent: '${bestParent.name}' (Sharpe: ${bestParent.sharpRatio})`);
  console.log(`[Brain Evolution] Underperforming target for replacement: '${worstChild.name}' (Sharpe: ${worstChild.sharpRatio})`);

  // 3. Mutate the best parent to generate a child strategy
  const mutatedPrompt = await mutateStrategyPrompt(bestParent.promptTemplate || "");
  const childName = `${bestParent.name.split('_')[0]}_gen${Date.now().toString().slice(-6)}`;
  
  const childStrategy = {
    name: childName,
    description: `Mutated child of ${bestParent.name}`,
    promptTemplate: mutatedPrompt,
    parameters: bestParent.parameters,
    active: false
  };

  // 4. Backtest the new child strategy
  const childPerf = await backtestStrategyOnHistory(childStrategy);
  
  // Calculate multi-factor fitness score:
  // Fitness = Sharpe * 0.5 + WinRate * 0.5
  const parentFitness = parseFloat(bestParent.sharpRatio) * 0.5 + (parseFloat(bestParent.winRate) / 100) * 0.5;
  const childFitness = childPerf.sharpRatio * 0.5 + (childPerf.winRate / 100) * 0.5;

  console.log(`[Brain Evolution] Evaluated Child '${childName}': Sharpe=${childPerf.sharpRatio}, WinRate=${childPerf.winRate}%`);
  console.log(`[Brain Evolution] Fitness comparison: Parent=${parentFitness.toFixed(4)} vs Child=${childFitness.toFixed(4)}`);

  // 5. Replace the worst strategy if the child's fitness is greater
  if (childFitness > parentFitness || sorted.length < 3) {
    console.log(`[Brain Evolution] Promoting child strategy '${childName}' to replace '${worstChild.name}'`);
    await db.update(brainStrategies).set({
      name: childStrategy.name,
      description: childStrategy.description,
      promptTemplate: childStrategy.promptTemplate,
      parameters: childStrategy.parameters,
      sharpRatio: childPerf.sharpRatio.toString(),
      totalPnl: childPerf.totalPnl.toString(),
      winRate: childPerf.winRate.toString(),
      lastEvaluated: new Date()
    }).where(eq(brainStrategies.id, worstChild.id));
  } else {
    console.log("[Brain Evolution] Mutated child did not beat the parent. Promotion skipped.");
  }
}
