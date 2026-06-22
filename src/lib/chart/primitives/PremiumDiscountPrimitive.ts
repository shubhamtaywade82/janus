import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { PremiumDiscountZone, SwingPoint } from "../pa-types";

const PREMIUM_FILL  = "rgba(239, 68, 68, 0.05)";  // light red
const DISCOUNT_FILL = "rgba(34, 197, 94, 0.05)"; // light green
const LINE_COLOR    = "rgba(113, 113, 122, 0.40)"; // zinc-400-like
const EQ_LINE_COLOR = "rgba(234, 179, 8, 0.50)";  // yellow-500-like

export class PremiumDiscountPrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _zone: PremiumDiscountZone | null = null;
  private _swings: SwingPoint[] = [];

  setZone(zone: PremiumDiscountZone | null, swings: SwingPoint[] = []) {
    this._zone = zone;
    this._swings = swings;
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
            if (!self._param || !self._zone) return;
            try {
              const series    = self._param.series as any;
              const timeScale = self._param.chart.timeScale() as any;
              const toY = (p: number): number | null => series.priceToCoordinate(p) ?? null;
              const toX = (t: number): number | null => timeScale.timeToCoordinate((t / 1000) as Time) ?? null;

              target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
                ctx.save();

                const yHigh = toY(self._zone!.swingHigh);
                const yLow  = toY(self._zone!.swingLow);
                const yEq   = toY(self._zone!.equilibrium);

                if (yHigh === null || yLow === null || yEq === null) {
                  ctx.restore();
                  return;
                }

                const data = series.data();
                const lastItem = data.length > 0 ? data[data.length - 1] : null;
                const lastX = lastItem ? toX(lastItem.time) : null;

                // Find start time of the zone from the swing high/low times
                let startX: number | null = null;
                const matchHigh = self._swings.find(s => s.price === self._zone!.swingHigh && s.type === "high");
                const matchLow  = self._swings.find(s => s.price === self._zone!.swingLow && s.type === "low");

                if (matchHigh && matchLow) {
                  const minTime = Math.min(matchHigh.time, matchLow.time);
                  startX = toX(minTime);
                }

                const bx = startX !== null ? Math.round(startX * hpr) : 0;
                const endX = lastX !== null ? lastX * hpr : ctx.canvas.width;
                const bw = Math.max(0, Math.round(endX) - bx);

                if (bw <= 0) {
                  ctx.restore();
                  return;
                }

                const byHigh = Math.round(yHigh * vpr);
                const byLow  = Math.round(yLow * vpr);
                const byEq   = Math.round(yEq * vpr);

                // Draw Shading
                // Premium (High to Eq)
                ctx.fillStyle = PREMIUM_FILL;
                ctx.fillRect(bx, byHigh, bw, byEq - byHigh);

                // Discount (Eq to Low)
                ctx.fillStyle = DISCOUNT_FILL;
                ctx.fillRect(bx, byEq, bw, byLow - byEq);

                // Draw horizontal lines
                ctx.lineWidth = 1;

                // Swing High
                ctx.strokeStyle = LINE_COLOR;
                ctx.beginPath();
                ctx.moveTo(bx, byHigh);
                ctx.lineTo(bx + bw, byHigh);
                ctx.stroke();

                // Swing Low
                ctx.beginPath();
                ctx.moveTo(bx, byLow);
                ctx.lineTo(bx + bw, byLow);
                ctx.stroke();

                // Equilibrium (dashed yellow)
                ctx.strokeStyle = EQ_LINE_COLOR;
                ctx.setLineDash([4 * hpr, 4 * hpr]);
                ctx.beginPath();
                ctx.moveTo(bx, byEq);
                ctx.lineTo(bx + bw, byEq);
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw Labels
                ctx.font = `${Math.max(9, Math.round(9 * Math.min(hpr, vpr)))}px monospace`;
                ctx.textBaseline = "middle";

                // Premium Label
                ctx.fillStyle = "rgba(239, 68, 68, 0.70)";
                ctx.fillText("PREMIUM", bx + 6, Math.round((byHigh + byEq) / 2));

                // Discount Label
                ctx.fillStyle = "rgba(34, 197, 94, 0.70)";
                ctx.fillText("DISCOUNT", bx + 6, Math.round((byEq + byLow) / 2));

                // Equilibrium Label
                ctx.fillStyle = EQ_LINE_COLOR;
                ctx.fillText("EQ 50%", bx + 6, byEq - 6);

                ctx.restore();
              });
            } catch { /* safety */ }
          },
        };
      },
    }];
  }
}
