import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";

interface ExitSignalPayload {
  positionId: number;
  symbol: string;
  strategyType: string;
  currentPrice: number;
  decision: {
    shouldExit: boolean;
    unrealizedPnl: number;
    entryFee: number;
    exitFee: number;
    totalFees: number;
    feeAdjustedPnl: number;
    reason: string;
  };
}

interface Props {
  userId: number;
}

export function ExitSignalToast({ userId }: Props) {
  const closePosition = trpc.trading.closePosition.useMutation();
  const utils = trpc.useUtils();
  // Deduplicate: only fire one toast per positionId until dismissed
  const shownRef = useRef(new Set<number>());

  trpc.trading.exitSignalStream.useSubscription(
    { userId },
    {
      onData: (payload: unknown) => {
        const data = payload as ExitSignalPayload;
        if (!data?.decision?.shouldExit) return;
        if (shownRef.current.has(data.positionId)) return;
        shownRef.current.add(data.positionId);

        const { decision, symbol, strategyType, currentPrice, positionId } = data;

        toast.success(`Exit signal — ${symbol}`, {
          description: (
            <div className="text-xs space-y-1 mt-1">
              <div className="flex justify-between gap-4">
                <span className="text-zinc-400">Strategy</span>
                <span className="capitalize font-medium">{strategyType}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-400">Unrealized PnL</span>
                <span className="text-green-400 tabular-nums">
                  +{decision.unrealizedPnl.toFixed(6)} USDT
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-400">Total fees</span>
                <span className="text-red-400 tabular-nums">
                  -{decision.totalFees.toFixed(6)} USDT
                </span>
              </div>
              <div className="flex justify-between gap-4 border-t border-zinc-700 pt-1">
                <span className="text-zinc-400">Net after fees</span>
                <span className="text-green-300 font-semibold tabular-nums">
                  +{decision.feeAdjustedPnl.toFixed(6)} USDT
                </span>
              </div>
            </div>
          ) as unknown as string,
          action: {
            label: "Close position",
            onClick: () => {
              closePosition.mutate(
                {
                  id: positionId,
                  closePrice: String(currentPrice),
                  realizedPnl: String(decision.feeAdjustedPnl),
                },
                {
                  onSuccess: () => {
                    utils.trading.portfolio.invalidate();
                    shownRef.current.delete(positionId);
                    toast.success(`Position ${symbol} closed`);
                  },
                  onError: (err) => {
                    toast.error("Close failed", { description: err.message });
                  },
                }
              );
            },
          },
          duration: 30_000,
          onDismiss: () => shownRef.current.delete(data.positionId),
          onAutoClose: () => shownRef.current.delete(data.positionId),
        });
      },
      onError: (err) => {
        console.error("[ExitSignalToast] stream error:", err);
      },
    }
  );

  return null;
}
