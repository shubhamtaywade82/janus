import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp } from "lucide-react";

export interface IndicatorConfig {
  // EMA periods active
  ema:   number[];   // e.g. [9, 21, 50, 200]
  // SMA periods active
  sma:   number[];   // e.g. [20, 50, 200]
  // Bollinger Bands
  bb:    boolean;
  bbPeriod: number;
  bbMult:   number;
  // SuperTrend
  superTrend:       boolean;
  superTrendPeriod: number;
  superTrendMult:   number;
  // KNN SuperTrend (fixed params matching backend: period=10, mult=3)
  knnSuperTrend: boolean;
  // RSI sub-pane
  rsi:       boolean;
  rsiPeriod: number;
  // VWAP
  vwap: boolean;
  // CVD (Cumulative Volume Delta)
  cvd: boolean;
  // Nadaraya-Watson envelope
  nw:          boolean;
  nwBandwidth: number;
  nwMult:      number;
  // MACD
  macd:       boolean;
  macdFast:   number;
  macdSlow:   number;
  macdSignal: number;
  // Stochastic RSI
  stochRsi:       boolean;
  stochRsiPeriod: number;
  stochSmoothK:   number;
  stochSmoothD:   number;
  // Parabolic SAR
  psar:     boolean;
  psarStep: number;
  psarMax:  number;
  // Ichimoku Cloud
  ichimoku: boolean;
  // ADX + DI lines
  adx:       boolean;
  adxPeriod: number;
  // Z-Score
  zScore:       boolean;
  zScorePeriod: number;
  // Volume Profile
  volumeProfile:        boolean;
  volumeProfileBuckets: number;
  // Order Book Depth
  orderBookDepth:       boolean;
  // Keltner Channels
  keltner:       boolean;
  keltnerEma:    number;
  keltnerAtr:    number;
  keltnerMult:   number;
  // Donchian Channels
  donchian:       boolean;
  donchianPeriod: number;
  // TTM Squeeze (BB inside Keltner momentum oscillator)
  ttmSqueeze:       boolean;
  ttmSqPeriod:      number;
  ttmSqBBMult:      number;
  ttmSqKMult:       number;
}

const DEFAULTS: IndicatorConfig = {
  ema: [21, 50], sma: [], bb: false, bbPeriod: 20, bbMult: 2,
  superTrend: false, superTrendPeriod: 10, superTrendMult: 3,
  knnSuperTrend: false,
  rsi: false, rsiPeriod: 14, vwap: false, cvd: false,
  nw: false, nwBandwidth: 8, nwMult: 3,
  macd: false, macdFast: 12, macdSlow: 26, macdSignal: 9,
  stochRsi: false, stochRsiPeriod: 14, stochSmoothK: 3, stochSmoothD: 3,
  psar: false, psarStep: 0.02, psarMax: 0.2,
  ichimoku: false,
  adx: false, adxPeriod: 14,
  zScore: false, zScorePeriod: 20,
  volumeProfile: false, volumeProfileBuckets: 48,
  orderBookDepth: false,
  keltner: false, keltnerEma: 20, keltnerAtr: 10, keltnerMult: 2,
  donchian: false, donchianPeriod: 20,
  ttmSqueeze: false, ttmSqPeriod: 20, ttmSqBBMult: 2.0, ttmSqKMult: 1.5,
};

const EMA_COLORS: Record<number, string> = {
  9:   "#f59e0b",   // amber
  21:  "#0ecb81",   // green
  50:  "#3b82f6",   // blue
  200: "#a855f7",   // purple
};
const SMA_COLORS: Record<number, string> = {
  20:  "#f59e0b",
  50:  "#3b82f6",
  200: "#a855f7",
};

interface Props { onChange: (cfg: IndicatorConfig) => void; }

