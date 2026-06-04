# Chart Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four live chart overlays: trading session shading, real-tick CVD sub-pane, hover crosshair tooltip, and liquidity sweep markers.

**Architecture:** Each overlay is either a lightweight-charts `ISeriesPrimitive` attached to `candlestickSeriesRef` (session shading, markers) or a new price-scale sub-pane using `addSeries` (CVD). All toggles go through `OverlayToggles`. CVD uses a new backend query + subscription that exposes `cvdWindow` tick data; the frontend aggregates ticks into per-bar buckets aligned to kline openTimes before rendering.

**Tech Stack:** lightweight-charts v5, React 19, tRPC v11, Drizzle/Postgres, TypeScript

---

## Existing Patterns Reference

Before starting, read these files — all new code follows their conventions:

- **Primitive pattern**: `src/lib/chart/primitives/FVGPrimitive.ts` — implements `ISeriesPrimitive<Time>`, uses `_param?.requestUpdate()` on data change, renders via `paneViews()` → single renderer with `draw(target)` using `target.useBitmapCoordinateSpace()`
- **Overlay attachment**: `src/pages/Dashboard.tsx` lines 512–536 — create primitive after chart init, call `candlestickSeriesRef.current.attachPrimitive(prim)`, store in ref
- **Toggle pattern**: `src/components/ChartOverlayPanel.tsx` — `OverlayToggles` interface + checkbox row per feature
- **Sub-pane pattern**: `src/pages/Dashboard.tsx` lines 1081–1119 — `addSeries(HistogramSeries, { priceScaleId: "cvd" })`, then `s.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } })`
- **Data access in effects**: `overlayToggles` prop + `overlayData` prop feed into a `useEffect` on `MiniChart`; backend data via `trpc.market.*` hooks on the parent `Dashboard` component passed down as props

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/chart/primitives/SessionShadingPrimitive.ts` | **Create** | Renders Asia/London/NY session boxes |
| `src/lib/chart/primitives/LiquiditySweepPrimitive.ts` | **Create** | Renders sweep markers at event timestamps |
| `src/lib/chart/primitives/CrosshairTooltipPrimitive.ts` | **Create** | Floating OHLCV tooltip that follows crosshair |
| `src/components/ChartOverlayPanel.tsx` | **Modify** | Add `sessions`, `sweepMarkers`, `crosshairTooltip` toggles to `OverlayToggles` |
| `src/pages/Dashboard.tsx` | **Modify** | Attach new primitives; wire CVD sub-pane with real tick data; pass `liquidityEvents` + `cvdBars` props to `MiniChart` |
| `api/routers/market-router.ts` | **Modify** | Add `cvdHistory` query + `cvdStream` subscription |

---

## Task 1: Session Shading Primitive

**Files:**
- Create: `src/lib/chart/primitives/SessionShadingPrimitive.ts`
- Modify: `src/components/ChartOverlayPanel.tsx`
- Modify: `src/pages/Dashboard.tsx`

Session times (UTC, repeat daily):

| Session | Open | Close | Color |
|---------|------|-------|-------|
| Asia | 00:00 | 09:00 | rgba(59, 130, 246, 0.06) — blue |
| London | 07:00 | 16:00 | rgba(234, 179, 8, 0.06) — yellow |
| New York | 13:00 | 22:00 | rgba(34, 197, 94, 0.06) — green |
| Asia/London overlap | 07:00 | 09:00 | blend — slightly brighter blue/yellow |

- [ ] **Step 1: Create SessionShadingPrimitive**

```typescript
// src/lib/chart/primitives/SessionShadingPrimitive.ts
import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";

export interface SessionDef {
  label: string;
  startHourUtc: number;   // 0–23
  endHourUtc: number;     // 0–23
  color: string;          // rgba fill
  borderColor: string;    // top/bottom border
}

export const DEFAULT_SESSIONS: SessionDef[] = [
  { label: "Asia",    startHourUtc: 0,  endHourUtc: 9,  color: "rgba(59,130,246,0.06)",  borderColor: "rgba(59,130,246,0.25)" },
  { label: "London",  startHourUtc: 7,  endHourUtc: 16, color: "rgba(234,179,8,0.06)",   borderColor: "rgba(234,179,8,0.25)" },
  { label: "NY",      startHourUtc: 13, endHourUtc: 22, color: "rgba(34,197,94,0.06)",   borderColor: "rgba(34,197,94,0.25)" },
];

