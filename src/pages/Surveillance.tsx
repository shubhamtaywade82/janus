import React, { useState } from "react";
import { 
  TrendingUp, 
  Activity, 
  Layers, 
  Zap, 
  Cpu, 
  Crosshair, 
  Gauge, 
  TrendingDown
} from "lucide-react";

// Types for Watchlist Items
interface WatchlistItem {
  symbol: string;
  timeframe: string;
  context: string;
  contextStatus: "ACTIVE" | "SHORT" | "FLAT" | "EQH" | "HLP";
  description: string;
  active: boolean;
}

export default function Surveillance() {
  // Simulator State: "long" or "short"
  const [tradeDirection, setTradeDirection] = useState<"long" | "short">("long");
  // Watchlist Items
  const [selectedSymbol, setSelectedSymbol] = useState("BTC/USDT");

  const watchlist: WatchlistItem[] = [
    {
      symbol: "BTC/USDT",
      timeframe: "1h",
      context: tradeDirection === "long" ? "ACTIVE" : "SHORT",
      contextStatus: tradeDirection === "long" ? "ACTIVE" : "SHORT",
      description: "Active Hard Timeframe & 1H & Timeframe Tracks",
      active: selectedSymbol === "BTC/USDT",
    },
    {
      symbol: "BTC/USDT",
      timeframe: "1h",
      context: "HLP",
      contextStatus: "HLP",
      description: "Active Timeframe [cite: HLP]",
      active: false,
    },
    {
      symbol: "ETH/USDT",
      timeframe: "15M",
      context: "EQH",
      contextStatus: "EQH",
      description: "Active Timeframe [cite: EQH]",
      active: selectedSymbol === "ETH/USDT",
    },
    {
      symbol: "SOL/USDT",
      timeframe: "1H",
      context: "FLAT",
      contextStatus: "FLAT",
      description: "Active Timeframe [cite: FLAT]",
      active: selectedSymbol === "SOL/USDT",
    },
  ];

  // Prices and details based on direction
  const btcPrice = tradeDirection === "long" ? 64800 : 69420;
  const targetPrice = tradeDirection === "long" ? 69420 : 64800;
  const stopLoss = tradeDirection === "long" ? 64750 : 69500;
  const liquidation = tradeDirection === "long" ? 61500 : 72200;

  // Render SVG Candlesticks for 1H Multi-Timeframe Matrix Context
  const render1HCandles = () => {
    // Generate simple candles for visualization
    const candles = tradeDirection === "long" 
      ? [
          { o: 63000, h: 63800, l: 62800, c: 63500 },
          { o: 63500, h: 64200, l: 63200, c: 64000 },
          { o: 64000, h: 65100, l: 63900, c: 64900 },
          { o: 64900, h: 65000, l: 63200, c: 63500 },
          { o: 63500, h: 63800, l: 61800, c: 62200 },
          { o: 62200, h: 63000, l: 61200, c: 61500 },
          { o: 61500, h: 63500, l: 61400, c: 62800 },
          { o: 62800, h: 63200, l: 61000, c: 61200 },
          { o: 61200, h: 61800, l: 60100, c: 60500 },
          { o: 60500, h: 61800, l: 59800, c: 61400 },
          { o: 61400, h: 62200, l: 60800, c: 62000 },
        ]
      : [
          { o: 65000, h: 65800, l: 64800, c: 65500 },
          { o: 65500, h: 66800, l: 65200, c: 66200 },
          { o: 66200, h: 67200, l: 65900, c: 67000 },
          { o: 67000, h: 68500, l: 66800, c: 68200 },
          { o: 68200, h: 69200, l: 67900, c: 68900 },
          { o: 68900, h: 69800, l: 68200, c: 69400 },
          { o: 69400, h: 70200, l: 68800, c: 69100 },
          { o: 69100, h: 69500, l: 67800, c: 68200 },
          { o: 68200, h: 68500, l: 66200, c: 66800 },
          { o: 66800, h: 67500, l: 65400, c: 65900 },
          { o: 65900, h: 66200, l: 64500, c: 64800 },
        ];

    // Coordinate conversion helper
    const minVal = 58000;
    const maxVal = 71000;
    const height = 280;
    const scaleY = (val: number) => height - ((val - minVal) / (maxVal - minVal)) * height;

    return (
      <svg className="w-full h-[320px] bg-[#0c0d10]" viewBox="0 0 500 320">
        {/* Grid lines */}
        {[60000, 62000, 64000, 66000, 68000, 70000].map((level) => (
          <line
            key={level}
            x1="10"
            y1={scaleY(level)}
            x2="450"
            y2={scaleY(level)}
            stroke="#1a1c23"
            strokeDasharray="2 3"
          />
        ))}

        {/* Zones */}
        {/* Equal Highs Zone */}
        <rect
          x="15"
          y={scaleY(70200)}
          width="420"
          height={scaleY(68600) - scaleY(70200)}
          fill="#d97706"
          fillOpacity="0.12"
          stroke="#d97706"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <text x="30" y={scaleY(69850)} fill="#d97706" className="text-[9px] font-bold font-mono">
          [cite: DB] HISTORICAL EQUAL HIGHS (HLP) $69,420
        </text>
        <line x1="15" y1={scaleY(69420)} x2="435" y2={scaleY(69420)} stroke="#d97706" strokeWidth="1.5" />
        <text x="350" y={scaleY(69420) - 4} fill="#d97706" className="text-[10px] font-bold font-mono">$69,420</text>

        {/* Swing Low Zone */}
        <rect
          x="15"
          y={scaleY(65200)}
          width="420"
          height={scaleY(63600) - scaleY(65200)}
          fill="#d97706"
          fillOpacity="0.12"
          stroke="#d97706"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <text x="30" y={scaleY(64600)} fill="#d97706" className="text-[9px] font-bold font-mono">
          [cite: DB] SWING LOW (LLP) $64,800
        </text>
        <line x1="15" y1={scaleY(64800)} x2="435" y2={scaleY(64800)} stroke="#f43f5e" strokeWidth="1.5" />
        <text x="400" y={scaleY(64800) - 4} fill="#f43f5e" className="text-[10px] font-bold font-mono">SLO</text>

        {/* Candlesticks */}
        {candles.map((c, idx) => {
          const x = 30 + idx * 36;
          const isGreen = c.c >= c.o;
          const strokeColor = isGreen ? "#0ecb81" : "#f6465d";
          const fillColor = isGreen ? "#0ecb81" : "#f6465d";

          return (
            <g key={idx}>
              {/* Wick */}
              <line
                x1={x + 10}
                y1={scaleY(c.h)}
                x2={x + 10}
                y2={scaleY(c.l)}
                stroke={strokeColor}
                strokeWidth="1.5"
              />
              {/* Body */}
              <rect
                x={x + 3}
                y={scaleY(Math.max(c.o, c.c))}
                width="14"
                height={Math.max(2, Math.abs(scaleY(c.o) - scaleY(c.c)))}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth="1"
              />
            </g>
          );
        })}

        {/* Annotations */}
        {/* Pointer 1 */}
        <path d="M 120 40 L 160 50" stroke="#a1a1aa" strokeWidth="0.8" fill="none" />
        <circle cx="160" cy="50" r="2" fill="#a1a1aa" />
        <text x="165" y="53" fill="#ffffff" className="text-[8px] font-mono font-medium">
          historical liquidity pools
        </text>

        {/* Vertical pill container */}
        <rect
          x="220"
          y="25"
          width="16"
          height="220"
          rx="8"
          fill="#000000"
          fillOpacity="0.8"
          stroke="#ffffff"
          strokeWidth="0.8"
        />
        <text
          x="231"
          y="135"
          fill="#ffffff"
          className="text-[7.5px] font-mono"
          transform="rotate(-90 231 135)"
          textAnchor="middle"
        >
          [cite: KRONOS 1H Context Limit: ~21 Days / 512 Tokens]
        </text>

        {/* Pointer 2 */}
        <path d="M 200 170 L 230 180" stroke="#a1a1aa" strokeWidth="0.8" fill="none" />
        <circle cx="230" cy="180" r="2" fill="#a1a1aa" />
        <text x="110" y="195" fill="#a1a1aa" className="text-[8.5px] font-mono leading-none">
          [cite: DB] liquidity pools
        </text>
        <text x="110" y="205" fill="#a1a1aa" className="text-[8.5px] font-mono leading-none">
          by PostgreSQL database
        </text>

        {/* Bottom arrow annotation */}
        {tradeDirection === "long" ? (
          <>
            <path d="M 180 250 L 210 235" stroke="#ffffff" strokeWidth="0.8" fill="none" />
            <polygon points="210,235 204,234 207,239" fill="#ffffff" />
            <text x="120" y="270" fill="#ffffff" className="text-[8.5px] font-mono text-center">
              Recent price piercing just below the SLO
            </text>
            <text x="150" y="280" fill="#ffffff" className="text-[8.5px] font-mono text-center">
              and reversing hard
            </text>
          </>
        ) : (
          <>
            <path d="M 180 90 L 210 105" stroke="#ffffff" strokeWidth="0.8" fill="none" />
            <polygon points="210,105 207,101 204,106" fill="#ffffff" />
            <text x="120" y="75" fill="#ffffff" className="text-[8.5px] font-mono text-center">
              Recent price piercing just above the HLP
            </text>
            <text x="150" y="65" fill="#ffffff" className="text-[8.5px] font-mono text-center">
              and reversing hard
            </text>
          </>
        )}

        {/* Price labels right axis */}
        <g transform="translate(452, 0)">
          <text x="5" y={scaleY(70000)} fill="#71717a" className="text-[8px] font-mono">$70,000</text>
          <text x="5" y={scaleY(69420)} fill="#d97706" className="text-[8px] font-mono font-bold">$69,420</text>
          <text x="5" y={scaleY(68000)} fill="#71717a" className="text-[8px] font-mono">$68,000</text>
          <text x="5" y={scaleY(66000)} fill="#71717a" className="text-[8px] font-mono">$66,000</text>
          <text x="5" y={scaleY(64800)} fill="#f43f5e" className="text-[8px] font-mono font-bold">$64,800</text>
          <text x="5" y={scaleY(64000)} fill="#71717a" className="text-[8px] font-mono">$64,000</text>
          <text x="5" y={scaleY(62000)} fill="#71717a" className="text-[8px] font-mono">$62,000</text>
          <text x="5" y={scaleY(60000)} fill="#71717a" className="text-[8px] font-mono">$60,000</text>
        </g>
      </svg>
    );
  };

  // Render SVG Candlesticks for 15M Detailed Liquidity Raid Analysis
  const render15MCandles = () => {
    // Generate simple candles for visualization
    const candles = tradeDirection === "long" 
      ? [
          { o: 65400, h: 65600, l: 65000, c: 65100 },
          { o: 65100, h: 65300, l: 64700, c: 64850 },
          { o: 64850, h: 65100, l: 64400, c: 64500 },
          { o: 64500, h: 64700, l: 63900, c: 64100 },
          { o: 64100, h: 64300, l: 63500, c: 63650 },
          { o: 63650, h: 64800, l: 63400, c: 64500 },
          { o: 64500, h: 65400, l: 64300, c: 65200 },
        ]
      : [
          { o: 63600, h: 63800, l: 63200, c: 63500 },
          { o: 63500, h: 64200, l: 63400, c: 64100 },
          { o: 64100, h: 64800, l: 63950, c: 64700 },
          { o: 64700, h: 65300, l: 64500, c: 65200 },
          { o: 65200, h: 66000, l: 65050, c: 65900 },
          { o: 65900, h: 65950, l: 64800, c: 65000 },
          { o: 65000, h: 65200, l: 64300, c: 64420 },
        ];

    // Coordinate conversion helper
    const minVal = 63000;
    const maxVal = 66200;
    const height = 130;
    const scaleY = (val: number) => height - ((val - minVal) / (maxVal - minVal)) * height;

    return (
      <svg className="w-full h-[150px] bg-[#0c0d10]" viewBox="0 0 350 150">
        {/* Level Line */}
        <line
          x1="10"
          y1={scaleY(tradeDirection === "long" ? 64800 : 64420)}
          x2="310"
          y2={scaleY(tradeDirection === "long" ? 64800 : 64420)}
          stroke="#d97706"
          strokeWidth="1"
        />
        <text x="312" y={scaleY(tradeDirection === "long" ? 64800 : 64420) + 3} fill="#d97706" className="text-[8px] font-bold font-mono">
          {tradeDirection === "long" ? "SLO" : "HLP"}
        </text>
        
        {/* Level annotation */}
        <text x="15" y={scaleY(tradeDirection === "long" ? 64800 : 64420) - 4} fill="#d97706" className="text-[8px] font-mono">
          [cite: Hunt Target: ${tradeDirection === "long" ? "64,800 SLO" : "69,420 HLP"}]
        </text>

        {/* Candlesticks */}
        {candles.map((c, idx) => {
          const x = 20 + idx * 38;
          const isGreen = c.c >= c.o;
          const strokeColor = isGreen ? "#0ecb81" : "#f6465d";
          const fillColor = isGreen ? "#0ecb81" : "#f6465d";

          return (
            <g key={idx}>
              <line
                x1={x + 10}
                y1={scaleY(c.h)}
                x2={x + 10}
                y2={scaleY(c.l)}
                stroke={strokeColor}
                strokeWidth="1.2"
              />
              <rect
                x={x + 3}
                y={scaleY(Math.max(c.o, c.c))}
                width="14"
                height={Math.max(2, Math.abs(scaleY(c.o) - scaleY(c.c)))}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth="1"
              />
            </g>
          );
        })}

        {/* Reversal Arrows */}
        {tradeDirection === "long" ? (
          <>
            {/* Down arrow */}
            <path d="M 120 40 L 150 70" stroke="#ffffff" strokeWidth="1" strokeDasharray="1 1" fill="none" />
            <polygon points="150,70 144,67 147,72" fill="#ffffff" />
            
            {/* Reversal up arrow */}
            <path d="M 215 125 L 245 95" stroke="#ffffff" strokeWidth="1.2" fill="none" />
            <polygon points="245,95 239,97 243,92" fill="#ffffff" />

            {/* High vol rejection tag */}
            <path d="M 210 135 L 225 120" stroke="#a1a1aa" strokeWidth="0.8" fill="none" />
            <circle cx="210" cy="135" r="2" fill="#ffffff" />
            <text x="135" y="145" fill="#ffffff" className="text-[7px] font-mono">
              [cite: VQ Token: HighVol_Rejection]
            </text>
          </>
        ) : (
          <>
            {/* Up arrow */}
            <path d="M 100 120 L 130 90" stroke="#ffffff" strokeWidth="1" strokeDasharray="1 1" fill="none" />
            <polygon points="130,90 124,93 127,88" fill="#ffffff" />

            {/* Reversal down arrow */}
            <path d="M 195 40 L 225 70" stroke="#ffffff" strokeWidth="1.2" fill="none" />
            <polygon points="225,70 219,67 222,72" fill="#ffffff" />

            {/* High vol rejection tag */}
            <path d="M 185 30 L 200 45" stroke="#a1a1aa" strokeWidth="0.8" fill="none" />
            <circle cx="185" cy="30" r="2" fill="#ffffff" />
            <text x="155" y="20" fill="#ffffff" className="text-[7px] font-mono">
              [cite: VQ Token: HighVol_Rejection]
            </text>
          </>
        )}

        {/* Right scale */}
        <g transform="translate(315, 0)">
          <text x="2" y={scaleY(66000)} fill="#71717a" className="text-[7.5px] font-mono">$66,000</text>
          <text x="2" y={scaleY(65000)} fill="#71717a" className="text-[7.5px] font-mono">$65,000</text>
          <text x="2" y={scaleY(64000)} fill="#71717a" className="text-[7.5px] font-mono">$64,000</text>
          <text x="2" y={scaleY(63000)} fill="#71717a" className="text-[7.5px] font-mono">$63,000</text>
        </g>
      </svg>
    );
  };

  // Render Monte Carlo Paths (SVG curves)
  const renderMonteCarlo = () => {
    const paths = Array.from({ length: 30 });
    const width = 230;
    const height = 100;

    return (
      <svg className="w-full h-[100px] bg-[#0c0d10]" viewBox="0 0 250 110">
        {/* Draw multiple path lines */}
        {paths.map((_, idx) => {
          // Generate a curve path
          const offsetSeed = (idx - 15) / 15; // -1.0 to 1.0
          const startY = height / 2 + 10;
          const midY = tradeDirection === "long" 
            ? height / 2 + 15 + offsetSeed * 12 
            : height / 2 + 5 + offsetSeed * 12;
          const endY = tradeDirection === "long"
            ? height / 2 - 25 + offsetSeed * 25 + (idx % 2 === 0 ? 5 : -5)
            : height / 2 + 45 + offsetSeed * 25 + (idx % 2 === 0 ? 5 : -5);

          const pathD = `M 10 ${startY} Q ${width * 0.4} ${midY} ${width} ${endY}`;
          
          // Color coding for paths: green-yellow-cyan for UP, red-orange-pink for DOWN
          const strokeColor = tradeDirection === "long"
            ? `hsl(${100 + idx * 2}, 75%, ${40 + (idx % 4) * 8}%)`
            : `hsl(${10 + idx * 2}, 80%, ${45 + (idx % 4) * 8}%)`;

          return (
            <path
              key={idx}
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth="0.8"
              opacity="0.6"
            />
          );
        })}

        {/* Labels & Details */}
        <text x="120" y="80" fill="#a1a1aa" className="text-[8px] font-mono text-center font-bold" textAnchor="middle">
          [cite: Monte Carlo Path
        </text>
        <text x="120" y="90" fill="#a1a1aa" className="text-[8px] font-mono text-center font-bold" textAnchor="middle">
          Convergence: REVERSAL SIGNAL]
        </text>

        {tradeDirection === "long" ? (
          <text x="10" y="105" fill="#0ecb81" className="text-[8.5px] font-mono font-bold">
            REVERSAL INTENT: STRONG (UP)
          </text>
        ) : (
          <text x="10" y="105" fill="#f6465d" className="text-[8.5px] font-mono font-bold">
            REVERSAL INTENT: STRONG (DOWN)
          </text>
        )}
      </svg>
    );
  };

  // Render Confluence Speedometer Arc Gauge
  const renderConfluenceGauge = () => {
    const score = 88.75;
    // Radial calculation: Arc from -180deg to 0deg (left to right)
    // Radius = 50, Center = (70, 65)
    // Needle angle: -180 + (88.75 / 100) * 180 = -180 + 159.75 = -20.25deg
    const angleRad = ((-180 + (score / 100) * 180) * Math.PI) / 180;
    const needleX = 70 + Math.cos(angleRad) * 45;
    const needleY = 65 + Math.sin(angleRad) * 45;

    return (
      <svg className="w-[140px] h-[95px] mx-auto bg-transparent" viewBox="0 0 140 85">
        {/* Background Arc */}
        <path
          d="M 20 65 A 50 50 0 0 1 120 65"
          fill="none"
          stroke="#1f222b"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* Value Arc */}
        <path
          d={`M 20 65 A 50 50 0 0 1 ${70 + Math.cos(angleRad) * 50} ${65 + Math.sin(angleRad) * 50}`}
          fill="none"
          stroke={tradeDirection === "long" ? "#0ecb81" : "#d97706"}
          strokeWidth="10"
          strokeLinecap="round"
        />

        {/* Go indicator text */}
        <text x="110" y="25" fill={tradeDirection === "long" ? "#0ecb81" : "#f6465d"} className="text-[9px] font-mono font-black">
          {tradeDirection === "long" ? "go" : "gated"}
        </text>

        {/* Needle */}
        <line
          x1="70"
          y1="65"
          x2={needleX}
          y2={needleY}
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="70" cy="65" r="4" fill="#ffffff" />

        {/* Score texts */}
        <text x="70" y="80" fill="#ffffff" className="text-[8px] font-mono font-bold" textAnchor="middle">
          CONFLUENCE-75
        </text>
        <text x="70" y="88" fill="#ffffff" className="text-[8.5px] font-mono font-bold" textAnchor="middle">
          {tradeDirection === "long" ? "GATEWAY" : "SHORT"}
        </text>
      </svg>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#09090b] text-[#f4f4f5] font-mono text-xs select-none">
      
      {/* Simulation & Context Controller Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-[#121318] border-b border-[#27272a] gap-4">
        <div className="flex items-center gap-2">
          <Layers className="text-j-up w-4 h-4 animate-pulse" />
          <span className="font-black text-sm tracking-wide bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
            KRONOS ACTIVE SURVEILLANCE TERMINAL
          </span>
        </div>
        
        {/* Toggle Controls */}
        <div className="flex items-center gap-2">
          <span className="text-zinc-400 text-[10px] uppercase font-bold tracking-wider mr-2">Simulate Reversal Regime:</span>
          
          <button
            onClick={() => setTradeDirection("long")}
            className={`px-3 py-1 rounded text-[10px] font-bold transition-all flex items-center gap-1.5 border ${
              tradeDirection === "long"
                ? "bg-j-up/20 text-j-up border-j-up shadow-[0_0_10px_rgba(14,203,129,0.15)]"
                : "bg-transparent text-zinc-500 border-zinc-800 hover:text-zinc-300"
            }`}
          >
            <TrendingUp size={12} />
            Bullish (Long)
          </button>
          
          <button
            onClick={() => setTradeDirection("short")}
            className={`px-3 py-1 rounded text-[10px] font-bold transition-all flex items-center gap-1.5 border ${
              tradeDirection === "short"
                ? "bg-j-down/20 text-j-down border-j-down shadow-[0_0_10px_rgba(246,70,93,0.15)]"
                : "bg-transparent text-zinc-500 border-zinc-800 hover:text-zinc-300"
            }`}
          >
            <TrendingDown size={12} />
            Bearish (Short)
          </button>
        </div>
      </div>

      {/* Cyber Window Frame Title-bar */}
      <div className="bg-[#0f1115] text-[#71717a] px-4 py-1.5 border-b border-white/[0.04] text-[10px] font-mono flex justify-between items-center flex-shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-zinc-300 font-bold">[JANUS-ENGINE]</span>
          <span>WATCHLIST: BTC/USDT | ETH/USDT | SOL/USDT :: ACTIVE SURVEILLANCE ::</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.2 bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20 rounded text-[9px]">
            [cite: HP Omen i7, 8GB VRAM - KRONOS SIDE-CAR ACTIVE]
          </span>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Watchlist Sidebar (Left) */}
        <div className="w-64 bg-[#0a0b0e] border-r border-[#1a1c23] flex flex-col flex-shrink-0 select-none">
          <div className="px-3 py-2 bg-[#12141a] border-b border-[#1a1c23] text-zinc-400 font-bold text-[9px] tracking-wider uppercase">
            Active Surveillance Scope
          </div>
          
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {watchlist.map((item, idx) => (
              <div
                key={idx}
                onClick={() => {
                  if (item.symbol === "BTC/USDT" || item.symbol === "ETH/USDT" || item.symbol === "SOL/USDT") {
                    setSelectedSymbol(item.symbol);
                  }
                }}
                className={`p-3 border-b border-white/[0.03] transition-all cursor-pointer relative ${
                  item.active 
                    ? "bg-[#161821]/80 border-l-2 border-l-j-up" 
                    : "hover:bg-white/[0.01]"
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-white text-[11px]">{item.symbol}</span>
                    <span className="text-[9px] text-[#71717a] px-1 bg-[#1a1d24] rounded">{item.timeframe}</span>
                  </div>
                  
                  {/* Context Badge */}
                  <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-black ${
                    item.contextStatus === "ACTIVE" 
                      ? "bg-j-up/10 text-j-up border border-j-up/20"
                      : item.contextStatus === "SHORT"
                      ? "bg-j-down/10 text-j-down border border-j-down/20"
                      : "bg-[#1e2029] text-[#a1a1aa]"
                  }`}>
                    {item.context}
                  </span>
                </div>
                
                <div className="text-[9px] text-zinc-500 truncate font-mono">
                  {item.description}
                </div>

                {/* Big Context display overlay inside the selected active container */}
                {item.active && item.symbol === "BTC/USDT" && (
                  <div className="mt-3 py-2 px-3 bg-black/40 rounded border border-white/[0.04] flex flex-col items-center justify-center">
                    <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">Context:</span>
                    <span className={`text-xl font-black tracking-widest ${
                      tradeDirection === "long" ? "text-j-up" : "text-j-down"
                    }`}>
                      {tradeDirection === "long" ? "ACTIVE" : "SHORT"}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
          
          <div className="p-3 bg-[#0a0b0e] border-t border-[#1a1c23] flex flex-col gap-1">
            <span className="text-[8px] text-[#71717a] uppercase font-bold">Scanning Engine State</span>
            <div className="flex items-center gap-1.5 text-[9px] text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-j-up animate-ping" />
              <span>Real-Time Stream Active</span>
            </div>
          </div>
        </div>

        {/* Dashboard Grid Panel (Right) */}
        <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto scrollbar-thin bg-[#09090b]">
          
          {/* Top Charts Row */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            
            {/* 1H Chart Panel (col-span-7) */}
            <div className="xl:col-span-7 bg-[#0c0d10] border border-[#1a1c23] rounded-lg p-3 flex flex-col">
              <div className="flex justify-between items-center mb-2 border-b border-white/[0.04] pb-2">
                <span className="font-bold text-[11px] text-zinc-200 flex items-center gap-2">
                  <Activity size={12} className="text-j-up" />
                  1H Multi-Timeframe Matrix Context ({selectedSymbol})
                </span>
                <span className="text-[9px] text-[#71717a] font-mono">USDT</span>
              </div>
              
              {/* Candlestick Visualization */}
              <div className="flex-1 flex items-center justify-center">
                {render1HCandles()}
              </div>
            </div>

            {/* 15M Chart & Multi-Widgets Panel (col-span-5) */}
            <div className="xl:col-span-5 flex flex-col gap-4">
              
              {/* 15M Chart Panel */}
              <div className="bg-[#0c0d10] border border-[#1a1c23] rounded-lg p-3 flex flex-col flex-1">
                <div className="flex justify-between items-center mb-2 border-b border-white/[0.04] pb-2">
                  <span className="font-bold text-[11px] text-zinc-200 flex items-center gap-2">
                    <Crosshair size={12} className="text-j-up" />
                    15M Detailed Liquidity Raid Analysis for {selectedSymbol}
                  </span>
                  <span className="text-[9px] font-mono text-zinc-500">15M Candle View</span>
                </div>
                
                <div className="flex-1 flex items-center justify-center">
                  {render15MCandles()}
                </div>
              </div>

            </div>

          </div>

          {/* Bottom Indicators Row */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            
            {/* Monte Carlo Visualizer (col-span-6) */}
            <div className="md:col-span-6 bg-[#0c0d10] border border-[#1a1c23] rounded-lg p-3 flex flex-col">
              <div className="flex justify-between items-center mb-2 border-b border-white/[0.04] pb-2">
                <span className="font-bold text-[11px] text-zinc-200 flex items-center gap-2">
                  <Cpu size={12} className="text-j-purple" />
                  Kronos AI Monte Carlo Reversal Visualizer
                </span>
                <span className="text-[9px] font-mono text-zinc-500">30 multi-path simulations</span>
              </div>
              
              <div className="flex-1 flex flex-col justify-center">
                <div className="text-[9.5px] text-[#71717a] mb-1">
                  Specialized visualization of convergence paths for trade entry
                </div>
                {renderMonteCarlo()}
              </div>
            </div>

            {/* Confluence Scorecard (col-span-6) */}
            <div className="md:col-span-6 bg-[#0c0d10] border border-[#1a1c23] rounded-lg p-3 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center mb-2 border-b border-white/[0.04] pb-2">
                  <span className="font-bold text-[11px] text-zinc-200 flex items-center gap-2">
                    <Gauge size={12} className="text-j-up" />
                    Janus Confluence Scorecard (The Gateway)
                  </span>
                  <span className="text-[9px] font-mono text-zinc-500">confluence system</span>
                </div>
                
                <div className="flex flex-row items-center gap-4">
                  {/* Gauge */}
                  <div className="flex-shrink-0">
                    {renderConfluenceGauge()}
                  </div>
                  
                  {/* Score Info list */}
                  <div className="flex-1 flex flex-col gap-1.5 text-[9px] leading-tight text-zinc-300">
                    <div>
                      <span className="text-zinc-500">Micro (S<sub>Micro</sub>):</span>{" "}
                      <span className="text-j-up font-bold">70</span>{" "}
                      <span className="text-[#71717a] font-mono">(Volume sweep confirmed via L2)</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Intraday (S<sub>Intraday</sub>):</span>{" "}
                      <span className="text-j-up font-bold">95</span>{" "}
                      <span className="text-[#71717a] font-mono">(Kronos path bunching, high confidence)</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Swing (S<sub>Swing</sub>):</span>{" "}
                      <span className="text-j-up font-bold">100</span>{" "}
                      <span className="text-[#71717a] font-mono">(Historical level sweep, verified via DB)</span>
                    </div>
                    
                    <div className="mt-1.5 pt-1.5 border-t border-white/[0.04] flex justify-between items-center">
                      <div>
                        <span className="text-zinc-400 font-bold uppercase text-[8.5px]">Composite Score:</span>{" "}
                        <span className="text-[#0ecb81] font-bold text-[11px]">88.75</span>
                      </div>
                      <span className="text-j-up font-bold text-[8px] bg-j-up/10 px-1 py-0.2 border border-j-up/25 rounded">
                        [cite: AUTHORIZED]
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Execution Info Box */}
              <div className="mt-3 pt-3 border-t border-white/[0.04]">
                <div className="bg-black/60 p-2.5 rounded border border-white/[0.04] flex flex-col gap-1">
                  <div className="text-[8.5px] text-zinc-400 font-mono flex flex-wrap gap-x-2 gap-y-1">
                    <span className="text-zinc-300 font-bold">[cite: RISK_MANAGER_VALIDATED]</span>
                    <span>•</span>
                    <span>LEVERAGE: <span className="text-white font-bold">5X</span></span>
                    <span>•</span>
                    <span>STOP: <span className="text-[#f43f5e] font-bold">${stopLoss.toLocaleString()}</span></span>
                    <span className="text-[8px] text-[#71717a] font-mono">[cite: 1 TI above Wick]</span>
                    <span>•</span>
                    <span>LIQUIDATION: <span className="text-zinc-300">${liquidation.toLocaleString()}</span></span>
                    <span className="text-[8px] text-[#71717a] font-mono">[cite: 2x Buffer Invariant]</span>
                  </div>
                  
                  <div className={`text-[10px] font-black tracking-wider uppercase mt-1 flex items-center gap-1.5 ${
                    tradeDirection === "long" ? "text-[#0ecb81]" : "text-[#f6465d]"
                  }`}>
                    <span className="w-2 h-2 rounded-full bg-current animate-ping" />
                    <span>
                      EXECUTING {tradeDirection === "long" ? "LONG" : "SHORT"} ENTRY PAYLOAD -{">"} COINDCX-B-BTC_USDT
                    </span>
                  </div>
                </div>
              </div>

            </div>

          </div>

        </div>

      </div>

      {/* Bottom Status bar */}
      <div className="bg-[#0b0c10] border-t border-[#1a1c23] px-4 py-2 text-[10px] text-[#71717a] font-mono flex flex-col md:flex-row justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold text-zinc-300">Active Watchlist Overview</span>
          
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${tradeDirection === "long" ? "bg-j-up" : "bg-j-down"}`} />
            <span className="text-zinc-400">BTC/USDT 1H [cite: {tradeDirection === "long" ? "HLP" : "SHORT"}]</span>
          </div>

          <div className="h-3 w-px bg-white/[0.06]" />

          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-zinc-600" />
            <span className="text-zinc-500">ETH/USDT 15M [cite: EQH]</span>
          </div>

          <div className="h-3 w-px bg-white/[0.06]" />

          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-zinc-600" />
            <span className="text-zinc-500">SOL/USDT 1H [cite: FLAT]</span>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <span className="text-[9px] bg-white/[0.03] px-1.5 py-0.5 rounded text-zinc-500 font-mono">
            [cite: Kronos VQ Engine]
          </span>
          <span className="text-[9px] bg-white/[0.03] px-1.5 py-0.5 rounded text-zinc-500 font-mono">
            [cite: Serial Batch Block]
          </span>
        </div>
      </div>

    </div>
  );
}
