import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

function setAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split("").map(c => c + c).join("");
    }
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (color.startsWith("rgb")) {
    const matches = color.match(/\d+(\.\d+)?/g);
    if (matches && matches.length >= 3) {
      return `rgba(${matches[0]}, ${matches[1]}, ${matches[2]}, ${alpha})`;
    }
  }
  return color;
}

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

                // Draw a solid white dot at the center of the current forming candle
                ctx.beginPath();
                ctx.arc(bx, by, 2.0 * Math.min(hpr, vpr), 0, 2 * Math.PI);
                ctx.fillStyle = "#ffffff";
                ctx.fill();

                // Draw a thin stroke around the white dot in the theme color
                ctx.lineWidth = 1.0 * Math.min(hpr, vpr);
                ctx.strokeStyle = self._color;
                ctx.stroke();

                // Draw a subtle, thin outer glow ring for a premium indicator look
                ctx.beginPath();
                ctx.arc(bx, by, 4.5 * Math.min(hpr, vpr), 0, 2 * Math.PI);
                ctx.strokeStyle = setAlpha(self._color, 0.25);
                ctx.lineWidth = 1.0 * hpr;
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