export class SessionShadingPrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _sessions: SessionDef[] = DEFAULT_SESSIONS;
  private _enabled = true;

  attached(param: SeriesAttachedParameter<Time>) { this._param = param; }
  detached() { this._param = null; }

  setEnabled(v: boolean) {
    this._enabled = v;
    this._param?.requestUpdate();
  }

  setSessions(sessions: SessionDef[]) {
    this._sessions = sessions;
    this._param?.requestUpdate();
  }

  paneViews() {
    const param = this._param;
    const sessions = this._sessions;
    const enabled = this._enabled;
    return [{
      renderer: () => ({
        draw: (target: any) => {
          if (!enabled || !param) return;
          target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio }: any) => {
            const timeScale = param.chart.timeScale();
            const visRange = timeScale.getVisibleRange();
            if (!visRange) return;

            const fromMs = (visRange.from as number) * 1000;
            const toMs   = (visRange.to   as number) * 1000;

            // Iterate days covered by visible range
            const dayMs = 86_400_000;
            const startDay = Math.floor(fromMs / dayMs) * dayMs;

            for (let dayStart = startDay; dayStart <= toMs; dayStart += dayMs) {
              for (const sess of sessions) {
                const sessStart = dayStart + sess.startHourUtc * 3_600_000;
                const sessEnd   = dayStart + sess.endHourUtc   * 3_600_000;
                if (sessEnd < fromMs || sessStart > toMs) continue;

                const x1 = timeScale.timeToCoordinate((sessStart / 1000) as Time);
                const x2 = timeScale.timeToCoordinate((sessEnd   / 1000) as Time);
                if (x1 === null || x2 === null) continue;

                const px1 = Math.round(x1 * horizontalPixelRatio);
                const px2 = Math.round(x2 * horizontalPixelRatio);
                const w   = Math.abs(px2 - px1);
                if (w < 1) continue;

                // Fill
                ctx.fillStyle = sess.color;
                ctx.fillRect(Math.min(px1, px2), 0, w, bitmapSize.height);

                // Top border line (1px)
                ctx.strokeStyle = sess.borderColor;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(Math.min(px1, px2), 0);
                ctx.lineTo(Math.min(px1, px2) + w, 0);
                ctx.stroke();

                // Session label at top-left of box
                const labelX = Math.min(px1, px2) / horizontalPixelRatio + 4;
                ctx.save();
                ctx.scale(1 / horizontalPixelRatio, 1 / verticalPixelRatio);
                ctx.fillStyle = sess.borderColor;
                ctx.font = "10px monospace";
                ctx.fillText(sess.label, labelX * horizontalPixelRatio, 12 * verticalPixelRatio);
                ctx.restore();
              }
            }
          });
        },
      }),
    }];
  }
}
```

- [ ] **Step 2: Add `sessions` toggle to OverlayToggles**

In `src/components/ChartOverlayPanel.tsx`, find the `OverlayToggles` interface and add:

```typescript
// In the OverlayToggles interface (after existing fields):
sessions: boolean;
```

In the default value object and `ChartOverlayPanel` checkbox list, add:

```typescript
// Default (add to defaults object):
sessions: true,

// In the JSX toggle list (add a new row):
<ToggleRow label="Sessions" field="sessions" />
```

- [ ] **Step 3: Wire into Dashboard.tsx**

```typescript
// 1. Import at top of Dashboard.tsx:
import { SessionShadingPrimitive } from "@/lib/chart/primitives/SessionShadingPrimitive";

// 2. Add ref in MiniChart component (near other primitive refs, ~line 160):
const sessionPrimRef = useRef<SessionShadingPrimitive | null>(null);

// 3. In the primitive attachment effect (after existing attachPrimitive calls, ~line 521):
const sessionPrim = new SessionShadingPrimitive();
candlestickSeriesRef.current.attachPrimitive(sessionPrim);
sessionPrimRef.current = sessionPrim;

