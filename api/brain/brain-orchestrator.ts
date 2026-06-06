import { callLLM } from "../services/ollama";
import { toolRegistry } from "./tool-registry";
import { getDb } from "../queries/connection";
import { brainEpisodes } from "@db/schema";
import { brainDecisionSchema, BrainDecision } from "./schemas";

export class BrainOrchestrator {
  private shadowMode: boolean;

  constructor(shadowMode = true) {
    this.shadowMode = shadowMode;
  }

  /**
   * Run the ReAct loop on a market signal trigger
   */
  async decide(symbol: string, userId: number, signalDetails?: any): Promise<any> {
    const db = getDb();
    
    // 1. Observe: Build initial market and portfolio snapshots
    const marketSnapshot = toolRegistry.getMarketSnapshot(symbol);
    const portfolioSnapshot = await toolRegistry.getPortfolioSnapshot(userId);

    // Context preparation
    const currentContext = {
      timestamp: new Date().toISOString(),
      market: marketSnapshot,
      portfolio: portfolioSnapshot,
      signal: signalDetails || null,
    };

    // 2. Build the ReAct prompt
    const systemPrompt = `You are a quantitative trading brain. You must decide whether to LONG, SHORT, or HOLD based on current market dynamics and risk profiles.
You have access to these read-only tools (written as function call syntax):
- getMarketSnapshot(symbol)
- getPortfolioSnapshot()

You must respond in exactly this format:
Thought: <reasoning about current status>
Action: <tool_name>(<arguments>)
Observation: <result from tool>
... repeat until you have enough info, then:
Final Answer: PROPOSE_TRADE LONG|SHORT|HOLD <size_pct> <stop_loss_pct> <take_profit_pct> <rationale>

Ensure Final Answer matches this Zod validation constraints schema:
- size_pct: 0.1 to 5.0 (percent of portfolio balance)
- stop_loss_pct: 0.5 to 5.0
- take_profit_pct: 0.5 to 15.0
- rationale: A concise summary string.

If you decide not to trade, return:
Final Answer: PROPOSE_TRADE HOLD 0 0 0 "No clear setup"

Current Context:
${JSON.stringify(currentContext, null, 2)}
`;

    let conversationLog = `Prompt:\n${systemPrompt}\n\n`;
    let steps = 0;
    let finalAnswerText = "";
    let lastResponse = "";

    // 3. ReAct loop execution (limit to 3 iterations for latency control)
    while (steps < 3) {
      console.log(`[Brain Orchestrator] Running step ${steps + 1}...`);
      const response = await callLLM(systemPrompt + "\n" + lastResponse);
      
      if (!response) {
        console.warn("[Brain Orchestrator] LLM returned empty response or timed out.");
        finalAnswerText = 'PROPOSE_TRADE HOLD 0 0 0 "LLM Timeout"';
        break;
      }

      conversationLog += `Response Step ${steps + 1}:\n${response}\n\n`;
      console.log(`[Brain Orchestrator] LLM output:\n`, response);

      // Parse output
      const finalMatch = response.match(/Final Answer:\s*(PROPOSE_TRADE\s+.*)/i);
      if (finalMatch) {
        finalAnswerText = finalMatch[1];
        break;
      }

      const actionMatch = response.match(/Action:\s*(\w+)\((.*)\)/i);
      if (actionMatch) {
        const toolName = actionMatch[1];
        const arg = actionMatch[2].replace(/['"]/g, "").trim();
        let toolResult = "";

        if (toolName === "getMarketSnapshot") {
          const snap = toolRegistry.getMarketSnapshot(arg || symbol);
          toolResult = JSON.stringify(snap);
        } else if (toolName === "getPortfolioSnapshot") {
          const snap = await toolRegistry.getPortfolioSnapshot(userId);
          toolResult = JSON.stringify(snap);
        } else {
          toolResult = `Error: Unknown tool ${toolName}`;
        }

        console.log(`[Brain Orchestrator] Executed action: ${toolName}, result: ${toolResult}`);
        lastResponse += `\nThought: Executing tool ${toolName}\nAction: ${toolName}(${arg})\nObservation: ${toolResult}\n`;
      } else {
        // No parseable action and no final answer, force exit with HOLD
        finalAnswerText = 'PROPOSE_TRADE HOLD 0 0 0 "Parse failure"';
        break;
      }

      steps++;
    }

    if (!finalAnswerText) {
      finalAnswerText = 'PROPOSE_TRADE HOLD 0 0 0 "No decision reached"';
    }

    // 4. Parse the final answer into structured JSON schema
    let parsedDecision: BrainDecision;
    try {
      const parts = finalAnswerText.split(/\s+/);
      const side = parts[1]?.toLowerCase() as "long" | "short" | "hold";
      const sizePct = parseFloat(parts[2]) || 0;
      const stopLossPct = parseFloat(parts[3]) || 0;
      const takeProfitPct = parseFloat(parts[4]) || 0;
      const rationale = parts.slice(5).join(" ").replace(/['"]/g, "").trim();

      parsedDecision = {
        mode: side === "hold" ? "hold" : "enter",
        symbol: symbol,
        side: side === "hold" ? undefined : side,
        confidence: side === "hold" ? 0 : 0.8,
        rationale: rationale || "Autonomous proposal",
        sizePct: sizePct || undefined,
        stopLossPct: stopLossPct || undefined,
        takeProfitPct: takeProfitPct || undefined,
        timeInForce: "limit",
        riskNotes: [],
        evidence: {
          market: [JSON.stringify(marketSnapshot)],
          memory: [],
          signals: signalDetails ? [JSON.stringify(signalDetails)] : [],
        }
      };

      // Zod validation verification
      brainDecisionSchema.parse(parsedDecision);
    } catch (err: any) {
      console.warn("[Brain Orchestrator] Parse failed, falling back to HOLD.", err.message);
      parsedDecision = {
        mode: "hold",
        confidence: 0,
        rationale: `Parse/validation error: ${err.message}`,
        riskNotes: ["Invalid output structure"],
        evidence: { market: [], memory: [], signals: [] }
      };
    }

    // 5. Store the decision episode in the PostgreSQL database
    let insertedId = 0;
    try {
      const [result] = await db.insert(brainEpisodes).values({
        userId,
        triggerType: signalDetails ? "signal" : "manual",
        marketSymbol: symbol,
        observation: currentContext,
        reasoning: conversationLog,
        proposedAction: parsedDecision,
        governorJson: { shadowMode: this.shadowMode, approved: true },
        actualAction: this.shadowMode ? { status: "shadow_logged" } : undefined,
      }).returning({ id: brainEpisodes.id });

      insertedId = result.id;
      console.log(`[Brain Orchestrator] Saved episode ID: ${insertedId}`);
    } catch (dbErr: any) {
      console.error("[Brain Orchestrator] Database write error:", dbErr.message);
    }

    return {
      episodeId: insertedId,
      approved: true, // Auto-approved in shadow mode
      decision: parsedDecision,
      shadowMode: this.shadowMode
    };
  }
}
