import { useState, useMemo, useEffect, useRef } from "react";
import { trpc } from "@/providers/trpc";
import {
  Shield,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  DollarSign,
  Lock,
  Unlock,
  Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPrice, formatQty } from "@/utils/precision";

const RiskMetrics = () => {
  const [portfolio, setPortfolio] = useState<any>(null);

  const { data: usdtWallet } = trpc.trading.futuresWallet.useQuery({
    userId: 1,
    marginCurrency: "USDT",
  });
  const { data: inrWallet } = trpc.trading.futuresWallet.useQuery({
    userId: 1,
    marginCurrency: "INR",
  });
  const { data: crossMargin } = trpc.trading.crossMarginDetails.useQuery({
    userId: 1,
  });

  const portfolioCallbackRef = useRef<(data: any) => void>(() => {});
  useEffect(() => {
    portfolioCallbackRef.current = (data: any) => {
      setPortfolio(data);
    };
  }, []);

  const portfolioStreamOpts = useRef({
    onData: (data: any) => portfolioCallbackRef.current(data),
    onError: (err: any) => {
      console.error("[risk-metrics] Portfolio stream error:", err);
    },
  });

  trpc.trading.portfolioStream.useSubscription(
    { userId: 1 },
    portfolioStreamOpts.current
  );

  const positions = portfolio?.positions || [];

  const marginRatio = parseFloat(
    crossMargin?.margin_ratio_cross || crossMargin?.marginRatioCross || "0"
  );
  const marginRatioPct = marginRatio * 100;

  const marginRatioColor =
    marginRatioPct >= 100
      ? "text-j-down"
      : marginRatioPct > 80
      ? "text-j-down"
      : marginRatioPct > 50
      ? "text-[#f59e0b]"
      : "text-j-up";

  const marginRatioBg =
    marginRatioPct >= 100
      ? "bg-j-down/10 border-j-down/30"
      : marginRatioPct > 80
      ? "bg-j-down/10 border-j-down/30"
      : marginRatioPct > 50
      ? "bg-[#f59e0b]/10 border-[#f59e0b]/30"
      : "bg-j-up/10 border-j-up/30";

  const hasInrPositions = useMemo(() => {
    return positions.some((p: any) => p.marginCurrency === "INR");
  }, [positions]);

  const conversionRate = useMemo(() => {
    if (crossMargin?.conversion_rate) {
      return parseFloat(crossMargin.conversion_rate);
    }
    if (crossMargin?.usdt_inr_conversion_rate) {
      return parseFloat(crossMargin.usdt_inr_conversion_rate);
    }
    if (crossMargin?.conversionRate) {
      return parseFloat(crossMargin.conversionRate);
    }
    const inrPos = positions.find(
      (p: any) => p.marginCurrency === "INR" && p.settlementCurrencyConversionPrice
    );
    if (inrPos) {
      return parseFloat(inrPos.settlementCurrencyConversionPrice);
    }
    return null;
  }, [crossMargin, positions]);

  const calcLiqDistance = (pos: any) => {
    const currentPrice = parseFloat(pos.currentPrice || "0");
    const liqPrice = parseFloat(pos.liquidationPrice || "0");
    if (!currentPrice || !liqPrice) return null;
    if (pos.side === "long") {
      return ((currentPrice - liqPrice) / currentPrice) * 100;
    }
    return ((liqPrice - currentPrice) / currentPrice) * 100;
  };

  const liqDistanceColor = (dist: number | null) => {
    if (dist === null) return "text-[#71717a]";
    if (dist < 5) return "text-j-down";
    if (dist < 15) return "text-[#f59e0b]";
    return "text-j-up";
  };

  return (
    <div className="flex flex-col h-full p-4 gap-4 bg-[#09090b]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield size={18} className="text-[#3b82f6]" />
          <div>
            <h2 className="text-sm font-semibold text-[#f4f4f5]">Risk Metrics</h2>
            <p className="text-[10px] text-[#71717a]">CoinDCX futures risk dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-j-up" />
          <span className="text-[10px] text-j-up">Live</span>
        </div>
      </div>

      {/* Wallet Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        {/* USDT Wallet */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign size={14} className="text-j-up" />
            <span className="text-[10px] text-[#71717a]">USDT Wallet</span>
            <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-j-up/10 text-j-up font-medium">
              USDT
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-[#71717a]">Balance</span>
              <span className="text-[#f4f4f5] tabular-nums">
                {parseFloat(usdtWallet?.balance || "0").toFixed(4)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="flex items-center gap-1 text-[#71717a]">
                <Lock size={10} />
                Locked
              </span>
              <span className="text-[#f4f4f5] tabular-nums">
                {parseFloat(usdtWallet?.lockedBalance || "0").toFixed(4)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#71717a]">Available</span>
              <span className="text-[#f4f4f5] tabular-nums">
                {(
                  parseFloat(usdtWallet?.balance || "0") -
                  parseFloat(usdtWallet?.lockedBalance || "0")
                ).toFixed(4)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#71717a]">Equity</span>
              <span className="text-[#f4f4f5] tabular-nums font-medium">
                {parseFloat(usdtWallet?.totalAccountEquity || "0").toFixed(4)}
              </span>
            </div>
          </div>
        </div>

        {/* INR Wallet */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wallet size={14} className="text-[#f97316]" />
            <span className="text-[10px] text-[#71717a]">INR Wallet</span>
            <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-[#f97316]/10 text-[#f97316] font-medium">
              INR
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-[#71717a]">Balance</span>
              <span className="text-[#f4f4f5] tabular-nums">
                {parseFloat(inrWallet?.balance || "0").toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="flex items-center gap-1 text-[#71717a]">
                <Lock size={10} />
                Locked
              </span>
              <span className="text-[#f4f4f5] tabular-nums">
                {parseFloat(inrWallet?.lockedBalance || "0").toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#71717a]">Available</span>
              <span className="text-[#f4f4f5] tabular-nums">
                {(
                  parseFloat(inrWallet?.balance || "0") -
                  parseFloat(inrWallet?.lockedBalance || "0")
                ).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#71717a]">Equity</span>
              <span className="text-[#f4f4f5] tabular-nums font-medium">
                {parseFloat(inrWallet?.totalAccountEquity || "0").toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Cross Margin Health */}
        <div className={cn("bg-[#18181b] border rounded-lg p-4", marginRatioBg)}>
          <div className="flex items-center gap-2 mb-3">
            <Gauge size={14} className={marginRatioColor} />
            <span className="text-[10px] text-[#71717a]">Cross Margin Health</span>
            {marginRatioPct >= 100 && (
              <AlertTriangle size={12} className="text-j-down ml-auto" />
            )}
          </div>
          <div className={cn("text-2xl font-bold tabular-nums", marginRatioColor)}>
            {marginRatioPct.toFixed(2)}%
          </div>
          <div className="mt-2 text-[10px] text-[#71717a]">
            {marginRatioPct >= 100
              ? "Critical - Positions at risk of liquidation"
              : marginRatioPct > 80
              ? "High risk - Reduce exposure"
              : marginRatioPct > 50
              ? "Moderate risk - Monitor closely"
              : "Healthy margin level"}
          </div>
        </div>

        {/* Withdrawable Balance */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Unlock size={14} className="text-[#3b82f6]" />
            <span className="text-[10px] text-[#71717a]">Withdrawable Balance</span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-[#71717a]">USDT</span>
              <span className="text-[#f4f4f5] tabular-nums font-medium">
                {parseFloat(usdtWallet?.withdrawableBalance || "0").toFixed(4)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-[#71717a]">INR</span>
              <span className="text-[#f4f4f5] tabular-nums font-medium">
                {parseFloat(inrWallet?.withdrawableBalance || "0").toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* INR Conversion Panel */}
      {hasInrPositions && (
        <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-[#f97316]" />
            <span className="text-xs font-semibold text-[#f4f4f5]">INR Conversion</span>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-3">
            <div className="bg-[#09090b] border border-[#27272a] rounded p-3">
              <div className="text-[10px] text-[#71717a] mb-1">USDT/INR Rate</div>
              <div className="text-sm font-semibold text-[#f4f4f5] tabular-nums">
                {conversionRate ? `₹${conversionRate.toFixed(2)}` : "—"}
              </div>
            </div>
            {crossMargin?.conversion_rate && (
              <div className="bg-[#09090b] border border-[#27272a] rounded p-3">
                <div className="text-[10px] text-[#71717a] mb-1">Cross Margin Rate</div>
                <div className="text-sm font-semibold text-[#f4f4f5] tabular-nums">
                  ₹{parseFloat(crossMargin.conversion_rate).toFixed(2)}
                </div>
              </div>
            )}
          </div>
          {positions.filter((p: any) => p.marginCurrency === "INR").length > 0 && (
            <div className="overflow-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#27272a]">
                    <th className="px-2 py-1 text-left text-[10px] text-[#71717a] font-medium">
                      Symbol
                    </th>
                    <th className="px-2 py-1 text-left text-[10px] text-[#71717a] font-medium">
                      Position Rate
                    </th>
                    <th className="px-2 py-1 text-left text-[10px] text-[#71717a] font-medium">
                      Current Rate
                    </th>
                    <th className="px-2 py-1 text-left text-[10px] text-[#71717a] font-medium">
                      Diff
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {positions
                    .filter((p: any) => p.marginCurrency === "INR")
                    .map((pos: any) => {
                      const posRate = parseFloat(
                        pos.settlementCurrencyConversionPrice || "0"
                      );
                      const diff =
                        conversionRate && posRate
                          ? ((conversionRate - posRate) / posRate) * 100
                          : null;
                      return (
                        <tr key={pos.id} className="border-b border-[#27272a]/50">
                          <td className="px-2 py-1 text-[10px] text-[#f4f4f5]">
                            {pos.symbol}
                          </td>
                          <td className="px-2 py-1 text-[10px] text-[#f4f4f5] tabular-nums">
                            {posRate ? `₹${posRate.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-2 py-1 text-[10px] text-[#f4f4f5] tabular-nums">
                            {conversionRate ? `₹${conversionRate.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-2 py-1 text-[10px] tabular-nums">
                            {diff !== null ? (
                              <span
                                className={cn(
                                  diff >= 0 ? "text-j-up" : "text-j-down"
                                )}
                              >
                                {diff >= 0 ? (
                                  <ArrowUpRight size={10} className="inline" />
                                ) : (
                                  <ArrowDownRight size={10} className="inline" />
                                )}
                                {Math.abs(diff).toFixed(2)}%
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Position Risk Table */}
      <div className="flex-1 bg-[#18181b] border border-[#27272a] rounded-lg overflow-hidden flex flex-col">
        <div className="px-4 py-2 border-b border-[#27272a] flex items-center justify-between">
          <span className="text-xs font-semibold text-[#f4f4f5]">Position Risk</span>
          <span className="text-[10px] text-[#71717a]">{positions.length} positions</span>
        </div>
        <div className="flex-1 overflow-auto scrollbar-thin">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#27272a]">
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">
                  Symbol
                </th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">
                  Side
                </th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">
                  Mode
                </th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">
                  Currency
                </th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">
                  Size
                </th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">
                  Lev
                </th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">
                  Locked Margin
                </th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">
                  Maint. Margin
                </th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">
                  Liq Price
                </th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">
                  Liq Distance %
                </th>
                <th className="px-3 py-2 text-left text-[10px] text-[#71717a] font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos: any) => {
                const liqDist = calcLiqDistance(pos);
                return (
                  <tr
                    key={pos.id}
                    className="border-b border-[#27272a] hover:bg-[#18181b] transition-colors"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            pos.side === "long" ? "bg-j-up" : "bg-j-down"
                          )}
                        />
                        <span className="text-xs font-medium text-[#f4f4f5]">
                          {pos.symbol}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "text-xs px-1.5 py-0.5 rounded",
                          pos.side === "long"
                            ? "bg-j-up/10 text-j-up"
                            : "bg-j-down/10 text-j-down"
                        )}
                      >
                        {pos.side === "long" ? (
                          <TrendingUp size={10} className="inline mr-1" />
                        ) : (
                          <TrendingDown size={10} className="inline mr-1" />
                        )}
                        {pos.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium",
                          pos.marginMode === "cross"
                            ? "bg-[#3b82f6]/10 text-[#3b82f6]"
                            : "bg-[#8b5cf6]/10 text-[#8b5cf6]"
                        )}
                      >
                        {pos.marginMode === "cross" ? "CROSS" : "ISO"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium",
                          pos.marginCurrency === "INR"
                            ? "bg-[#f97316]/10 text-[#f97316]"
                            : "bg-j-up/10 text-j-up"
                        )}
                      >
                        {pos.marginCurrency || "USDT"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[#f4f4f5] tabular-nums">
                      {formatQty(pos.size, pos.symbol, pos.targetPrecision)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#71717a] tabular-nums">
                      {pos.leverage}x
                    </td>
                    <td className="px-3 py-2 text-xs text-[#f4f4f5] tabular-nums">
                      {parseFloat(pos.lockedMargin || "0").toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#f4f4f5] tabular-nums">
                      {parseFloat(pos.maintenanceMargin || "0").toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#f4f4f5] tabular-nums">
                      {pos.liquidationPrice
                        ? formatPrice(pos.liquidationPrice, pos.symbol, pos.basePrecision)
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "text-xs tabular-nums font-medium",
                          liqDistanceColor(liqDist)
                        )}
                      >
                        {liqDist !== null ? `${liqDist.toFixed(2)}%` : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded",
                          pos.status === "open"
                            ? "bg-j-up/10 text-j-up"
                            : pos.status === "closed"
                            ? "bg-[#27272a] text-[#71717a]"
                            : "bg-j-down/10 text-j-down"
                        )}
                      >
                        {pos.status?.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {positions.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-xs text-[#71717a]">
                    <Activity size={20} className="mx-auto mb-2 opacity-30" />
                    No open positions found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RiskMetrics;