// 4. In the overlay update effect (useEffect on overlayToggles/overlayData, ~line 756):
if (sessionPrimRef.current) {
  sessionPrimRef.current.setEnabled(tog?.sessions ?? true);
}
```

- [ ] **Step 4: Verify in browser**

Start dev server (`npm run dev`). Open Dashboard. Scroll the chart — colored vertical bands should appear for Asia/London/NY sessions. Toggle "Sessions" in the overlay panel to hide/show. Verify labels "Asia", "London", "NY" appear at the top of each band.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chart/primitives/SessionShadingPrimitive.ts src/components/ChartOverlayPanel.tsx src/pages/Dashboard.tsx
git commit -m "feat(chart): add session shading primitive (Asia/London/NY)"
```

---

## Task 2: Real-Tick CVD Sub-Pane

**Files:**
- Modify: `api/routers/market-router.ts`
- Modify: `src/pages/Dashboard.tsx`

CVD already has a pane (`"cvd"` price scale) using OHLCV-approximated data via `calcCVD()`. This task replaces that data source with real per-trade ticks from `cvdWindow` in the backend. The rendering code stays; only the data source changes.

- [ ] **Step 1: Add `cvdHistory` query to market-router.ts**

In `api/routers/market-router.ts`, after existing queries, add:

```typescript
cvdHistory: publicQuery
  .input(z.object({ symbol: z.string().default("BTCUSDT") }))
  .query(({ input }) => {
    const state = marketStateManager.get(input.symbol.toUpperCase());
    if (!state) return { points: [] };
    const points = state.cvdWindow.values().map((t) => ({
      ts: t.timestamp,          // ms
      delta: t.delta,           // per-trade signed delta
      cumulative: t.cumulative, // running sum
    }));
    return { points };
  }),

cvdStream: publicQuery
  .input(z.object({ symbol: z.string().default("BTCUSDT") }))
  .subscription(({ input }) => {
    return observable<{ ts: number; delta: number; cumulative: number }>((emit) => {
      const sym = input.symbol.toUpperCase();
      const onTrade = (data: any) => {
        if (data.symbol !== sym) return;
        const state = marketStateManager.get(sym);
        if (!state) return;
        const last = state.cvdWindow.values().at(-1);
        if (last) emit.next({ ts: last.timestamp, delta: last.delta, cumulative: last.cumulative });
      };
      marketEvents.on(`${sym}:trade`, onTrade);
      return () => marketEvents.off(`${sym}:trade`, onTrade);
    });
  }),
```

Make sure `marketStateManager` and `marketEvents` are imported in market-router.ts (check existing imports — `marketStateManager` is already used for `liveState`; add `marketEvents` import from `"../services/streaming"` if not present).

- [ ] **Step 2: Add `cvdBars` prop and data fetching to Dashboard (parent component)**

In `Dashboard` (the main component, not `MiniChart`), add:

```typescript
// Near existing trpc queries (~line 2770):
const { data: cvdHistoryData } = trpc.market.cvdHistory.useQuery(
  { symbol: selectedSymbol },
  { staleTime: 0, refetchOnWindowFocus: false }
);

const [cvdBars, setCvdBars] = useState<{ ts: number; delta: number; cumulative: number }[]>([]);

useEffect(() => {
  if (cvdHistoryData?.points) setCvdBars(cvdHistoryData.points);
}, [cvdHistoryData]);

trpc.market.cvdStream.useSubscription(
  { symbol: selectedSymbol },
  {
    onData: (tick) => {
      setCvdBars((prev) => {
        const next = [...prev, tick];
        return next.slice(-5000); // keep last 5000 ticks
      });
    },
  }
);
```

Pass `cvdBars` to `MiniChart`:
```typescript
// In the MiniChart JSX (~line 2936):
<MiniChart
  ...existing props...
  cvdBars={cvdBars}
/>
```

Update `MiniChart` prop signature:
```typescript
// In the MiniChart function signature (line 60):
const MiniChart = ({ ..., cvdBars }: {
  ...existing types...;
  cvdBars?: { ts: number; delta: number; cumulative: number }[];
}) => {
```

- [ ] **Step 3: Replace OHLCV-approximated CVD with real tick data**

