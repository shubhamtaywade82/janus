import { globalLlmAdvisor } from '../api/services/llm-advisor';
import 'dotenv/config';

async function main() {
  console.log("Initializing LLM Advisor...");
  await globalLlmAdvisor.init();

  console.log("\nKey pool status:");
  console.log(globalLlmAdvisor.getKeyStatus());

  const testCtx = {
    symbol: "BTCUSDT",
    direction: "long",
    compositeScore: 85,
    threshold: 70,
    regime: "intraday_trend",
    strategy: "intraday",
    currentPrice: 96500,
    drawdownPct: 0.5,
    tradeCount: 2,
    openPositions: 1,
    rsi: 62.5,
    ema20: 96200,
    ema50: 95800,
  };

  console.log("\nSending trial signal context to LLM Advisor...");
  const t0 = Date.now();
  try {
    const result = await globalLlmAdvisor.analyzeSignal(testCtx);
    const latency = Date.now() - t0;
    console.log("\n--- TEST SUCCESSFUL ---");
    console.log(`Latency: ${latency}ms`);
    console.log(`Key Used: ${result.keyUsed}`);
    console.log(`Decision: ${result.decision.toUpperCase()}`);
    console.log(`Confidence: ${result.confidence}%`);
    console.log(`Reasoning: "${result.reasoning}"`);
    console.log(`Size Multiplier: ${result.sizeMult}x`);
  } catch (err: any) {
    const latency = Date.now() - t0;
    console.log("\n--- TEST FAILED ---");
    console.log(`Latency: ${latency}ms`);
    console.log(`Error: ${err.message}`);
  }
}

main().catch(console.error);
