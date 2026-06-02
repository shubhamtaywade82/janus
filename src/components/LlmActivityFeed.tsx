import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { Brain, Zap, XCircle, MinusCircle } from "lucide-react";

interface LlmEntry {
  symbol: string;
  decision: "execute" | "skip" | "reduce_size";
  confidence: number;
  reasoning: string;
  keyUsed: string;
  latencyMs?: number;
  ts: number;
}

const DECISION_CFG = {
  execute:      { label: "EXECUTE",  color: "text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/30", icon: <Zap size={9} /> },
  skip:         { label: "SKIP",     color: "text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/30", icon: <XCircle size={9} /> },
  reduce_size:  { label: "REDUCE",   color: "text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/30", icon: <MinusCircle size={9} /> },
};

export function LlmActivityFeed() {
  const [entries, setEntries] = useState<LlmEntry[]>([]);

  // Load recent from DB on mount
  const { data: logs } = trpc.llm.activityLog.useQuery({ limit: 20 }, {
    staleTime: 30_000,
  });

  // Subscribe to live decisions from auto-executor
  trpc.autoExecutor.activityStream.useSubscription(undefined, {
    onData: (payload: unknown) => {
      const d = payload as {
        symbol: string;
        action: string;
        llmDecision?: { decision: string; confidence: number; reasoning: string; keyUsed: string };
        ts: number;
      };
      if (!d.llmDecision) return;
      const entry: LlmEntry = {
        symbol: d.symbol,
        decision: d.llmDecision.decision as LlmEntry["decision"],
        confidence: d.llmDecision.confidence,
        reasoning: d.llmDecision.reasoning,
        keyUsed: d.llmDecision.keyUsed,
        ts: d.ts,
      };
      setEntries((prev) => [entry, ...prev].slice(0, 30));
    },
  });

  const allEntries: LlmEntry[] = [
    ...entries,
    ...(logs?.map((log) => {
      const meta = log.metadata as Record<string, unknown> | null;
      return {
        symbol: log.message?.split(":")?.[0] ?? "?",
        decision: (meta?.decision as LlmEntry["decision"]) ?? "execute",
        confidence: (meta?.confidence as number) ?? 0,
        reasoning: (meta?.reasoning as string) ?? "",
        keyUsed: (meta?.keyUsed as string) ?? "",
        latencyMs: (meta?.latencyMs as number) ?? undefined,
        ts: new Date(log.createdAt).getTime(),
      };
    }) ?? []),
  ]
    .filter((e, i, arr) => arr.findIndex((x) => x.ts === e.ts) === i)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 30);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#27272a]">
        <Brain size={12} className="text-[#a855f7]" />
        <span className="text-[10px] font-semibold text-[#f4f4f5]">LLM Advisor</span>
        <span className="text-[9px] text-[#52525b] ml-auto">{allEntries.length} decisions</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {allEntries.length === 0 && (
          <div className="flex items-center justify-center h-20 text-[10px] text-[#52525b]">
            No LLM decisions yet
          </div>
        )}
        {allEntries.map((entry, i) => {
          const cfg = DECISION_CFG[entry.decision] ?? DECISION_CFG.execute;
          return (
            <div key={`${entry.ts}-${i}`} className="px-3 py-1.5 border-b border-[#18181b] hover:bg-[#18181b] transition-colors">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[9px] font-semibold text-[#f4f4f5]">{entry.symbol}</span>
                <span className={cn("flex items-center gap-0.5 px-1 py-0.5 rounded border text-[8px] font-semibold", cfg.color)}>
                  {cfg.icon} {cfg.label}
                </span>
                <span className="text-[9px] text-[#52525b] tabular-nums ml-auto">
                  {entry.confidence}%
                </span>
              </div>
              <div className="text-[9px] text-[#71717a] leading-tight">{entry.reasoning}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[8px] text-[#3f3f46]">via {entry.keyUsed}</span>
                {entry.latencyMs && (
                  <span className="text-[8px] text-[#3f3f46]">{entry.latencyMs}ms</span>
                )}
                <span className="text-[8px] text-[#3f3f46] ml-auto">
                  {new Date(entry.ts).toLocaleTimeString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
