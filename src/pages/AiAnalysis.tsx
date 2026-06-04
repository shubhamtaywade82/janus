import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart2,
  Layers,
  Percent,
  RefreshCw,
  Sliders,
  DollarSign,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT"];

export default function AiAnalysis() {
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");

  const { data: analysis, isLoading, isRefetching, refetch } = trpc.signal.comprehensiveAnalysis.useQuery(
    { symbol: selectedSymbol },
    { staleTime: 10000 }
  );

  const handleRefresh = () => {
    refetch();
  };

  const overallBias = analysis?.market_state?.regime || "NEUTRAL";
  const overallConfidence = analysis?.market_state?.confidence || 50;

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-auto scrollbar-thin">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-j-up-bright animate-pulse" />
          <div>
            <h1 className="text-base font-bold text-[#f4f4f5]">AI & Smart Money Concepts (SMC) Analysis</h1>
            <p className="text-[10px] text-[#71717a]">
              Institutional-grade multi-timeframe structural and orderflow analysis
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-xs text-[#f4f4f5] font-semibold focus:outline-none focus:border-j-up-bright/50 cursor-pointer"
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <button
            onClick={handleRefresh}
            disabled={isLoading || isRefetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#18181b] hover:bg-[#27272a] text-[#f4f4f5] text-xs transition-colors disabled:opacity-50 border border-[#27272a] font-semibold"
          >
            <RefreshCw size={11} className={cn((isLoading || isRefetching) && "animate-spin")} />
            Recalculate
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2.5 py-32 text-zinc-400">
          <RefreshCw size={24} className="animate-spin text-j-up-bright" />
          <div className="text-xs font-semibold">Running deep analysis algorithms...</div>
          <div className="text-[10px] text-zinc-600 max-w-[280px] text-center leading-normal">
            Evaluating multi-timeframe market structure, order blocks, FVG, liquidations, CVD divergences, and order book imbalance.
          </div>
        </div>
      ) : !analysis ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-zinc-400">
          <AlertTriangle size={32} className="text-[#f59e0b] mb-2 opacity-50" />
          <div className="text-sm font-semibold">No analysis data available.</div>
          <p className="text-[10px] text-zinc-500 mt-1">Please select another symbol or try again.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Column 1: AI Summary & Trade Setup */}
          <div className="flex flex-col gap-4">
            {/* Market Regime Badge & Confidence */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold">Overall Bias</span>
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-bold">Confidence</span>
              </div>
              <div className="flex justify-between items-end">
                <div className="flex items-center gap-2">
                  {overallBias === "BULLISH" ? (
                    <TrendingUp className="w-6 h-6 text-j-up-bright" />
                  ) : overallBias === "BEARISH" ? (
                    <TrendingDown className="w-6 h-6 text-j-down-bright" />
                  ) : (
                    <Sliders className="w-6 h-6 text-yellow-500" />
                  )}
                  <span
                    className={cn(
                      "text-xl font-black tracking-wide",
                      overallBias === "BULLISH"
                        ? "text-j-up-bright"
                        : overallBias === "BEARISH"
                        ? "text-j-down-bright"
                        : "text-yellow-500"
                    )}
                  >
                    {overallBias}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xl font-black text-white tabular-nums">{overallConfidence}%</span>
                  <div className="w-24 h-1 bg-zinc-800 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        overallBias === "BULLISH"
                          ? "bg-j-up-bright"
                          : overallBias === "BEARISH"
                          ? "bg-j-down-bright"
                          : "bg-yellow-500"
                      )}
                      style={{ width: `${overallConfidence}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* AI Summary Card */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-center gap-1.5 border-b border-[#27272a] pb-2">
                <Brain className="w-4 h-4 text-j-up-bright" />
                <h3 className="text-xs font-bold text-zinc-200">AI Core Summary</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold block mb-1">
                    AI Verdict
                  </span>
                  <p className="text-xs text-zinc-300 leading-relaxed font-medium bg-[#09090b]/40 rounded p-2.5 border border-[#27272a]/40">
                    {analysis.summary.verdict}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold block mb-0.5">
                      Market Phase
                    </span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase bg-[#27272a] text-zinc-200 border border-zinc-700">
                      {analysis.summary.market_phase}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold block mb-0.5">
                      Recommended Action
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase border",
                        analysis.summary.recommended_action === "TAKE_POSITION"
                          ? "bg-j-up-bright/15 text-j-up-bright border-j-up-bright/35"
                          : analysis.summary.recommended_action === "WAIT_FOR_CONFIRMATION"
                          ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                      )}
                    >
                      {analysis.summary.recommended_action.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Trade Setup */}
            {analysis.trade_setup && (
              <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-[#27272a] pb-2">
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-[#f59e0b]" />
                    <h3 className="text-xs font-bold text-zinc-200">Execution Trade Setup</h3>
                  </div>
                  <span
                    className={cn(
                      "text-[9px] font-black px-1.5 py-0.5 rounded uppercase border",
                      analysis.trade_setup.setup_type.includes("LONG")
                        ? "bg-j-up-bright/15 text-j-up-bright border-j-up-bright/30"
                        : "bg-j-down-bright/15 text-j-down-bright border-j-down-bright/30"
                    )}
                  >
                    {analysis.trade_setup.setup_type.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-zinc-800/30">
                    <span className="text-zinc-500">Entry Trigger Zone</span>
                    <span className="font-semibold text-zinc-300 tabular-nums">
                      ${analysis.trade_setup.entry_zone.low.toFixed(2)} - ${analysis.trade_setup.entry_zone.high.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800/30">
                    <span className="text-zinc-500">Invalidation Stop Loss</span>
                    <span className="font-bold text-j-down-bright tabular-nums">
                      ${analysis.trade_setup.stop_loss.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800/30">
                    <span className="text-zinc-500">Take Profit Targets</span>
                    <div className="flex gap-1.5 font-semibold text-j-up-bright tabular-nums">
                      {analysis.trade_setup.targets.map((t, idx) => (
                        <span key={idx} className="bg-j-up-bright/10 px-1 py-0.2 rounded text-[10px]">
                          ${t.toFixed(2)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800/30">
                    <span className="text-zinc-500">Risk-to-Reward Ratio</span>
                    <span className="font-bold text-yellow-500 tabular-nums">
                      {analysis.trade_setup.risk_reward.toFixed(1)}R
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-zinc-500">Setup Confidence</span>
                    <span className="font-bold text-white tabular-nums">
                      {analysis.trade_setup.confidence}%
                    </span>
                  </div>

                  {analysis.trade_setup.invalidation && (
                    <div className="mt-2.5 p-2 rounded bg-j-down-bright/5 border border-j-down-bright/15 text-[10px] text-j-down-bright flex gap-1.5">
                      <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                      <span>
                        <strong>Invalidation Rule:</strong> {analysis.trade_setup.invalidation}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Column 2: Multi-Timeframe Structure & SMC Details */}
          <div className="flex flex-col gap-4 xl:col-span-2">
            {/* Multi-Timeframe Matrix */}
            <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-center gap-1.5 border-b border-[#27272a] pb-2">
                <Layers className="w-4 h-4 text-zinc-400" />
                <h3 className="text-xs font-bold text-zinc-200">Multi-Timeframe Trend Matrix</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#27272a] text-[#71717a] text-[9px] font-bold uppercase tracking-wider">
                      <th className="py-2">Timeframe</th>
                      <th className="py-2">Structure Trend</th>
                      <th className="py-2">Market Phase</th>
                      <th className="py-2">BOS</th>
                      <th className="py-2">CHOCH</th>
                      <th className="py-2">EMA Alignment</th>
                      <th className="py-2">Momentum Strength</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(analysis.multi_timeframe) as (keyof typeof analysis.multi_timeframe)[]).map((tf) => {
                      const item = analysis.multi_timeframe[tf];
                      if (!item) return null;
                      return (
                        <tr key={tf} className="border-b border-[#27272a]/40 hover:bg-[#27272a]/10">
                          <td className="py-2.5 font-black uppercase text-zinc-400 text-[10px]">{tf}</td>
                          <td className="py-2.5 font-bold">
                            <span
                              className={cn(
                                item.trend === "BULLISH"
                                  ? "text-j-up-bright"
                                  : item.trend === "BEARISH"
                                  ? "text-j-down-bright"
                                  : "text-zinc-500"
                              )}
                            >
                              {item.trend}
                            </span>
                          </td>
                          <td className="py-2.5 font-medium text-zinc-300 capitalize">
                            {item.structure.replace(/_/g, " ").toLowerCase()}
                          </td>
                          <td className="py-2.5">
                            {item.bos ? (
                              <CheckCircle size={13} className="text-j-up-bright" />
                            ) : (
                              <span className="text-zinc-600">-</span>
                            )}
                          </td>
                          <td className="py-2.5">
                            {item.choch ? (
                              <CheckCircle size={13} className="text-j-up-bright animate-pulse" />
                            ) : (
                              <span className="text-zinc-600">-</span>
                            )}
                          </td>
                          <td className="py-2.5">
                            <span
                              className={cn(
                                "px-1.5 py-0.2 rounded text-[9px] font-semibold border",
                                item.ema_trend === "BULLISH"
                                  ? "bg-j-up-bright/5 text-j-up-bright border-j-up-bright/20"
                                  : item.ema_trend === "BEARISH"
                                  ? "bg-j-down-bright/5 text-j-down-bright border-j-down-bright/20"
                                  : "bg-zinc-800/40 text-zinc-500 border-zinc-700/30"
                              )}
                            >
                              {item.ema_trend}
                            </span>
                          </td>
                          <td className="py-2.5 font-medium text-zinc-400">
                            {item.momentum.replace(/_/g, " ")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Smart Money SMC Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Order Blocks */}
              <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex flex-col gap-2">
                <h4 className="text-xs font-black text-zinc-300 border-b border-[#27272a] pb-1.5 flex justify-between items-center">
                  <span>Institutional Order Blocks</span>
                  {analysis.order_blocks.nearest_ob && (
                    <span className="text-[9px] font-bold text-yellow-500 font-mono">
                      OB: {analysis.order_blocks.nearest_ob.type} ({analysis.order_blocks.nearest_ob.distance_percent}% dist)
                    </span>
                  )}
                </h4>
                <div className="space-y-2 max-h-[160px] overflow-auto scrollbar-none text-[11px]">
                  <div className="text-[9px] uppercase tracking-wider text-j-up-bright font-bold">Bullish OB</div>
                  {analysis.order_blocks.bullish.length === 0 ? (
                    <div className="text-zinc-600 text-[10px]">No active bullish OB detected.</div>
                  ) : (
                    analysis.order_blocks.bullish.map((ob, i) => (
                      <div key={i} className="flex justify-between text-zinc-400 font-medium bg-[#09090b]/20 p-1 rounded">
                        <span className="uppercase font-bold text-zinc-500">{ob.type}</span>
                        <span className="tabular-nums">
                          ${ob.low.toFixed(2)} - ${ob.high.toFixed(2)}
                        </span>
                        <span className="text-j-up-bright text-[9px] uppercase font-black">{ob.status}</span>
                      </div>
                    ))
                  )}

                  <div className="text-[9px] uppercase tracking-wider text-j-down-bright font-bold pt-1.5">Bearish OB</div>
                  {analysis.order_blocks.bearish.length === 0 ? (
                    <div className="text-zinc-600 text-[10px]">No active bearish OB detected.</div>
                  ) : (
                    analysis.order_blocks.bearish.map((ob, i) => (
                      <div key={i} className="flex justify-between text-zinc-400 font-medium bg-[#09090b]/20 p-1 rounded">
                        <span className="uppercase font-bold text-zinc-500">{ob.type}</span>
                        <span className="tabular-nums">
                          ${ob.low.toFixed(2)} - ${ob.high.toFixed(2)}
                        </span>
                        <span className="text-j-down-bright text-[9px] uppercase font-black">{ob.status}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Fair Value Gaps */}
              <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex flex-col gap-2">
                <h4 className="text-xs font-black text-zinc-300 border-b border-[#27272a] pb-1.5 flex justify-between items-center">
                  <span>Fair Value Gaps (FVG)</span>
                  {analysis.fvg.nearest_fvg && (
                    <span className="text-[9px] font-bold text-yellow-500">
                      Nearest: {analysis.fvg.nearest_fvg.type}
                    </span>
                  )}
                </h4>
                <div className="space-y-2 max-h-[160px] overflow-auto scrollbar-none text-[11px]">
                  <div className="text-[9px] uppercase tracking-wider text-j-up-bright font-bold">Bullish FVG (Gaps)</div>
                  {analysis.fvg.bullish.length === 0 ? (
                    <div className="text-zinc-600 text-[10px]">No unfilled bullish FVGs.</div>
                  ) : (
                    analysis.fvg.bullish.map((fvg, i) => (
                      <div key={i} className="flex justify-between text-zinc-400 font-medium bg-[#09090b]/20 p-1 rounded">
                        <span className="font-semibold text-zinc-500">Unfilled</span>
                        <span className="tabular-nums">
                          ${fvg.low.toFixed(2)} - ${fvg.high.toFixed(2)}
                        </span>
                      </div>
                    ))
                  )}

                  <div className="text-[9px] uppercase tracking-wider text-j-down-bright font-bold pt-1.5">Bearish FVG (Gaps)</div>
                  {analysis.fvg.bearish.length === 0 ? (
                    <div className="text-zinc-600 text-[10px]">No unfilled bearish FVGs.</div>
                  ) : (
                    analysis.fvg.bearish.map((fvg, i) => (
                      <div key={i} className="flex justify-between text-zinc-400 font-medium bg-[#09090b]/20 p-1 rounded">
                        <span className="font-semibold text-zinc-500">Unfilled</span>
                        <span className="tabular-nums">
                          ${fvg.low.toFixed(2)} - ${fvg.high.toFixed(2)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SMC Orderflow & Liquidity Analysis Row */}
      {analysis && !isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* Order Book & Volume Profile */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex flex-col gap-3">
            <h3 className="text-xs font-bold text-zinc-200 border-b border-[#27272a] pb-2 flex items-center gap-1.5">
              <BarChart2 className="w-4 h-4 text-zinc-400" />
              Orderbook & Volume Profile
            </h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">Bids / Asks Depth</span>
                <span className="text-zinc-300 font-bold tabular-nums">
                  {analysis.orderbook.imbalance.bid_volume} / {analysis.orderbook.imbalance.ask_volume}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">Orderbook Ratio</span>
                <span className="text-zinc-300 font-bold tabular-nums">{analysis.orderbook.ratio}x</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">Dominant Book Side</span>
                <span
                  className={cn(
                    "font-bold uppercase text-[10px] px-1.5 py-0.2 rounded border",
                    analysis.orderbook.dominant_side === "BUYERS"
                      ? "bg-j-up-bright/5 text-j-up-bright border-j-up-bright/20"
                      : analysis.orderbook.dominant_side === "SELLERS"
                      ? "bg-j-down-bright/5 text-j-down-bright border-j-down-bright/20"
                      : "bg-zinc-800 text-zinc-500 border-zinc-700"
                  )}
                >
                  {analysis.orderbook.dominant_side}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">Active Absorption</span>
                <span
                  className={cn(
                    "font-bold text-[10px] uppercase",
                    analysis.orderbook.absorption ? "text-j-up-bright" : "text-zinc-600"
                  )}
                >
                  {analysis.orderbook.absorption ? "DETECTED" : "NONE"}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">Spoofing Activity</span>
                <span
                  className={cn(
                    "font-bold text-[10px] uppercase",
                    analysis.orderbook.spoofing ? "text-j-down-bright font-black animate-pulse" : "text-zinc-600"
                  )}
                >
                  {analysis.orderbook.spoofing ? "WARNING DETECTED" : "NONE"}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-zinc-500 font-medium">Volume Profile POC</span>
                <span className="text-zinc-300 font-bold tabular-nums">
                  ${analysis.volume_profile.poc.toFixed(2)} (
                  <span className="text-[10px] font-semibold text-zinc-400">
                    {analysis.volume_profile.current_position.replace(/_/g, " ")}
                  </span>
                  )
                </span>
              </div>
            </div>
          </div>

          {/* Derivatives & Squeezes (OI & Funding) */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex flex-col gap-3">
            <h3 className="text-xs font-bold text-zinc-200 border-b border-[#27272a] pb-2 flex items-center gap-1.5">
              <Percent className="w-4 h-4 text-zinc-400" />
              Derivatives Dynamics
            </h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">Open Interest</span>
                <span className="text-zinc-300 font-bold tabular-nums text-[11px]">
                  {analysis.open_interest.current} (
                  <span
                    className={cn(
                      "text-[10px] font-bold",
                      analysis.open_interest.change_24h.percent >= 0 ? "text-j-up-bright" : "text-j-down-bright"
                    )}
                  >
                    {analysis.open_interest.change_24h.percent >= 0 ? "+" : ""}
                    {analysis.open_interest.change_24h.percent.toFixed(1)}%
                  </span>
                  )
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">OI Build-up State</span>
                <span className="text-[#f59e0b] font-black uppercase text-[10px] bg-[#f59e0b]/5 border border-[#f59e0b]/20 px-1.5 py-0.2 rounded">
                  {analysis.open_interest.interpretation.replace(/_/g, " ")}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">OI Conviction</span>
                <span className="text-zinc-300 font-bold text-[10px] uppercase">
                  {analysis.open_interest.conviction}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">Funding Rate</span>
                <span className="text-zinc-300 font-bold tabular-nums">
                  {analysis.funding.current} (
                  <span className="text-[10px] font-semibold text-zinc-400">
                    {analysis.funding.sentiment.replace(/_/g, " ")}
                  </span>
                  )
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-zinc-500 font-medium">Squeeze Risk</span>
                <span
                  className={cn(
                    "font-black text-[10px] uppercase border px-1.5 py-0.2 rounded",
                    analysis.funding.squeeze_risk.includes("SQUEEZE")
                      ? "bg-j-down-bright/15 text-j-down-bright border-j-down-bright/35 animate-pulse"
                      : "bg-zinc-800 text-zinc-500 border-zinc-700"
                  )}
                >
                  {analysis.funding.squeeze_risk.replace(/_/g, " ")}
                </span>
              </div>
            </div>
          </div>

          {/* CVD Divergence & Liquidity Sweeps */}
          <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex flex-col gap-3">
            <h3 className="text-xs font-bold text-zinc-200 border-b border-[#27272a] pb-2 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-zinc-400" />
              CVD & Liquidity Sweeps
            </h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">CVD Divergence Trend</span>
                <span
                  className={cn(
                    "font-bold text-[10px] uppercase",
                    analysis.cvd.trend.includes("BULLISH")
                      ? "text-j-up-bright"
                      : analysis.cvd.trend.includes("BEARISH")
                      ? "text-j-down-bright"
                      : "text-zinc-500"
                  )}
                >
                  {analysis.cvd.trend.replace(/_/g, " ")}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">CVD Signal Strength</span>
                <span className="text-zinc-300 font-bold text-[10px] uppercase">
                  {analysis.cvd.signal_strength}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">Last Liquidity Sweep</span>
                <span className="text-zinc-300 font-bold tabular-nums text-[10px]">
                  {analysis.liquidity.last_sweep ? (
                    <span
                      className={cn(
                        "font-bold uppercase",
                        analysis.liquidity.last_sweep.side === "SELL_SIDE" ? "text-j-up-bright" : "text-j-down-bright"
                      )}
                    >
                      {analysis.liquidity.last_sweep.side.replace(/_/g, " ")} sweep at $
                      {analysis.liquidity.last_sweep.level.toFixed(2)}
                    </span>
                  ) : (
                    "NONE"
                  )}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800/30">
                <span className="text-zinc-500 font-medium">Sweep Event Type</span>
                <span className="text-zinc-300 font-bold text-[10px] uppercase">
                  {analysis.liquidity.liquidity_event
                    ? `${analysis.liquidity.liquidity_event.type} (${analysis.liquidity.liquidity_event.strength})`
                    : "NONE"}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-zinc-500 font-medium">Probability of Reversal</span>
                <span className="text-zinc-300 font-bold tabular-nums">
                  {analysis.liquidity.probability_of_reversal}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
