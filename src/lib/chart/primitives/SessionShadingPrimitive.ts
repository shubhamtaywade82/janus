import type { ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";

export interface SessionDef {
  label: string;
  startHourUtc: number;   // 0–23
  endHourUtc: number;     // 0–23
  color: string;          // rgba fill
  borderColor: string;    // top border line color
}

export const DEFAULT_SESSIONS: SessionDef[] = [
  { label: "Asia",   startHourUtc: 0,  endHourUtc: 9,  color: "rgba(59,130,246,0.06)",  borderColor: "rgba(59,130,246,0.25)" },
  { label: "London", startHourUtc: 7,  endHourUtc: 16, color: "rgba(234,179,8,0.06)",   borderColor: "rgba(234,179,8,0.25)" },
  { label: "NY",     startHourUtc: 13, endHourUtc: 22, color: "rgba(34,197,94,0.06)",   borderColor: "rgba(34,197,94,0.25)" },
];

export class SessionShadingPrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null;
  private _sessions: SessionDef[] = DEFAULT_SESSIONS;
  private _enabled = true;

  attached(param: SeriesAttachedParameter<Time>) { this._param = param; }
  detached() { this._param = null; }
  updateAllViews() {}

  setEnabled(v: boolean) {
    this._enabled = v;
    this._param?.requestUpdate();
  }

  setSessions(sessions: SessionDef[]) {
    this._sessions = sessions;
    this._param?.requestUpdate();
  }

  paneViews() {
    const param = this._param;
    const sessions = this._sessions;
    const enabled = this._enabled;
    return [{
      renderer() {
        return {
          draw(target: any) {
            try {
              if (!enabled || !param) return;
              target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio, verticalPixelRatio }: any) => {
                const timeScale = param.chart.timeScale();
                const visRange = timeScale.getVisibleRange();
                if (!visRange) return;

                const fromMs = (visRange.from as number) * 1000;
                const toMs   = (visRange.to   as number) * 1000;
                const dayMs  = 86_400_000;
                const startDay = Math.floor(fromMs / dayMs) * dayMs;

                ctx.save();
                for (let dayStart = startDay; dayStart <= toMs; dayStart += dayMs) {
                  for (const sess of sessions) {
                    const sessStart = dayStart + sess.startHourUtc * 3_600_000;
                    const sessEnd   = dayStart + sess.endHourUtc   * 3_600_000;
                    if (sessEnd < fromMs || sessStart > toMs) continue;

                    const x1 = timeScale.timeToCoordinate((sessStart / 1000) as Time);
                    const x2 = timeScale.timeToCoordinate((sessEnd   / 1000) as Time);
                    if (x1 === null || x2 === null) continue;

                    const px1 = Math.round(x1 * horizontalPixelRatio);
                    const px2 = Math.round(x2 * horizontalPixelRatio);
                    const w   = Math.abs(px2 - px1);
                    if (w < 1) continue;

                    ctx.fillStyle = sess.color;
                    ctx.fillRect(Math.min(px1, px2), 0, w, bitmapSize.height);

                    ctx.strokeStyle = sess.borderColor;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(Math.min(px1, px2), 0);
                    ctx.lineTo(Math.min(px1, px2) + w, 0);
                    ctx.stroke();

                    const labelX = Math.min(px1, px2) + 4 * horizontalPixelRatio;
                    ctx.fillStyle = sess.borderColor;
                    ctx.font = `${10 * horizontalPixelRatio}px monospace`;
                    ctx.fillText(sess.label, labelX, 12 * verticalPixelRatio);
                  }
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
