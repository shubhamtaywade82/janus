import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";

export interface SweepMarker {
  time: number;     // ms timestamp
  type: string;
  priority: "SSS" | "SS" | "S" | "A" | "B";
  message: string;
}

const PRIORITY_COLOR: Record<string, string> = {
  SSS: "rgba(239,68,68,0.95)",
  SS:  "rgba(249,115,22,0.90)",
  S:   "rgba(234,179,8,0.80)",
  A:   "rgba(99,102,241,0.70)",
  B:   "rgba(113,113,122,0.60)",
};

export class LiquiditySweepPrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _markers: SweepMarker[] = [];
  private _enabled = true;

  attached(param: SeriesAttachedParameter<Time>) { this._param = param; }
  detached() { this._param = null; }
  updateAllViews() {}

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
      renderer() {
        return {
          draw(target: any) {
            try {
              if (!enabled || !param || markers.length === 0) return;
              target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio }: any) => {
                const timeScale = param.chart.timeScale();
                ctx.save();

                for (const m of markers) {
                  const t = (m.time / 1000) as Time;
                  const x = timeScale.timeToCoordinate(t);
                  if (x === null) continue;

                  // Buy sweeps (price swept below and rejected up) = bottom triangle pointing up
                  // Sell sweeps (price swept above and rejected down) = top triangle pointing down
                  const isBuy = m.type.includes("SELL_SIDE") || m.type.includes("SHORT");
                  const color = PRIORITY_COLOR[m.priority] ?? PRIORITY_COLOR.B;
                  const px    = Math.round(x * horizontalPixelRatio);
                  const size  = (m.priority === "SSS" ? 8 : m.priority === "SS" ? 6 : 5) * horizontalPixelRatio;

                  ctx.fillStyle = color;

                  ctx.beginPath();
                  if (isBuy) {
                    // Bottom: triangle pointing up (bullish reversal from sell-side sweep)
                    const py = bitmapSize.height - size * 2;
                    ctx.moveTo(px, py);
                    ctx.lineTo(px - size, py + size * 1.5);
                    ctx.lineTo(px + size, py + size * 1.5);
                  } else {
                    // Top: triangle pointing down (bearish reversal from buy-side sweep)
                    const py = size * 2;
                    ctx.moveTo(px, py);
                    ctx.lineTo(px - size, py - size * 1.5);
                    ctx.lineTo(px + size, py - size * 1.5);
                  }
                  ctx.closePath();
                  ctx.fill();

                  // SSS/SS: label above/below triangle
                  if (m.priority === "SSS" || m.priority === "SS") {
                    ctx.font = `bold ${9 * horizontalPixelRatio}px monospace`;
                    ctx.fillStyle = color;
                    const label = m.priority;
                    const textY = isBuy
                      ? bitmapSize.height - size * 2 - 4 * verticalPixelRatio
                      : size * 2 + 12 * verticalPixelRatio;
                    ctx.fillText(label, px - size * 0.8, textY);
                  }
                }

                ctx.restore();
              });
            } catch { /* never crash the chart render loop */ }
          }
        };
      }
    }];
  }
}