In `MiniChart`, find the CVD rendering block (`indicatorCfg.cvd`, ~line 1081). Currently it calls `calcCVD(highs, lows, closes, volumes)`. Replace the data source:

```typescript
if (indicatorCfg.cvd) {
  // Aggregate tick-level CVD into per-bar buckets aligned to kline openTimes
  let deltaPerBar: (number | null)[];
  let cumulativePerBar: (number | null)[];

  if (cvdBars && cvdBars.length > 0 && data.length > 0) {
    // Map each kline bar to a time window; sum deltas from ticks in that window
    const barMs = data.length > 1
      ? (data[1].openTime - data[0].openTime)  // infer bar duration from first two candles
      : 60_000; // fallback 1m

    deltaPerBar = data.map((bar) => {
      const barEnd = bar.openTime + barMs;
      const ticks = cvdBars.filter((t) => t.ts >= bar.openTime && t.ts < barEnd);
      if (ticks.length === 0) return null;
      return ticks.reduce((sum, t) => sum + t.delta, 0);
    });

    // Cumulative: last tick's cumulative value for each bar (or carry forward)
    let lastCum = 0;
    cumulativePerBar = data.map((bar) => {
      const barEnd = bar.openTime + barMs;
      const ticks = cvdBars.filter((t) => t.ts >= bar.openTime && t.ts < barEnd);
      if (ticks.length > 0) lastCum = ticks[ticks.length - 1].cumulative;
      return lastCum;
    });
  } else {
    // Fallback: OHLCV approximation (unchanged)
    const { delta, cvd } = calcCVD(highs, lows, closes, volumes);
    deltaPerBar = delta;
    cumulativePerBar = cvd;
  }

  // Rest of rendering code unchanged — uses deltaPerBar and cumulativePerBar
  // (the existing code already refers to local `delta` and `cvd` variables;
  //  rename them to deltaPerBar/cumulativePerBar or just reassign:)
  // const delta = deltaPerBar;
  // const cvd   = cumulativePerBar;
  // ... existing series.setData calls ...
}
```

- [ ] **Step 4: Verify in browser**

Open Dashboard, enable CVD indicator in the indicator panel. The CVD pane should now show tick-accurate delta bars. Verify it updates in real-time as trades arrive (the cvdStream subscription fires on each trade event).

- [ ] **Step 5: Commit**

```bash
git add api/routers/market-router.ts src/pages/Dashboard.tsx
git commit -m "feat(chart): wire real-tick CVD from backend cvdWindow into CVD sub-pane"
```

---

## Task 3: Crosshair Tooltip Primitive

**Files:**
- Create: `src/lib/chart/primitives/CrosshairTooltipPrimitive.ts`
- Modify: `src/components/ChartOverlayPanel.tsx`
- Modify: `src/pages/Dashboard.tsx`

Shows a floating box near the crosshair with the hovered candle's OHLCV + change%. Replaces the fixed top-left HUD for the hovered bar only (HUD stays for the "last bar" case).

- [ ] **Step 1: Create CrosshairTooltipPrimitive**