export function IndicatorPanel({ onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [expanded]);

  const [cfg, setCfg] = useState<IndicatorConfig>(() => {
    try {
      const s = localStorage.getItem("janus_indicators");
      return s ? { ...DEFAULTS, ...JSON.parse(s) } : DEFAULTS;
    } catch { return DEFAULTS; }
  });

  useEffect(() => {
    localStorage.setItem("janus_indicators", JSON.stringify(cfg));
    onChange(cfg);
  }, [cfg, onChange]);

  const toggleEMA = (p: number) =>
    setCfg((c) => ({ ...c, ema: c.ema.includes(p) ? c.ema.filter((x) => x !== p) : [...c.ema, p] }));
  const toggleSMA = (p: number) =>
    setCfg((c) => ({ ...c, sma: c.sma.includes(p) ? c.sma.filter((x) => x !== p) : [...c.sma, p] }));

  const activeCount =
    cfg.ema.length + cfg.sma.length +
    (cfg.bb ? 1 : 0) + (cfg.superTrend ? 1 : 0) + (cfg.knnSuperTrend ? 1 : 0) +
    (cfg.rsi ? 1 : 0) + (cfg.vwap ? 1 : 0) + (cfg.cvd ? 1 : 0) + (cfg.nw ? 1 : 0) +
    (cfg.macd ? 1 : 0) + (cfg.stochRsi ? 1 : 0) + (cfg.psar ? 1 : 0) +
    (cfg.ichimoku ? 1 : 0) + (cfg.adx ? 1 : 0) +
    (cfg.zScore ? 1 : 0) + (cfg.volumeProfile ? 1 : 0) + (cfg.orderBookDepth ? 1 : 0) +
    (cfg.keltner ? 1 : 0) + (cfg.donchian ? 1 : 0) + (cfg.ttmSqueeze ? 1 : 0);

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors",
          expanded ? "bg-[#18181b] text-[#f4f4f5] border-[#27272a]" : "text-[#71717a] border-[#27272a] hover:text-[#f4f4f5]"
        )}
        title="Technical indicators"
      >
        <TrendingUp size={11} />
        <span>Ind</span>
        {activeCount > 0 && <span className="text-j-up tabular-nums">{activeCount}</span>}
      </button>

      {expanded && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[#09090b] border border-[#27272a] rounded-lg shadow-xl p-3 w-52">
          <div className="text-[9px] text-[#52525b] uppercase tracking-wide mb-2">Indicators</div>

          {/* EMA */}
          <div className="mb-2">
            <div className="text-[9px] text-[#71717a] mb-1">EMA</div>
            <div className="flex gap-1 flex-wrap">
              {[9, 21, 50, 200].map((p) => (
                <button key={p} onClick={() => toggleEMA(p)}
                  className="px-1.5 py-0.5 rounded text-[9px] border transition-colors"
                  style={{
                    background: cfg.ema.includes(p) ? `${EMA_COLORS[p]}18` : "transparent",
                    color:      cfg.ema.includes(p) ? EMA_COLORS[p] : "#52525b",
                    borderColor: cfg.ema.includes(p) ? `${EMA_COLORS[p]}50` : "#27272a",
                  }}
                >{p}</button>
              ))}
            </div>
          </div>

          {/* SMA */}
          <div className="mb-2">
            <div className="text-[9px] text-[#71717a] mb-1">SMA</div>
            <div className="flex gap-1 flex-wrap">
              {[20, 50, 200].map((p) => (
                <button key={p} onClick={() => toggleSMA(p)}
                  className="px-1.5 py-0.5 rounded text-[9px] border transition-colors"
                  style={{
                    background: cfg.sma.includes(p) ? `${SMA_COLORS[p]}18` : "transparent",
                    color:      cfg.sma.includes(p) ? SMA_COLORS[p] : "#52525b",
                    borderColor: cfg.sma.includes(p) ? `${SMA_COLORS[p]}50` : "#27272a",
                  }}
                >{p}</button>
              ))}
            </div>
          </div>

          {/* BB */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, bb: !c.bb }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.bb ? "bg-[#06b6d4]/20 border-[#06b6d4]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">Bollinger Bands</span>
            </div>
            {cfg.bb && (
              <span className="text-[9px] text-[#52525b]">{cfg.bbPeriod},{cfg.bbMult}σ</span>
            )}
          </div>

          {/* SuperTrend */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, superTrend: !c.superTrend }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.superTrend ? "bg-j-up/20 border-j-up/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">SuperTrend</span>
            </div>
            {cfg.superTrend && (
              <span className="text-[9px] text-[#52525b]">{cfg.superTrendPeriod},{cfg.superTrendMult}</span>
            )}
          </div>

          {/* KNN SuperTrend */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, knnSuperTrend: !c.knnSuperTrend }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.knnSuperTrend ? "bg-[#06b6d4]/20 border-[#06b6d4]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">KNN SuperTrend</span>
            </div>
            {cfg.knnSuperTrend && (
              <span className="text-[9px] text-[#52525b]">10,3</span>
            )}
          </div>

          {/* RSI */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, rsi: !c.rsi }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.rsi ? "bg-[#a855f7]/20 border-[#a855f7]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">RSI ({cfg.rsiPeriod})</span>
            </div>
          </div>

          {/* VWAP */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, vwap: !c.vwap }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.vwap ? "bg-[#f59e0b]/20 border-[#f59e0b]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">VWAP</span>
            </div>
            {cfg.vwap && <span className="text-[9px] text-[#52525b]">±1σ ±2σ</span>}
          </div>

          {/* CVD */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, cvd: !c.cvd }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.cvd ? "bg-[#06b6d4]/20 border-[#06b6d4]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">CVD</span>
            </div>
            {cfg.cvd && <span className="text-[9px] text-[#52525b]">Δ + cumul</span>}
          </div>

          {/* Nadaraya-Watson */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, nw: !c.nw }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.nw ? "bg-[#a855f7]/20 border-[#a855f7]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">N-W Envelope</span>
            </div>
            {cfg.nw && <span className="text-[9px] text-[#52525b]">h={cfg.nwBandwidth} ×{cfg.nwMult}</span>}
          </div>

          {/* MACD */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, macd: !c.macd }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.macd ? "bg-[#3b82f6]/20 border-[#3b82f6]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">MACD</span>
            </div>
            {cfg.macd && (
              <span className="text-[9px] text-[#52525b]">
                {cfg.macdFast},{cfg.macdSlow},{cfg.macdSignal}
              </span>
            )}
          </div>

          {/* Stochastic RSI */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, stochRsi: !c.stochRsi }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.stochRsi ? "bg-[#06b6d4]/20 border-[#06b6d4]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">Stoch RSI</span>
            </div>
            {cfg.stochRsi && (
              <span className="text-[9px] text-[#52525b]">
                {cfg.stochRsiPeriod},{cfg.stochSmoothK},{cfg.stochSmoothD}
              </span>
            )}
          </div>

          {/* PSAR */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, psar: !c.psar }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.psar ? "bg-[#f59e0b]/20 border-[#f59e0b]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">Parabolic SAR</span>
            </div>
            {cfg.psar && (
              <span className="text-[9px] text-[#52525b]">
                {cfg.psarStep}/{cfg.psarMax}
              </span>
            )}
          </div>

          {/* Ichimoku */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, ichimoku: !c.ichimoku }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.ichimoku ? "bg-[#06b6d4]/20 border-[#06b6d4]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">Ichimoku</span>
            </div>
            {cfg.ichimoku && <span className="text-[9px] text-[#52525b]">9,26,52</span>}
          </div>

          {/* ADX */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, adx: !c.adx }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.adx ? "bg-[#f59e0b]/20 border-[#f59e0b]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">ADX + DI</span>
            </div>
            {cfg.adx && <span className="text-[9px] text-[#52525b]">{cfg.adxPeriod}</span>}
          </div>

          {/* Z-Score */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, zScore: !c.zScore }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.zScore ? "bg-[#06b6d4]/20 border-[#06b6d4]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">Z-Score</span>
            </div>
            {cfg.zScore && <span className="text-[9px] text-[#52525b]">{cfg.zScorePeriod}</span>}
          </div>

          {/* Volume Profile */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, volumeProfile: !c.volumeProfile }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.volumeProfile ? "bg-[#f59e0b]/20 border-[#f59e0b]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">Volume Profile</span>
            </div>
            {cfg.volumeProfile && <span className="text-[9px] text-[#52525b]">{cfg.volumeProfileBuckets}B</span>}
          </div>



          {/* Keltner Channels */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, keltner: !c.keltner }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.keltner ? "bg-[#06b6d4]/20 border-[#06b6d4]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">Keltner Ch.</span>
            </div>
            {cfg.keltner && (
              <span className="text-[9px] text-[#52525b]">
                {cfg.keltnerEma}/{cfg.keltnerAtr}×{cfg.keltnerMult}
              </span>
            )}
          </div>

          {/* Donchian Channels */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, donchian: !c.donchian }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.donchian ? "bg-[#a855f7]/20 border-[#a855f7]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">Donchian Ch.</span>
            </div>
            {cfg.donchian && <span className="text-[9px] text-[#52525b]">{cfg.donchianPeriod}</span>}
          </div>

          {/* TTM Squeeze */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setCfg((c) => ({ ...c, ttmSqueeze: !c.ttmSqueeze }))}
                className={cn("w-3 h-3 rounded-sm border flex-shrink-0 transition-colors",
                  cfg.ttmSqueeze ? "bg-[#f59e0b]/20 border-[#f59e0b]/50" : "border-[#27272a]")} />
              <span className="text-[10px] text-[#a1a1aa]">TTM Squeeze</span>
            </div>
            {cfg.ttmSqueeze && (
              <span className="text-[9px] text-[#52525b]">
                {cfg.ttmSqPeriod},{cfg.ttmSqBBMult}/{cfg.ttmSqKMult}
              </span>
            )}
          </div>

          <div className="border-t border-[#27272a] mt-2 pt-2">
            <button onClick={() => setCfg(DEFAULTS)}
              className="text-[9px] text-[#52525b] hover:text-[#f4f4f5]">reset all</button>
          </div>
        </div>
      )}
    </div>
  );
}

export { EMA_COLORS, SMA_COLORS };
