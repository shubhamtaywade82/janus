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
  updateAllViews() {}

  setEnabled(v: boolean) { this._enabled = v; this._param?.requestUpdate(); }
  setBar(bar: TooltipBar | null) { this._bar = bar; this._param?.requestUpdate(); }

  paneViews() {
    const param   = this._param;
    const bar     = this._bar;
    const enabled = this._enabled;
    return [{
      renderer() {
        return {
          draw(target: any) {
            try {
              if (!enabled || !param || !bar) return;
              target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio }: any) => {
                const timeScale = param.chart.timeScale();
                const barX = timeScale.timeToCoordinate(bar.time as Time);
                if (barX === null) return;

                const isGreen  = bar.close >= bar.open;
                const chg      = ((bar.close - bar.open) / bar.open) * 100;
                const chgStr   = `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`;
                const volStr   = bar.volume >= 1_000_000
                  ? `${(bar.volume / 1_000_000).toFixed(2)}M`
                  : bar.volume >= 1_000
                  ? `${(bar.volume / 1_000).toFixed(1)}k`
                  : bar.volume.toFixed(2);

                const lines = [
                  `O ${bar.open.toFixed(2)}   H ${bar.high.toFixed(2)}`,
                  `L ${bar.low.toFixed(2)}   C ${bar.close.toFixed(2)}`,
                  `Vol ${volStr}   ${chgStr}`,
                ];

                const FONT_PX  = 10;
                const PAD      = 8;
                const LINE_H   = 14;
                const BOX_W    = 170;
                const BOX_H    = lines.length * LINE_H + PAD * 2;

                // Scale to bitmap coordinates
                const bPAD   = PAD   * verticalPixelRatio;
                const bLINEH = LINE_H * verticalPixelRatio;
                const bBOXW  = BOX_W  * horizontalPixelRatio;
                const bBOXH  = BOX_H  * verticalPixelRatio;

                // Position: right of crosshair, clamp to canvas edges
                let bx = Math.round(barX * horizontalPixelRatio) + 14 * horizontalPixelRatio;
                if (bx + bBOXW > bitmapSize.width) {
                  bx = Math.round(barX * horizontalPixelRatio) - bBOXW - 14 * horizontalPixelRatio;
                }
                const by = Math.max(bPAD, Math.min(bitmapSize.height - bBOXH - bPAD, bitmapSize.height * 0.08));

                const borderColor = isGreen ? "rgba(14,203,129,0.5)" : "rgba(246,70,93,0.5)";
                const textColor   = isGreen ? "rgba(14,203,129,0.95)" : "rgba(246,70,93,0.95)";
                const r = 4 * Math.min(horizontalPixelRatio, verticalPixelRatio);

                // Background
                ctx.fillStyle = "rgba(9,9,11,0.92)";
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.roundRect(bx, by, bBOXW, bBOXH, r);
                ctx.fill();
                ctx.stroke();

                // Text lines
                ctx.font = `${FONT_PX * Math.min(horizontalPixelRatio, verticalPixelRatio)}px monospace`;
                ctx.fillStyle = textColor;
                lines.forEach((line, i) => {
                  ctx.fillText(line, bx + bPAD, by + bPAD + (i + 1) * bLINEH - 2 * verticalPixelRatio);
                });
              });
            } catch { /* never crash the chart render loop */ }
          }
        };
      }
    }];
  }
}
