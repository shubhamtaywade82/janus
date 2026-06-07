import { useState, useEffect, useCallback, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { ExitSignalToast } from "@/components/ExitSignalToast";
import { RegimeIndicator } from "@/components/RegimeIndicator";
import { RiskStatus } from "@/components/RiskStatus";
import { AutoTraderPanel } from "@/components/AutoTraderPanel";
import { LlmActivityFeed } from "@/components/LlmActivityFeed";
import { ChartOverlayPanel } from "@/components/ChartOverlayPanel";
import type { OverlayToggles } from "@/components/ChartOverlayPanel";
import { IndicatorPanel } from "@/components/IndicatorPanel";
import { AlertConfigPanel } from "@/components/AlertConfigPanel";
import type { IndicatorConfig } from "@/components/IndicatorPanel";
import { MiniChart } from "@/components/MiniChart";
import { OrderBook } from "@/components/OrderBook";
import { RecentTrades } from "@/components/RecentTrades";
import { TickerStrip } from "@/components/TickerStrip";

const Dashboard = () => {
  const [selectedSymbol, setSelectedSymbol] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("janus_selected_symbol") || "BTCUSDT";
    }
    return "BTCUSDT";
  });

  const [overlayToggles, setOverlayToggles] = useState<OverlayToggles>(() => {
    const saved = localStorage.getItem("janus_overlay_toggles");
    return saved ? JSON.parse(saved) : {
      orderBlocks: true, fvgs: true, structure: true, liquidity: true,
      sessions: true, swings: false, displacement: false, crosshairTooltip: true,
      obv: false, sweepMarkers: true,
    };
  });

  const [indicatorCfg, setIndicatorCfg] = useState<IndicatorConfig | null>(() => {
    const saved = localStorage.getItem("janus_indicator_cfg");
    return saved ? JSON.parse(saved) : {
      ema: [21, 50], sma: [], bb: false, bbPeriod: 20, bbMult: 2,
      superTrend: true, superTrendPeriod: 10, superTrendMult: 3,
      knnSuperTrend: false, rsi: false, rsiPeriod: 14, vwap: false,
      cvd: false, macd: false, macdFast: 12, macdSlow: 26, macdSignal: 9,
      nw: false, nwBandwidth: 8, nwMult: 3, stochRsi: false,
      stochRsiPeriod: 14, stochSmoothK: 3, stochSmoothD: 3,
      psar: false, psarStep: 0.02, psarMax: 0.2, ichimoku: false,
      adx: false, adxPeriod: 14, zScore: false, zScorePeriod: 20,
      volumeProfile: false, volumeProfileBuckets: 50, keltner: false,
      keltnerEma: 20, keltnerAtr: 20, keltnerMult: 2,
      donchian: false, donchianPeriod: 20, ttmSqueeze: false,
      ttmSqPeriod: 20, ttmSqBBMult: 2, ttmSqKMult: 1.5,
    };
  });

  useEffect(() => { localStorage.setItem("janus_selected_symbol", selectedSymbol); }, [selectedSymbol]);
  useEffect(() => { localStorage.setItem("janus_overlay_toggles", JSON.stringify(overlayToggles)); }, [overlayToggles]);
  useEffect(() => { localStorage.setItem("janus_indicator_cfg", JSON.stringify(indicatorCfg)); }, [indicatorCfg]);

  const [interval] = useState("1m");
  const { data: klines } = trpc.market.klines.useQuery({ symbol: selectedSymbol, interval, limit: 500 });
  const { data: positions } = trpc.trading.positions.useQuery({ status: "open" }, { refetchInterval: 5000 });
  const { data: ticker24h } = trpc.market.ticker24h.useQuery({});

  const tickerData = useMemo(
    () => (Array.isArray(ticker24h) ? ticker24h.find((t) => t.symbol === selectedSymbol) : undefined),
    [ticker24h, selectedSymbol]
  );
  const activePositions = useMemo(() => positions?.filter((p) => p.symbol === selectedSymbol) || [], [positions, selectedSymbol]);

  const [liquidityEvents, setLiquidityEvents] = useState<any[]>([]);
  const onLiquidityEvent = useCallback((ev: any) => { setLiquidityEvents((prev) => [ev, ...prev].slice(0, 50)); }, []);

  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-[#f4f4f5] overflow-hidden select-none">
      <TickerStrip activeSymbol={selectedSymbol} onSelectSymbol={setSelectedSymbol} />
      
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Monitoring */}
        <div className="w-80 flex flex-col border-r border-[#27272a] bg-[#09090b]">
          <div className="p-3 border-b border-[#27272a]"><RegimeIndicator symbol={selectedSymbol} /></div>
          <div className="flex-1 overflow-y-auto scrollbar-thin"><LlmActivityFeed /></div>
          <div className="p-3 border-t border-[#27272a]"><AutoTraderPanel userId={1} /></div>
          <div className="p-3 border-t border-[#27272a]"><RiskStatus userId={1} /></div>
        </div>

        {/* Center: Chart */}
        <div className="flex-1 flex flex-col min-w-0 bg-black">
          <div className="flex-1 relative">
            <MiniChart 
              data={klines || []} 
              positions={activePositions} 
              lastPrice={tickerData ? parseFloat(tickerData.lastPrice) : 0} 
              symbol={selectedSymbol} 
              interval={interval}
              overlayToggles={overlayToggles}
              indicatorCfg={indicatorCfg}
              liquidityEvents={liquidityEvents}
            />
          </div>
        </div>

        {/* Right Sidebar: Orderbook & Config */}
        <div className="w-80 flex flex-col border-l border-[#27272a] bg-[#09090b]">
          <div className="flex-1 flex flex-col overflow-hidden border-b border-[#27272a]">
            <div className="flex-1 overflow-hidden">
              <OrderBook 
                symbol={selectedSymbol} 
                tickerData={tickerData} 
                liquidityEvents={liquidityEvents} 
                onLiquidityEvent={onLiquidityEvent} 
              />
            </div>
            <div className="h-64 border-t border-[#27272a]">
              <RecentTrades symbol={selectedSymbol} />
            </div>
          </div>
          <div className="h-[35%] overflow-y-auto scrollbar-thin p-3 space-y-4">
            <ChartOverlayPanel onChange={setOverlayToggles} />
            <IndicatorPanel onChange={setIndicatorCfg} />
            <AlertConfigPanel onChange={() => {}} />
          </div>
        </div>
      </div>
      <ExitSignalToast userId={1} />
    </div>
  );
};

export default Dashboard;
