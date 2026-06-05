import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

const PROFILE_WIDTH_PCT = 0.18;  // 18% of chart width
const BAR_GAP = 0.5;

export interface OrderBookDepthData {
  bids: [number, number][];
  asks: [number, number][];
}

export class OrderBookDepthPrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _data: OrderBookDepthData | null = null;

  setData(data: OrderBookDepthData | null) {
    this._data = data;
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
            if (!self._param || !self._data) return;
            try {
              const { bids, asks } = self._data;
              const series = self._param.series as any;
              const toY = (p: number): number | null => series.priceToCoordinate(p) ?? null;

              target.useBitmapCoordinateSpace(({ context: ctx, verticalPixelRatio: vpr }) => {
                ctx.save();

                const canvasW = ctx.canvas.width;
                const canvasH = ctx.canvas.height;
                const profileW = Math.floor(canvasW * PROFILE_WIDTH_PCT);
                const startX = canvasW - profileW;

                // Aggregate by pixel Y coordinate to ensure visibility on zoomed-out charts
                const askBuckets = new Map<number, number>();
                const bidBuckets = new Map<number, number>();

                for (const [p, q] of asks) {
                  const y = toY(p);
                  if (y === null) continue;
                  const barY = Math.round(y * vpr);
                  askBuckets.set(barY, (askBuckets.get(barY) || 0) + q);
                }

                for (const [p, q] of bids) {
                  const y = toY(p);
                  if (y === null) continue;
                  const barY = Math.round(y * vpr);
                  bidBuckets.set(barY, (bidBuckets.get(barY) || 0) + q);
                }

                let maxVol = 0;
                for (const q of askBuckets.values()) maxVol = Math.max(maxVol, q);
                for (const q of bidBuckets.values()) maxVol = Math.max(maxVol, q);

                if (maxVol === 0) { ctx.restore(); return; }

                // The height of each pixel-aggregated bucket (min 2px for visibility)
                const barH = Math.max(2, 1 * vpr);

                // Render Asks (Red)
                ctx.fillStyle = "rgba(246,70,93,0.60)";
                for (const [barY, q] of askBuckets.entries()) {
                  if (barY < 0 || barY > canvasH) continue;
                  const barW = Math.max(1, Math.floor((q / maxVol) * profileW));
                  ctx.fillRect(startX, barY - barH / 2, barW, barH);
                }

                // Render Bids (Green)
                ctx.fillStyle = "rgba(14,203,129,0.60)";
                for (const [barY, q] of bidBuckets.entries()) {
                  if (barY < 0 || barY > canvasH) continue;
                  const barW = Math.max(1, Math.floor((q / maxVol) * profileW));
                  ctx.fillRect(startX, barY - barH / 2, barW, barH);
                }

                ctx.restore();
              });
            } catch { /* never crash chart render */ }
          },
        };
      },
    }];
  }
}
