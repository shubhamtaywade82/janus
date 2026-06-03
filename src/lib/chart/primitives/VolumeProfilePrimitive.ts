import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { VolumeProfileResult } from "../indicators";

const PROFILE_WIDTH_PCT = 0.18;  // 18% of chart width
const BAR_GAP = 0.5;             // px gap between bars

export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _data: VolumeProfileResult | null = null;

  setData(data: VolumeProfileResult | null) {
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
              const { buckets, maxVol, poc, valueAreaHigh, valueAreaLow } = self._data;
              const series = self._param.series as any;
              const toY = (p: number): number | null => series.priceToCoordinate(p) ?? null;

              target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
                ctx.save();

                const canvasW = ctx.canvas.width;
                const canvasH = ctx.canvas.height;
                const profileW = Math.floor(canvasW * PROFILE_WIDTH_PCT);
                const startX = canvasW - profileW;

                const n = buckets.length;
                if (n === 0 || maxVol === 0) { ctx.restore(); return; }

                // Compute bar height from price coordinates of adjacent buckets
                const bucketSize = buckets[1]?.price - buckets[0]?.price;
                if (!bucketSize || bucketSize <= 0) { ctx.restore(); return; }

                for (let i = 0; i < n; i++) {
                  const b = buckets[i];
                  const yMid  = toY(b.price);
                  const yTop  = toY(b.price + bucketSize / 2);
                  const yBot  = toY(b.price - bucketSize / 2);
                  if (yMid === null || yTop === null || yBot === null) continue;

                  const barH = Math.max(1, Math.round(Math.abs(yBot - yTop) * vpr) - BAR_GAP);
                  const barY = Math.round(Math.min(yTop, yBot) * vpr);
                  if (barY < 0 || barY > canvasH) continue;

                  const barMaxW = Math.floor((b.vol / maxVol) * profileW);
                  const buyW    = Math.floor(barMaxW * (b.buyVol / (b.vol || 1)));
                  const sellW   = barMaxW - buyW;

                  const isPOC = Math.abs(b.price - poc) < bucketSize / 2;
                  const isVA  = b.price >= valueAreaLow && b.price <= valueAreaHigh;

                  // Sell portion (right of buy)
                  const sellAlpha = isPOC ? 0.80 : isVA ? 0.45 : 0.22;
                  ctx.fillStyle = `rgba(246,70,93,${sellAlpha})`;
                  ctx.fillRect(startX, barY, sellW, barH);

                  // Buy portion
                  const buyAlpha = isPOC ? 0.80 : isVA ? 0.45 : 0.22;
                  ctx.fillStyle = `rgba(14,203,129,${buyAlpha})`;
                  ctx.fillRect(startX + sellW, barY, buyW, barH);

                  // POC highlight — amber outline
                  if (isPOC) {
                    ctx.strokeStyle = "rgba(245,158,11,0.90)";
                    ctx.lineWidth = Math.round(1.5 * vpr);
                    ctx.strokeRect(startX + 0.5, barY + 0.5, barMaxW - 1, barH - 1);
                  }
                }

                // Value Area label
                const vaHiY = toY(valueAreaHigh);
                const vaLoY = toY(valueAreaLow);
                const pocY  = toY(poc);
                ctx.font = `${Math.round(9 * Math.min(hpr, vpr))}px monospace`;
                ctx.fillStyle = "rgba(245,158,11,0.80)";
                if (pocY !== null) {
                  ctx.textAlign = "right";
                  ctx.fillText("POC", startX - 2, Math.round(pocY * vpr));
                }
                ctx.fillStyle = "rgba(113,113,122,0.60)";
                ctx.textAlign = "right";
                if (vaHiY !== null) ctx.fillText("VAH", startX - 2, Math.round(vaHiY * vpr) - 2);
                if (vaLoY !== null) ctx.fillText("VAL", startX - 2, Math.round(vaLoY * vpr) + 8);

                ctx.restore();
              });
            } catch { /* never crash chart render */ }
          },
        };
      },
    }];
  }
}