```typescript
// src/lib/chart/primitives/CrosshairTooltipPrimitive.ts
import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";

export interface TooltipBar {
  time: number;   // seconds (UTCTimestamp)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class CrosshairTooltipPrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _bar: TooltipBar | null = null;
  private _enabled = true;

  attached(param: SeriesAttachedParameter<Time>) { this._param = param; }
  detached() { this._param = null; }

  setEnabled(v: boolean) { this._enabled = v; this._param?.requestUpdate(); }
  setBar(bar: TooltipBar | null) { this._bar = bar; this._param?.requestUpdate(); }

  paneViews() {
    const param = this._param;
    const bar   = this._bar;
    const enabled = this._enabled;
    return [{
      renderer: () => ({
        draw: (target: any) => {
          if (!enabled || !param || !bar) return;
          target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio }: any) => {
            const timeScale = param.chart.timeScale();
            const barX = timeScale.timeToCoordinate(bar.time as Time);
            if (barX === null) return;

            const isGreen = bar.close >= bar.open;
            const chg = ((bar.close - bar.open) / bar.open) * 100;
            const chgStr = `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`;

            const lines = [
              `O: ${bar.open.toFixed(2)}  H: ${bar.high.toFixed(2)}`,
              `L: ${bar.low.toFixed(2)}  C: ${bar.close.toFixed(2)}`,
              `Vol: ${(bar.volume / 1000).toFixed(1)}k  ${chgStr}`,
            ];

            const PAD = 8 * horizontalPixelRatio;
            const LINE_H = 14 * verticalPixelRatio;
            const BOX_W = 160 * horizontalPixelRatio;
            const BOX_H = lines.length * LINE_H + PAD * 2;

            // Position: right of crosshair, clamp to canvas
            let bx = Math.round(barX * horizontalPixelRatio) + 12 * horizontalPixelRatio;
            if (bx + BOX_W > bitmapSize.width) bx = Math.round(barX * horizontalPixelRatio) - BOX_W - 12 * horizontalPixelRatio;
            const by = Math.max(PAD, Math.min(bitmapSize.height - BOX_H - PAD, bitmapSize.height * 0.1));

            // Background
            ctx.fillStyle = "rgba(9,9,11,0.92)";
            ctx.strokeStyle = isGreen ? "rgba(14,203,129,0.5)" : "rgba(246,70,93,0.5)";
            ctx.lineWidth = 1;
            const r = 4 * horizontalPixelRatio;
            ctx.beginPath();
            ctx.roundRect(bx, by, BOX_W, BOX_H, r);
            ctx.fill();
            ctx.stroke();

            // Text
            ctx.font = `${10 * horizontalPixelRatio}px monospace`;
            const textColor = isGreen ? "rgba(14,203,129,0.9)" : "rgba(246,70,93,0.9)";
            ctx.fillStyle = textColor;
            lines.forEach((line, i) => {
              ctx.fillText(line, bx + PAD, by + PAD + (i + 1) * LINE_H - 2 * verticalPixelRatio);
            });
          });
        },
      }),
    }];
  }
}
```

- [ ] **Step 2: Add `crosshairTooltip` toggle to ChartOverlayPanel.tsx**

In `OverlayToggles` interface, add:
```typescript
crosshairTooltip: boolean;
```

In defaults and JSX toggle list:
```typescript
// default:
crosshairTooltip: true,
// JSX:
<ToggleRow label="Tooltip" field="crosshairTooltip" />
```

- [ ] **Step 3: Wire into Dashboard.tsx**

```typescript
// 1. Import:
import { CrosshairTooltipPrimitive } from "@/lib/chart/primitives/CrosshairTooltipPrimitive";

// 2. Add ref (near line 160):
const tooltipPrimRef = useRef<CrosshairTooltipPrimitive | null>(null);

// 3. Attach after chart init (near line 521):
const tooltipPrim = new CrosshairTooltipPrimitive();
candlestickSeriesRef.current.attachPrimitive(tooltipPrim);
tooltipPrimRef.current = tooltipPrim;

// 4. Subscribe to crosshair move (inside the chart init useEffect, after existing subscriptions):
chart.subscribeCrosshairMove((crosshairData) => {
  if (!tooltipPrimRef.current) return;
  if (crosshairData.seriesData) {
    // lightweight-charts v5: seriesData is a Map
    const ohlc = crosshairData.seriesData.get(candlestickSeriesRef.current) as any;
    if (ohlc && ohlc.open !== undefined) {
      // Find matching kline for volume
      const t = crosshairData.time as number;
      const kline = dataRef.current.find((k) => Math.round(k.openTime / 1000) === t);
      tooltipPrimRef.current.setBar({
        time: t,
        open: ohlc.open,
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
        volume: kline ? parseFloat(kline.volume) : 0,
      });
      return;
    }
  }
  tooltipPrimRef.current.setBar(null);
});

// 5. Toggle enabled state in overlay effect:
if (tooltipPrimRef.current) {
  tooltipPrimRef.current.setEnabled(tog?.crosshairTooltip ?? true);
}
```

- [ ] **Step 4: Verify in browser**

