import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

export class LastPriceLinePrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _price: number = 0;
  private _color: string = "#ffffff";

  setLastPrice(price: number, color: string) {
    this._price = price;
    this._color = color;
    this._param?.requestUpdate();
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this._param = param;
  }

  detached() {
    this._param = null;
  }

  updateAllViews() {}

  paneViews() {
    const self = this;
    return [{
      renderer() {
        return {
          draw(target: CanvasRenderingTarget2D) {
            if (!self._param || self._price <= 0) return;
            try {
              const series = self._param.series as any;
              const timeScale = self._param.chart.timeScale() as any;
              const seriesData = series.data();
              if (!seriesData || seriesData.length === 0) return;

              const lastBar = seriesData[seriesData.length - 1];
              const lastTime = lastBar.time;
              const lastX = timeScale.timeToCoordinate(lastTime);
              const lastY = series.priceToCoordinate(self._price);

              if (lastX === null || lastY === null) return;

              target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
                ctx.save();

                const bx = Math.round(lastX * hpr);
                const by = Math.round(lastY * vpr);
                const bw = ctx.canvas.width; // extends to the right edge

                // Draw horizontal line from last candle center to the right edge
                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.lineTo(bw, by);
                ctx.strokeStyle = self._color;
                ctx.lineWidth = 1.5 * hpr; // scale line width
                ctx.stroke();

                // Draw a solid dot at the center of the current forming candle
                ctx.beginPath();
                ctx.arc(bx, by, 3.5 * Math.min(hpr, vpr), 0, 2 * Math.PI);
                ctx.fillStyle = self._color;
                ctx.fill();

                // Draw a subtle outer glow ring for a premium indicator look
                ctx.beginPath();
                ctx.arc(bx, by, 6.5 * Math.min(hpr, vpr), 0, 2 * Math.PI);
                ctx.strokeStyle = self._color.replace(/rgb\(|rgba\(/, "rgba(").replace(/\)/, ", 0.25)");
                ctx.lineWidth = 1.5 * hpr;
                ctx.stroke();

                ctx.restore();
              });
            } catch (err) {
              // Safe catch to ensure chart rendering never breaks
            }
          },
        };
      },
    }];
  }
}
