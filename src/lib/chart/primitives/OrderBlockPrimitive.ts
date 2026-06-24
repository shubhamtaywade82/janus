import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { OrderBlock } from "../pa-types";

export type { OrderBlock };

const BULL_FILL   = "rgba(34,197,94,0.12)";
const BEAR_FILL   = "rgba(239,68,68,0.12)";
const BULL_STROKE = "rgba(34,197,94,0.40)";
const BEAR_STROKE = "rgba(239,68,68,0.40)";
const MITI_FILL   = "rgba(113,113,122,0.06)";
const MITI_STROKE = "rgba(113,113,122,0.20)";

export class OrderBlockPrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _blocks: OrderBlock[] = [];

  setBlocks(blocks: OrderBlock[]) {
    this._blocks = blocks;
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
            if (!self._param || self._blocks.length === 0) return;
            try {
            const series    = self._param.series as any;
            const timeScale = self._param.chart.timeScale() as any;
            const toY = (p: number): number | null => series.priceToCoordinate(p) ?? null;
            const toX = (t: number): number | null => timeScale.timeToCoordinate((t / 1000) as Time) ?? null;

            target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
              ctx.save();
              
              const data = series.data();
              const lastItem = data.length > 0 ? data[data.length - 1] : null;
              const lastX = lastItem ? toX(lastItem.time) : null;

              for (const block of self._blocks) {
                const x1 = toX(block.time);
                const y1 = toY(block.top);
                const y2 = toY(block.bottom);
                if (x1 === null || y1 === null || y2 === null) continue;

                const fill   = block.mitigated ? MITI_FILL   : block.type === "bullish" ? BULL_FILL   : BEAR_FILL;
                const stroke = block.mitigated ? MITI_STROKE : block.type === "bullish" ? BULL_STROKE : BEAR_STROKE;

                const bx = Math.round(x1 * hpr);
                const by = Math.round(Math.min(y1, y2) * vpr);
                
                let x2 = null;
                if (block.mitigated && block.mitigatedAt) {
                  x2 = toX(block.mitigatedAt);
                } else if (lastX !== null) {
                  x2 = lastX;
                }
                const endX = x2 !== null ? x2 * hpr : ctx.canvas.width;
                const bw = Math.max(0, Math.round(endX) - bx);
                
                const bh = Math.round(Math.abs(y2 - y1) * vpr);
                if (bh < 1) continue;

                ctx.fillStyle = fill;
                ctx.fillRect(bx, by, bw, bh);

                ctx.strokeStyle = stroke;
                ctx.lineWidth   = 1;
                ctx.setLineDash(block.mitigated ? [4, 4] : []);
                ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
                ctx.setLineDash([]);

                ctx.fillStyle    = stroke;
                ctx.font         = `${Math.max(9, Math.round(9 * Math.min(hpr, vpr)))}px monospace`;
                ctx.textBaseline = "top";
                ctx.fillText(block.type === "bullish" ? "OB▲" : "OB▼", bx + 3, by + 2);
              }
              ctx.restore();
            });
            } catch { /* never crash the chart render loop */ }
          },
        };
      },
    }];
  }
}