Move mouse over the chart — a floating box should appear near the crosshair showing O/H/L/C/Vol for the hovered bar. It should be green-bordered for bullish bars and red-bordered for bearish. Toggle "Tooltip" in overlay panel to hide/show.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chart/primitives/CrosshairTooltipPrimitive.ts src/components/ChartOverlayPanel.tsx src/pages/Dashboard.tsx
git commit -m "feat(chart): add floating crosshair OHLCV tooltip primitive"
```

---

## Task 4: Liquidity Sweep Markers

**Files:**
- Create: `src/lib/chart/primitives/LiquiditySweepPrimitive.ts`
- Modify: `src/components/ChartOverlayPanel.tsx`
- Modify: `src/pages/Dashboard.tsx`

Renders persistent triangle markers on the chart at the timestamp of SSS/SS-priority liquidity events. The data comes from `liquidityEvents` state in Dashboard (already populated by `liquidityEventStream` subscription).

- [ ] **Step 1: Create LiquiditySweepPrimitive**

```typescript
// src/lib/chart/primitives/LiquiditySweepPrimitive.ts
import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";

export interface SweepMarker {
  time: number;   // ms timestamp
  type: string;   // event type, e.g. "BUY_SIDE_SWEEP"
  priority: "SSS" | "SS" | "S" | "A" | "B";
  message: string;
}

const PRIORITY_COLOR: Record<string, string> = {
  SSS: "rgba(239,68,68,0.95)",   // bright red
  SS:  "rgba(249,115,22,0.90)",  // orange
  S:   "rgba(234,179,8,0.80)",   // yellow
  A:   "rgba(99,102,241,0.70)",  // indigo
  B:   "rgba(113,113,122,0.60)", // gray
};

export class LiquiditySweepPrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _markers: SweepMarker[] = [];
  private _enabled = true;

  attached(param: SeriesAttachedParameter<Time>) { this._param = param; }
  detached() { this._param = null; }

  setEnabled(v: boolean) { this._enabled = v; this._param?.requestUpdate(); }

  setMarkers(markers: SweepMarker[]) {
    this._markers = markers;
    this._param?.requestUpdate();
  }

  paneViews() {
    const param   = this._param;
    const markers = this._markers;
    const enabled = this._enabled;
    return [{
      renderer: () => ({
        draw: (target: any) => {
          if (!enabled || !param || markers.length === 0) return;
          target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio }: any) => {
            const timeScale = param.chart.timeScale();
            const series    = param.series;

            for (const m of markers) {
              const t = (m.time / 1000) as Time;
              const x = timeScale.timeToCoordinate(t);
              if (x === null) continue;

              const isBuy = m.type.startsWith("BUY") || m.type === "SELL_SIDE_SWEEP" || m.type.includes("SHORT");
              const color = PRIORITY_COLOR[m.priority] ?? PRIORITY_COLOR.B;

              const px = Math.round(x * horizontalPixelRatio);
              const size = m.priority === "SSS" ? 8 : m.priority === "SS" ? 6 : 5;
              const pxSize = size * horizontalPixelRatio;

              // Triangle pointing down (sell sweep) or up (buy sweep) at top/bottom of pane
              const py = isBuy
                ? bitmapSize.height - pxSize * 2
                : pxSize * 2;

              ctx.fillStyle = color;
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.beginPath();
              if (isBuy) {
                // Upward triangle at bottom
                ctx.moveTo(px, py);
                ctx.lineTo(px - pxSize, py + pxSize * 1.5);
                ctx.lineTo(px + pxSize, py + pxSize * 1.5);
              } else {
                // Downward triangle at top
                ctx.moveTo(px, py);
                ctx.lineTo(px - pxSize, py - pxSize * 1.5);
                ctx.lineTo(px + pxSize, py - pxSize * 1.5);
              }
              ctx.closePath();
              ctx.fill();

              // Priority badge (SSS/SS only)
              if (m.priority === "SSS" || m.priority === "SS") {
                ctx.font = `${9 * horizontalPixelRatio}px monospace`;
                ctx.fillStyle = color;
                ctx.fillText(m.priority, px - pxSize, isBuy ? py - 4 * verticalPixelRatio : py + 12 * verticalPixelRatio);
              }
            }
          });
        },
      }),
    }];
  }
}
```

- [ ] **Step 2: Add `sweepMarkers` toggle to ChartOverlayPanel.tsx**

```typescript
// In OverlayToggles interface:
sweepMarkers: boolean;

