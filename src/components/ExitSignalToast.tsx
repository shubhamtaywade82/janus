import { useRef, useEffect } from "react";
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

export function ExitSignalToast({}: Props) {
  const closePosition = trpc.trading.closePosition.useMutation();
  const utils = trpc.useUtils();
  // Deduplicate: only fire one toast per positionId until dismissed
  const shownRef = useRef(new Set<number>());


  const onDataRef = useRef<(payload: unknown) => void>(() => {});
  useEffect(() => {
    onDataRef.current = (payload: unknown) => {
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
            <div className="flex justify-between gap-4 border-t border-zinc-750 pt-1">
              <span className="text-zinc-400">Reason</span>
              <span className="text-zinc-300 text-right max-w-[200px] break-words">
                {decision.reason}
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
                  utils.trading.positions.invalidate();
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
    };
  }, [closePosition, utils]);

  const streamOpts = useRef({
    onData: (payload: unknown) => onDataRef.current(payload),
    onError: (err: unknown) => {
      console.error("[ExitSignalToast] stream error:", err);
    },
  });

  trpc.trading.exitSignalStream.useSubscription(
    undefined,
    streamOpts.current
  );

  const prevPositionsRef = useRef<any[]>([]);

  trpc.trading.portfolioStream.useSubscription(
    undefined,
    {
      onData: async (data: any) => {
        const openPositions = data?.positions || [];
        const prevPositions = prevPositionsRef.current;

        if (prevPositions.length > 0) {
          // 1. Detect newly opened positions
          for (const pos of openPositions) {
            if (!prevPositions.some((p: any) => p.id === pos.id)) {
              const cleanSymbol = pos.symbol.replace("B-", "").replace("_", "");
              toast.success(`Position Opened: ${cleanSymbol} ${pos.side.toUpperCase()}`, {
                description: (
                  <div className="text-xs space-y-1 mt-1">
                    <div>Price: {parseFloat(pos.entryPrice).toFixed(4)} | Size: {parseFloat(pos.size).toFixed(4)}</div>
                    {pos.entryReason && (
                      <div className="border-t border-zinc-850 pt-1 text-zinc-400">
                        <span className="font-semibold text-zinc-300">Reason:</span> {pos.entryReason}
                      </div>
                    )}
                  </div>
                ) as unknown as string,
                duration: 10000,
              });
            }
          }

          // 2. Detect closed positions
          for (const prevPos of prevPositions) {
            if (!openPositions.some((p: any) => p.id === prevPos.id)) {
              try {
                const closedPos = await utils.client.trading.position.query({ id: prevPos.id });
                if (closedPos && closedPos.status === "closed") {
                  const cleanSymbol = closedPos.symbol.replace("B-", "").replace("_", "");
                  toast.error(`Position Closed: ${cleanSymbol} ${closedPos.side.toUpperCase()}`, {
                    description: (
                      <div className="text-xs space-y-1 mt-1">
                        <div>Exit Price: {parseFloat(closedPos.currentPrice).toFixed(4)} | PnL: {parseFloat(closedPos.realizedPnl || "0").toFixed(4)} USDT</div>
                        {closedPos.exitReason && (
                          <div className="border-t border-zinc-850 pt-1 text-zinc-400 font-medium">
                            <span className="font-semibold text-zinc-300">Reason:</span> {closedPos.exitReason}
                          </div>
                        )}
                      </div>
                    ) as unknown as string,
                    duration: 10000,
                  });
                }
              } catch (err) {
                console.error("[Toast] Failed to fetch closed position details:", err);
              }
            }
          }
        }

        prevPositionsRef.current = openPositions;
      },
      onError: (err) => {
        console.error("[Toast] portfolio stream error:", err);
      },
    }
  );

  return null;
}
