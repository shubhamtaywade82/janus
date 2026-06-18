import { useState, useMemo, useRef, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import {
  classifyErRegime,
  klinesToAdaptiveCandles,
  runAdaptiveSupertrendEngine,
  type AdaptiveSupertrendParams,
} from "@/lib/adaptive-supertrend";
import { PriceChart, EquityChart, ERChart } from "@/components/adaptive-supertrend/charts";
import { PineModal, StatCard, Slider } from "@/components/adaptive-supertrend/ui";
import { AST_COLORS as C } from "@/components/adaptive-supertrend/theme";
import { Loader2, RefreshCw } from "lucide-react";

const INTERVALS = ["1m", "5m", "15m", "1h", "4h"] as const;

const DEFAULT_PARAMS: AdaptiveSupertrendParams = {
  atrPeriod: 10,
  erLength: 14,
  smoothLength: 5,
  minFactor: 1.5,
  maxFactor: 4.5,
};

export default function AdaptiveSupertrend() {
  const [symbol, setSymbol] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("janus_selected_symbol") || "BTCUSDT";
    }
    return "BTCUSDT";
  });
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>("15m");
  const [params, setParams] = useState<AdaptiveSupertrendParams>(DEFAULT_PARAMS);
  const [showPine, setShowPine] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(760);

  useEffect(() => {
    localStorage.setItem("janus_selected_symbol", symbol);
  }, [symbol]);

  useEffect(() => {
    const obs = new ResizeObserver(([entry]) => setChartW(entry.contentRect.width));
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const { data: pairs } = trpc.market.pairs.useQuery();
  const {
    data: klines,
    isLoading,
    isFetching,
    refetch,
  } = trpc.market.klines.useQuery(
    { symbol, interval, limit: 500 },
    {
      staleTime: 30_000,
      refetchInterval: interval === "1m" ? 60_000 : 120_000,
      refetchOnWindowFocus: true,
    }
  );

  const candles = useMemo(
    () => (klines?.length ? klinesToAdaptiveCandles(klines) : []),
    [klines]
  );

  const result = useMemo(() => {
    if (candles.length < 30) return null;
    return runAdaptiveSupertrendEngine(candles, params);
  }, [candles, params]);

  const setParam =
    <K extends keyof AdaptiveSupertrendParams>(key: K) =>
    (value: AdaptiveSupertrendParams[K]) =>
      setParams((p) => ({ ...p, [key]: value }));

  const lastER = result?.er[result.er.length - 1] ?? 0;
  const lastF =
    result?.smoothedFactor.filter((v) => !Number.isNaN(v)).at(-1) ?? 0;
  const regime = classifyErRegime(lastER);
  const regimeColor =
    regime === "Trending" ? C.accent : regime === "Mixed" ? C.warn : C.red;

  const longSignals = result?.signals.filter((s) => s.type === "long").length ?? 0;
  const shortSignals = result?.signals.filter((s) => s.type === "short").length ?? 0;

  return (
    <div className="min-h-full bg-j-app text-j-text">
      {showPine && <PineModal params={params} onClose={() => setShowPine(false)} />}

      <div className="flex items-center justify-between border-b border-j-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-j-up/30 bg-gradient-to-br from-j-up/20 to-j-purple/20 text-[15px]">
            ⚡
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight">Adaptive Supertrend</div>
            <div className="mt-0.5 text-[10px] text-j-text-3">
              Kaufman ER · Live Binance Futures · USDT-Margined
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <div
              className="rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wider"
              style={{
                color: regimeColor,
                borderColor: `${regimeColor}66`,
                background: `${regimeColor}20`,
              }}
            >
              {regime.toUpperCase()} · ER {(lastER * 100).toFixed(0)}%
            </div>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-md border border-j-border px-2.5 py-1.5 text-[11px] text-j-text-2 hover:text-j-text disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => setShowPine(true)}
            className="rounded-md border border-j-up/40 bg-j-up/10 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-j-up"
          >
            Export Pine ↗
          </button>
        </div>
      </div>

      <div className="flex">
        <aside className="w-[220px] shrink-0 border-r border-j-border px-4 py-5">
          <div className="mb-4">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-j-text-3">
              Symbol
            </div>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full rounded-md border border-j-border bg-j-surface-2 px-2 py-1.5 font-mono text-xs text-j-text"
            >
              {(pairs ?? [{ binance: symbol, coindcx: "" }]).map((p) => (
                <option key={p.binance} value={p.binance}>
                  {p.binance}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-5">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-j-text-3">
              Interval
            </div>
            <div className="flex flex-wrap gap-1">
              {INTERVALS.map((iv) => (
                <button
                  key={iv}
                  onClick={() => setInterval(iv)}
                  className={cn(
                    "rounded px-2 py-1 font-mono text-[10px]",
                    interval === iv
                      ? "bg-j-up/20 text-j-up"
                      : "text-j-text-3 hover:text-j-text-2"
                  )}
                >
                  {iv}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 text-[10px] uppercase tracking-widest text-j-text-3">
            ATR Config
          </div>
          <Slider
            label="ATR Period"
            value={params.atrPeriod}
            min={5}
            max={30}
            step={1}
            onChange={setParam("atrPeriod")}
          />

          <div className="mb-4 mt-5 text-[10px] uppercase tracking-widest text-j-text-3">
            Multiplier Range
          </div>
          <Slider
            label="Min Factor (Trend)"
            value={params.minFactor}
            min={0.5}
            max={3}
            step={0.1}
            onChange={setParam("minFactor")}
            unit="×"
            color={C.accent}
          />
          <Slider
            label="Max Factor (Chop)"
            value={params.maxFactor}
            min={2}
            max={8}
            step={0.1}
            onChange={setParam("maxFactor")}
            unit="×"
            color={C.red}
          />

          <div className="mb-4 mt-5 text-[10px] uppercase tracking-widest text-j-text-3">
            Efficiency Engine
          </div>
          <Slider
            label="ER Window"
            value={params.erLength}
            min={5}
            max={40}
            step={1}
            onChange={setParam("erLength")}
            color={C.purple}
          />
          <Slider
            label="EMA Smooth"
            value={params.smoothLength}
            min={1}
            max={20}
            step={1}
            onChange={setParam("smoothLength")}
            color={C.warn}
          />

          {result && (
            <div className="mt-6 rounded-lg border border-j-border bg-j-surface-2 p-3">
              <div className="mb-2.5 text-[9px] uppercase tracking-widest text-j-text-3">
                Live State
              </div>
              {(
                [
                  ["ER", `${(lastER * 100).toFixed(1)}%`, regimeColor],
                  ["Factor", `${lastF.toFixed(2)}×`, C.warn],
                  ["Regime", regime, regimeColor],
                  ["Bars", String(candles.length), C.text],
                ] as const
              ).map(([k, v, col]) => (
                <div key={k} className="mb-1.5 flex justify-between">
                  <span className="text-[10px] text-j-text-3">{k}</span>
                  <span className="font-mono text-[10px]" style={{ color: col }}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>

        <div ref={containerRef} className="min-w-0 flex-1 overflow-hidden px-5 pt-5">
          {isLoading && (
            <div className="flex h-64 items-center justify-center gap-2 text-j-text-3">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading {symbol} {interval} klines…
            </div>
          )}

          {!isLoading && candles.length < 30 && (
            <div className="flex h-64 items-center justify-center text-j-text-3">
              Insufficient candle data for {symbol} ({interval})
            </div>
          )}

          {result && (
            <>
              <div className="mb-4 flex gap-2.5">
                <StatCard
                  label="Net Return"
                  value={result.stats.finalReturn}
                  unit="%"
                  color={+result.stats.finalReturn >= 0 ? C.accent : C.red}
                  sub="1% equity risk / trade (sim)"
                />
                <StatCard
                  label="Win Rate"
                  value={result.stats.winRate}
                  unit="%"
                />
                <StatCard
                  label="Total Trades"
                  value={result.stats.totalTrades}
                  sub={`${longSignals} long / ${shortSignals} short`}
                />
                <StatCard
                  label="Max Drawdown"
                  value={result.stats.maxDD}
                  unit="%"
                  color={C.red}
                  sub="peak-to-trough"
                />
              </div>

              <div className="mb-2.5 overflow-hidden rounded-[10px] border border-j-border bg-j-surface">
                <div className="flex items-center gap-4 border-b border-j-border px-3.5 py-2.5">
                  <span className="text-[11px] text-j-text-2">
                    {symbol} Perp · Adaptive ST
                  </span>
                  <span className="text-[10px] text-j-text-3">last 120 bars · {interval}</span>
                  <div className="ml-auto flex gap-3">
                    {(
                      [
                        ["Long signal", C.accent],
                        ["Short signal", C.red],
                        ["ST line", `${C.accent}99`],
                      ] as const
                    ).map(([label, color]) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <div
                          className="h-2 w-2 rounded-sm"
                          style={{ background: color }}
                        />
                        <span className="text-[9px] text-j-text-3">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <PriceChart
                  candles={candles}
                  result={result}
                  width={chartW - 40}
                  height={300}
                />
              </div>

              <div className="mb-2.5 overflow-hidden rounded-[10px] border border-j-border bg-j-surface">
                <div className="flex items-center gap-4 border-b border-j-border px-3.5 py-2.5">
                  <span className="text-[11px] text-j-text-2">
                    Efficiency Ratio + Live Multiplier
                  </span>
                  <div className="ml-auto flex gap-3">
                    {(
                      [
                        ["ER (0–1)", C.purple],
                        ["Factor", C.warn],
                      ] as const
                    ).map(([label, color]) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <div className="h-0.5 w-[18px]" style={{ background: color }} />
                        <span className="text-[9px] text-j-text-3">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <ERChart
                  er={result.er}
                  smoothedFactor={result.smoothedFactor}
                  width={chartW - 40}
                  height={120}
                  minFactor={params.minFactor}
                  maxFactor={params.maxFactor}
                />
              </div>

              <div className="overflow-hidden rounded-[10px] border border-j-border bg-j-surface">
                <div className="border-b border-j-border px-3.5 py-2.5">
                  <span className="text-[11px] text-j-text-2">
                    Equity Curve · $10,000 starting capital (simulated)
                  </span>
                </div>
                <EquityChart
                  curve={result.equityCurve}
                  width={chartW - 40}
                  height={110}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