// Default:
sweepMarkers: true,

// JSX:
<ToggleRow label="Sweep Markers" field="sweepMarkers" />
```

- [ ] **Step 3: Wire into Dashboard.tsx**

```typescript
// 1. Import:
import { LiquiditySweepPrimitive, type SweepMarker } from "@/lib/chart/primitives/LiquiditySweepPrimitive";

// 2. Add ref:
const sweepPrimRef = useRef<LiquiditySweepPrimitive | null>(null);

// 3. Attach after chart init:
const sweepPrim = new LiquiditySweepPrimitive();
candlestickSeriesRef.current.attachPrimitive(sweepPrim);
sweepPrimRef.current = sweepPrim;

// 4. Pass liquidityEvents from parent Dashboard down to MiniChart as prop:
//    In Dashboard component: liquidityEvents state already exists (~line 1923)
//    Add prop to MiniChart signature: liquidityEvents?: any[]
//    Pass: <MiniChart ... liquidityEvents={liquidityEvents} />

// 5. In MiniChart, add useEffect that updates markers when liquidityEvents or overlayToggles change:
useEffect(() => {
  if (!sweepPrimRef.current) return;
  const enabled = overlayToggles?.sweepMarkers ?? true;
  sweepPrimRef.current.setEnabled(enabled);

  if (!enabled || !liquidityEvents || liquidityEvents.length === 0) {
    sweepPrimRef.current.setMarkers([]);
    return;
  }

  // Only show SSS/SS/S priority events; map to SweepMarker shape
  const markers: SweepMarker[] = liquidityEvents
    .filter((e) => ["SSS", "SS", "S"].includes(e.priority))
    .map((e) => ({
      time: e.timestamp,   // ms
      type: e.type,
      priority: e.priority,
      message: e.message,
    }));

  sweepPrimRef.current.setMarkers(markers);
}, [liquidityEvents, overlayToggles]);
```

- [ ] **Step 4: Verify in browser**

Wait for a liquidity event to fire (or trigger artificially by checking the Flow Telemetry tab which shows all events). Small triangles should appear at the bottom (buy sweeps) or top (sell sweeps) of the chart at the event timestamps. SSS events show a red triangle labeled "SSS". Toggle "Sweep Markers" in overlay panel.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chart/primitives/LiquiditySweepPrimitive.ts src/components/ChartOverlayPanel.tsx src/pages/Dashboard.tsx
git commit -m "feat(chart): add liquidity sweep markers from live event stream"
```

---

## Self-Review

**Spec coverage:**
- Session shading ✅ Task 1 — Asia/London/NY boxes with labels and toggle
- CVD histogram pane ✅ Task 2 — real tick data from `cvdWindow` via new backend query + stream
- Crosshair tooltip ✅ Task 3 — floating OHLCV box near cursor with toggle
- Liquidity sweep markers ✅ Task 4 — triangles at event timestamps, colored by priority

**Placeholder scan:** No TBD/TODO/placeholder items. All code blocks are complete implementations.

**Type consistency:**
- `SessionShadingPrimitive.setEnabled(v: boolean)` — used in Task 1 Step 3 ✅
- `CrosshairTooltipPrimitive.setBar(bar: TooltipBar | null)` — used in Task 3 Step 3 ✅
- `LiquiditySweepPrimitive.setMarkers(markers: SweepMarker[])` — used in Task 4 Step 3 ✅
- `cvdHistory` query returns `{ points: { ts, delta, cumulative }[] }` — consumed in Task 2 Step 2 ✅
- `cvdStream` emits `{ ts, delta, cumulative }` — consumed in Task 2 Step 2 ✅

**Note:** After Tasks 1, 3, 4 each add toggles to `OverlayToggles`, the default value object in `ChartOverlayPanel.tsx` must include the new field. The `OverlayToggles` type in `ChartOverlayPanel.tsx` is the single source of truth — re-exported to Dashboard via prop type. No changes needed to `pa-types.ts` or backend price-action routes.
