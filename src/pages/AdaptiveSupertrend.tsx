import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { trpc } from "@/providers/trpc";
import {
  AST_DATE_PRESETS,
  AST_INTERVALS,
  AST_SYMBOLS,
  classifyErRegime,
  fromISO,
  fmtDate,
  klinesToAdaptiveCandles,
  runBacktest,
  toISO,
  type AdaptiveBacktestResult,
  type AdaptiveCandle,
  type AdaptiveSupertrendParams,
} from "@/lib/adaptive-supertrend";
import {
  PriceChart,
  VolumeChart,
  ERChart,
  EquityChart,
} from "@/components/adaptive-supertrend/charts";
import {
  FeeNote,
  Panel,
  Pill,
  PineModal,
  Slider,
  StatRow,
  TradeLog,
} from "@/components/adaptive-supertrend/ui";
import { AST_COLORS as C, navBtnStyle } from "@/components/adaptive-supertrend/theme";

const DEFAULT_PARAMS: AdaptiveSupertrendParams = {
  atrPeriod: 10,
  erLength: 14,
  smoothLength: 5,
  minFactor: 1.5,
  maxFactor: 4.5,
};

export default function AdaptiveSupertrend() {
  const now = Date.now();
  const d30 = 30 * 86400_000;

  const [symbol, setSymbol] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("janus_selected_symbol") || "SOLUSDT";
    }
    return "SOLUSDT";
  });
  const [interval, setInterval] = useState("1h");
  const [startDate, setStartDate] = useState(toISO(now - d30));
  const [endDate, setEndDate] = useState(toISO(now));

  const [candles, setCandles] = useState<AdaptiveCandle[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [showPine, setShowPine] = useState(false);
  const [params, setParams] = useState<AdaptiveSupertrendParams>(DEFAULT_PARAMS);
  const [viewRange, setViewRange] = useState<[number, number]>([0, 0]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(700);
  const utils = trpc.useUtils();

  useEffect(() => {
    localStorage.setItem("janus_selected_symbol", symbol);
  }, [symbol]);

  useEffect(() => {
    const obs = new ResizeObserver(([e]) => setChartW(e.contentRect.width));
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const result: AdaptiveBacktestResult | null = useMemo(() => {
    if (candles.length < 30) return null;
    return runBacktest(candles, params);
  }, [candles, params]);

  useEffect(() => {
    if (!candles.length) return;
    const n = candles.length;
    const visible = Math.min(n, 200);
    setViewRange([n - visible, n]);
  }, [candles]);

  const fetchAndRun = useCallback(async () => {
    setLoading(true);
    setError("");
    setProgress(0);
    setCandles([]);

    try {
      const startMs = fromISO(startDate);
      const endMs = Math.min(fromISO(endDate) + 86400_000 - 1, now);
      if (startMs >= endMs) throw new Error("Start date must be before end date");

      setProgress(10);
      const klines = await utils.market.klinesHistorical.fetch({
        symbol,
        interval,
        startTime: startMs,
        endTime: endMs,
      });

      if (!klines.length) {
        throw new Error("No data returned — check symbol/date range");
      }

      setProgress(100);
      setCandles(klinesToAdaptiveCandles(klines));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, startDate, endDate, utils, now]);

  const applyPreset = useCallback((days: number) => {
    setEndDate(toISO(now));
    setStartDate(toISO(now - days * 86400_000));
  }, [now]);

  const setP =
    <K extends keyof AdaptiveSupertrendParams>(key: K) =>
    (value: AdaptiveSupertrendParams[K]) =>
      setParams((p) => ({ ...p, [key]: value }));

  const lastER = result?.er.filter((v) => !Number.isNaN(v)).at(-1) ?? 0;
  const lastF = result?.smoothedFactor.filter((v) => !Number.isNaN(v)).at(-1) ?? 0;
  const regime = classifyErRegime(lastER);
  const regimeColor =
    regime === "Trending" ? C.accent : regime === "Mixed" ? C.yellow : C.red;

  const candleCount = candles.length;
  const viewLen = viewRange[1] - viewRange[0];

  const moveView = (dir: number) => {
    const step = Math.round(viewLen * 0.3);
    setViewRange(([s]) => {
      const ns = Math.max(0, Math.min(s + dir * step, candleCount - viewLen));
      return [ns, ns + viewLen];
    });
  };

  const zoomView = (dir: number) => {
    setViewRange(([s, e]) => {
      const len = e - s;
      const newLen = Math.max(
        30,
        Math.min(candleCount, Math.round(len * (dir > 0 ? 0.6 : 1.6)))
      );
      const center = Math.round((s + e) / 2);
      const ns = Math.max(0, Math.min(center - Math.round(newLen / 2), candleCount - newLen));
      return [ns, ns + newLen];
    });
  };

  const s = result?.stats;
  const chartInnerW = chartW - 32;

  return (
    <div
      className="min-h-full font-sans"
      style={{ background: C.bg, color: C.text }}
    >
      {showPine && <PineModal params={params} onClose={() => setShowPine(false)} />}

      <div
        className="border-b px-4 py-2.5"
        style={{ borderColor: C.border, background: C.panel }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="cursor-pointer rounded-md border px-2.5 py-1.5 font-mono text-xs font-bold"
            style={{
              background: C.panel2,
              borderColor: C.border2,
              color: C.text,
            }}
          >
            {AST_SYMBOLS.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-1">
            {AST_INTERVALS.map((iv) => (
              <Pill
                key={iv.label}
                active={interval === iv.label}
                onClick={() => setInterval(iv.label)}
              >
                {iv.label}
              </Pill>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-md border px-2 py-1 text-[11px]"
              style={{
                background: C.panel2,
                borderColor: C.border2,
                color: C.label,
              }}
            />
            <span className="text-[11px]" style={{ color: C.sub }}>
              →
            </span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-md border px-2 py-1 text-[11px]"
              style={{
                background: C.panel2,
                borderColor: C.border2,
                color: C.label,
              }}
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {AST_DATE_PRESETS.map((p) => (
              <Pill key={p.label} onClick={() => applyPreset(p.days)}>
                {p.label}
              </Pill>
            ))}
          </div>

          <button
            onClick={fetchAndRun}
            disabled={loading}
            className="ml-auto rounded-md border px-5 py-1.5 text-xs font-bold tracking-wide"
            style={{
              cursor: loading ? "wait" : "pointer",
              background: loading ? C.border : `${C.accent}22`,
              borderColor: loading ? C.border : `${C.accent}66`,
              color: loading ? C.sub : C.accent,
            }}
          >
            {loading ? `Loading ${progress}%…` : "▶ Fetch & Run"}
          </button>

          <button
            onClick={() => setShowPine(true)}
            className="rounded-md border px-3.5 py-1.5 text-[11px] font-semibold"
            style={{
              cursor: "pointer",
              background: `${C.purple}18`,
              borderColor: `${C.purple}44`,
              color: C.purple,
            }}
          >
            Pine ↗
          </button>
        </div>

        {error && (
          <div
            className="mt-2 rounded-md border px-3 py-1.5 text-[11px]"
            style={{
              background: `${C.red}18`,
              borderColor: `${C.red}44`,
              color: C.red,
            }}
          >
            ⚠ {error}
          </div>
        )}
      </div>

      <div className="flex min-h-[calc(100vh-120px)]">
        <aside
          className="w-[200px] shrink-0 overflow-y-auto border-r px-3.5 py-4"
          style={{ borderColor: C.border, background: C.panel }}
        >
          <div
            className="mb-3.5 text-[9px] uppercase tracking-widest"
            style={{ color: C.sub }}
          >
            ATR
          </div>
          <Slider
            label="Period"
            value={params.atrPeriod}
            min={5}
            max={30}
            step={1}
            onChange={setP("atrPeriod")}
          />

          <div
            className="mb-3.5 mt-4 text-[9px] uppercase tracking-widest"
            style={{ color: C.sub }}
          >
            Multiplier
          </div>
          <Slider
            label="Min (trend)"
            value={params.minFactor}
            min={0.5}
            max={3.5}
            step={0.1}
            onChange={setP("minFactor")}
            unit="×"
            color={C.accent}
          />
          <Slider
            label="Max (chop)"
            value={params.maxFactor}
            min={2}
            max={9}
            step={0.1}
            onChange={setP("maxFactor")}
            unit="×"
            color={C.red}
          />

          <div
            className="mb-3.5 mt-4 text-[9px] uppercase tracking-widest"
            style={{ color: C.sub }}
          >
            Efficiency
          </div>
          <Slider
            label="ER Window"
            value={params.erLength}
            min={5}
            max={50}
            step={1}
            onChange={setP("erLength")}
            color={C.purple}
          />
          <Slider
            label="EMA Smooth"
            value={params.smoothLength}
            min={1}
            max={20}
            step={1}
            onChange={setP("smoothLength")}
            color={C.yellow}
          />

          <div
            className="mt-[18px] rounded-lg border p-2.5"
            style={{ background: C.bg, borderColor: C.border }}
          >
            <div
              className="mb-2 text-[9px] uppercase tracking-widest"
              style={{ color: C.sub }}
            >
              Live
            </div>
            <StatRow label="ER" value={`${(lastER * 100).toFixed(1)}%`} color={regimeColor} mono />
            <StatRow label="Factor" value={`${lastF.toFixed(2)}×`} color={C.yellow} mono />
            <StatRow label="Regime" value={regime} color={regimeColor} />
            {candleCount > 0 && (
              <StatRow
                label="Bars"
                value={candleCount.toLocaleString()}
                color={C.sub}
                mono
              />
            )}
          </div>

          {s && (
            <>
              <div
                className="mb-2.5 mt-[18px] text-[9px] uppercase tracking-widest"
                style={{ color: C.sub }}
              >
                Backtest
              </div>
              <div
                className="rounded-lg border p-2.5"
                style={{ background: C.bg, borderColor: C.border }}
              >
                <StatRow
                  label="Net Return"
                  value={`${s.netReturn}%`}
                  color={+s.netReturn >= 0 ? C.accent : C.red}
                  mono
                />
                <StatRow label="Win Rate" value={`${s.winRate}%`} mono />
                <StatRow
                  label="Profit Factor"
                  value={s.profitFactor}
                  color={
                    +s.profitFactor >= 1.5
                      ? C.accent
                      : +s.profitFactor >= 1
                        ? C.yellow
                        : C.red
                  }
                  mono
                />
                <StatRow label="Max DD" value={`${s.maxDD}%`} color={C.red} mono />
                <StatRow
                  label="Sharpe"
                  value={s.sharpe}
                  color={+s.sharpe >= 1 ? C.accent : C.sub}
                  mono
                />
                <StatRow label="Trades" value={s.totalTrades} color={C.sub} mono />
                <StatRow label="↑ Long" value={s.longs} color={`${C.accent}aa`} mono />
                <StatRow label="↓ Short" value={s.shorts} color={`${C.red}aa`} mono />
                <StatRow label="Avg Win" value={`${s.avgWin}%`} color={C.accent} mono />
                <StatRow label="Avg Loss" value={`-${s.avgLoss}%`} color={C.red} mono />
                <StatRow label="Best" value={`${s.bestTrade}%`} color={C.accent} mono />
                <StatRow label="Worst" value={`${s.worstTrade}%`} color={C.red} mono />
                <StatRow label="Max CW" value={s.maxCW} color={`${C.accent}aa`} mono />
                <StatRow label="Max CL" value={s.maxCL} color={`${C.red}aa`} mono />
              </div>
              <FeeNote />
            </>
          )}
        </aside>

        <div ref={containerRef} className="min-w-0 flex-1 overflow-hidden px-4 py-3.5">
          {!candleCount && !loading && (
            <div
              className="flex h-[300px] flex-col items-center justify-center gap-3"
              style={{ color: C.sub }}
            >
              <div className="text-[32px]">📡</div>
              <div className="text-[13px]" style={{ color: C.label }}>
                Select symbol, interval & date range, then click Fetch & Run
              </div>
              <div className="text-[11px]">
                Pulls OHLCV via Janus → Binance FAPI (paginated historical)
              </div>
            </div>
          )}

          {candleCount > 0 && result && (
            <>
              <div className="mb-2.5 flex items-center gap-2">
                <span className="font-mono text-[10px]" style={{ color: C.label }}>
                  {symbol} · {interval} · {candleCount.toLocaleString()} bars ·{" "}
                  {fmtDate(candles[0].t)} → {fmtDate(candles[candleCount - 1].t)}
                </span>
                <div className="ml-auto flex gap-1">
                  <button onClick={() => zoomView(1)} style={navBtnStyle}>
                    +
                  </button>
                  <button onClick={() => zoomView(-1)} style={navBtnStyle}>
                    −
                  </button>
                  <button onClick={() => moveView(-1)} style={navBtnStyle}>
                    ◀
                  </button>
                  <button onClick={() => moveView(1)} style={navBtnStyle}>
                    ▶
                  </button>
                  <button
                    onClick={() => setViewRange([0, candleCount])}
                    style={navBtnStyle}
                  >
                    All
                  </button>
                  <button
                    onClick={() => {
                      const v = Math.min(candleCount, 200);
                      setViewRange([candleCount - v, candleCount]);
                    }}
                    style={navBtnStyle}
                  >
                    Latest
                  </button>
                </div>
                <div
                  className="rounded px-2 py-0.5 text-[9px] font-bold"
                  style={{
                    background: `${regimeColor}20`,
                    color: regimeColor,
                    border: `1px solid ${regimeColor}44`,
                  }}
                >
                  {regime} ER={(lastER * 100).toFixed(0)}%
                </div>
              </div>

              <Panel>
                <PriceChart
                  candles={candles}
                  result={result}
                  width={chartInnerW}
                  height={320}
                  symbol={symbol}
                  viewRange={viewRange}
                />
              </Panel>

              <Panel>
                <VolumeChart
                  candles={candles}
                  result={result}
                  width={chartInnerW}
                  height={70}
                  viewRange={viewRange}
                />
              </Panel>

              <Panel title="Efficiency Ratio  ·  Live Multiplier Factor">
                <ERChart
                  result={result}
                  width={chartInnerW}
                  height={100}
                  minFactor={params.minFactor}
                  maxFactor={params.maxFactor}
                  viewRange={viewRange}
                />
              </Panel>

              <Panel title="Equity Curve  ·  $10,000 start  ·  1% risk/trade  ·  0.04% fee + 0.02% slip">
                <EquityChart result={result} width={chartInnerW} height={110} />
              </Panel>

              <Panel
                title={`Trade Log  ·  ${result.trades.length} trades  ·  net after fees & slippage`}
              >
                <TradeLog trades={result.trades} />
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
