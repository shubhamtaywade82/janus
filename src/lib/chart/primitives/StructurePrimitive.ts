import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { StructureBreak, LiquidityLevel } from "../pa-types";

export type { StructureBreak, LiquidityLevel };

export class StructurePrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _structure: StructureBreak[] = [];
  private _liquidity: LiquidityLevel[] = [];

  setData(structure: StructureBreak[], liquidity: LiquidityLevel[]) {
    this._structure = structure;
    this._liquidity = liquidity;
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
            if (!self._param) return;
            const series = self._param.series as any;
            const toY = (p: number): number | null => series.priceToCoordinate(p) ?? null;
            const toX = (t: number): number | null => series.timeToCoordinate((t / 1000) as Time) ?? null;

            target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
              ctx.save();
              // ─── BOS / CHoCH ───
              for (const sb of self._structure) {
                const x1 = toX(sb.brokenSwingTime);
                const x2 = toX(sb.time);
                const y  = toY(sb.brokenSwingPrice);
                if (x1 === null || x2 === null || y === null) continue;

                const color = sb.type === "BOS" ? "rgba(59,130,246,0.80)" : "rgba(245,158,11,0.80)";
                ctx.strokeStyle = color;
                ctx.lineWidth   = 1.5;
                ctx.setLineDash(sb.type === "CHoCH" ? [5 * hpr, 3 * hpr] : []);
                ctx.beginPath();
                ctx.moveTo(Math.round(x1 * hpr), Math.round(y * vpr));
                ctx.lineTo(Math.round(x2 * hpr), Math.round(y * vpr));
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle    = color;
                ctx.font         = `bold ${Math.max(9, Math.round(9 * Math.min(hpr, vpr)))}px sans-serif`;
                ctx.textBaseline = sb.direction === "bullish" ? "bottom" : "top";
                ctx.fillText(sb.type, Math.round(x2 * hpr) + 4, Math.round(y * vpr));
              }

              // ─── Liquidity levels ───
              for (const liq of self._liquidity) {
                const y = toY(liq.price);
                if (y === null) continue;

                const color = liq.swept ? "rgba(113,113,122,0.30)" : "rgba(239,68,68,0.60)";
                ctx.strokeStyle = color;
                ctx.lineWidth   = 1;
                ctx.setLineDash([6 * hpr, 4 * hpr]);
                ctx.beginPath();
                ctx.moveTo(0, Math.round(y * vpr));
                ctx.lineTo(ctx.canvas.width, Math.round(y * vpr));
                ctx.stroke();
                ctx.setLineDash([]);

                const label = `${liq.type === "buy-side" ? "EQH" : "EQL"} ×${liq.touchCount}${liq.swept ? " ✓" : ""}`;
                ctx.fillStyle    = color;
                ctx.font         = `${Math.max(8, Math.round(8 * Math.min(hpr, vpr)))}px monospace`;
                ctx.textBaseline = "bottom";
                ctx.textAlign    = "right";
                ctx.fillText(label, ctx.canvas.width - 4, Math.round(y * vpr) - 2);
                ctx.textAlign = "left";
              }
              ctx.restore();
            });
          },
        };
      },
    }];
  }
}
