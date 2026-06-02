import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { FairValueGap } from "../pa-types";

export type { FairValueGap };

export class FVGPrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _fvgs: FairValueGap[] = [];

  setFVGs(fvgs: FairValueGap[]) {
    this._fvgs = fvgs;
    this._param?.requestUpdate();
  }
  attached(param: SeriesAttachedParameter<Time>) { this._param = param; }
  detached() { this._param = null; }
  updateAllViews() {}

  paneViews() {
    const self = this;
    return [{
      renderer() {
        return {
          draw(target: CanvasRenderingTarget2D) {
            if (!self._param || self._fvgs.length === 0) return;
            const series = self._param.series as any;
            const toY = (p: number): number | null => series.priceToCoordinate(p) ?? null;
            const toX = (t: number): number | null => series.timeToCoordinate((t / 1000) as Time) ?? null;

            target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
              for (const fvg of self._fvgs) {
                const x1 = toX(fvg.startTime);
                const x2 = toX(fvg.endTime);
                const y1 = toY(fvg.top);
                const y2 = toY(fvg.bottom);
                if (y1 === null || y2 === null) continue;

                const isBull = fvg.type === "bullish";
                const fill   = fvg.filled
                  ? "rgba(113,113,122,0.05)"
                  : isBull ? "rgba(168,85,247,0.10)" : "rgba(249,115,22,0.10)";
                const edge   = isBull ? "rgba(168,85,247,0.40)" : "rgba(249,115,22,0.40)";

                const bx = Math.round((x1 ?? 0) * hpr);
                const by = Math.round(Math.min(y1, y2) * vpr);
                const bw = x2 !== null
                  ? Math.round(Math.abs(x2 - (x1 ?? 0)) * hpr)
                  : Math.max(0, ctx.canvas.width - bx);
                const bh = Math.round(Math.abs(y2 - y1) * vpr);
                if (bh < 1) continue;

                ctx.fillStyle = fill;
                ctx.fillRect(bx, by, bw, bh);

                // Midpoint dashed line
                const yMid = toY(fvg.midpoint);
                if (yMid !== null && !fvg.filled) {
                  ctx.strokeStyle = edge;
                  ctx.lineWidth   = 1;
                  ctx.setLineDash([4 * hpr, 4 * hpr]);
                  ctx.beginPath();
                  ctx.moveTo(bx, Math.round(yMid * vpr));
                  ctx.lineTo(bx + bw, Math.round(yMid * vpr));
                  ctx.stroke();
                  ctx.setLineDash([]);
                }

                if (!fvg.filled) {
                  ctx.fillStyle    = edge;
                  ctx.font         = `${Math.max(8, Math.round(8 * Math.min(hpr, vpr)))}px monospace`;
                  ctx.textBaseline = "top";
                  ctx.fillText(`FVG ${fvg.fillPercent.toFixed(0)}%`, bx + 2, by + 2);
                }
              }
            });
          },
        };
      },
    }];
  }
}
