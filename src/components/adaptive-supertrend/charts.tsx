import { useEffect, useRef } from "react";
import type { AdaptiveBacktestResult, AdaptiveCandle } from "@/lib/adaptive-supertrend";
import { fmtDate, fmtPrice } from "@/lib/adaptive-supertrend";
import { AST_COLORS as C } from "./theme";

type ViewRange = [number, number];

interface PriceChartProps {
  candles: AdaptiveCandle[];
  result: AdaptiveBacktestResult;
  width: number;
  height: number;
  symbol: string;
  viewRange: ViewRange;
}

export function PriceChart({
  candles,
  result,
  width,
  height,
  symbol,
  viewRange,
}: PriceChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !candles.length || !result) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const [vStart, vEnd] = viewRange;
    const vis = candles.slice(vStart, vEnd);
    const stV = result.stLine.slice(vStart, vEnd);
    const dirV = result.direction.slice(vStart, vEnd);
    if (vis.length < 2) return;

    const pL = 10;
    const pR = 72;
    const pT = 14;
    const pB = 24;
    const W = width - pL - pR;
    const H = height - pT - pB;

    const allP = [
      ...vis.flatMap((c) => [c.high, c.low]),
      ...stV.filter((v) => !Number.isNaN(v)),
    ];
    const yMin = Math.min(...allP) * 0.9985;
    const yMax = Math.max(...allP) * 1.0015;
    const xS = (i: number) => pL + (i / (vis.length - 1)) * W;
    const yS = (v: number) => pT + H - ((v - yMin) / (yMax - yMin)) * H;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let g = 0; g <= 5; g++) {
      const y = pT + (g / 5) * H;
      ctx.beginPath();
      ctx.moveTo(pL, y);
      ctx.lineTo(pL + W, y);
      ctx.stroke();
      const price = yMax - (g / 5) * (yMax - yMin);
      ctx.fillStyle = C.sub;
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(fmtPrice(price, symbol), pL + W + 3, y + 3);
    }

    const cW = Math.max(1, (W / vis.length) * 0.7);
    vis.forEach((c, i) => {
      const x = xS(i);
      const bull = c.close >= c.open;
      ctx.strokeStyle = bull ? C.accent : C.red;
      ctx.fillStyle = bull ? `${C.accent}aa` : `${C.red}aa`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yS(c.high));
      ctx.lineTo(x, yS(c.low));
      ctx.stroke();
      const y1 = yS(Math.max(c.open, c.close));
      const bH = Math.max(1, Math.abs(yS(c.open) - yS(c.close)));
      ctx.fillRect(x - cW / 2, y1, cW, bH);
    });

    let seg: [number, number][] = [];
    let lastDir = dirV[0];
    const flushSeg = () => {
      if (seg.length < 2) {
        seg = [];
        return;
      }
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = lastDir === 1 ? C.accent : C.red;
      seg.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
      seg = [];
    };
    stV.forEach((v, i) => {
      if (Number.isNaN(v)) return;
      if (dirV[i] !== lastDir) {
        flushSeg();
        lastDir = dirV[i];
      }
      seg.push([xS(i), yS(v)]);
    });
    flushSeg();

    result.signals.forEach((s) => {
      const si = s.i - vStart;
      if (si < 0 || si >= vis.length) return;
      const x = xS(si);
      const price = vis[si]?.close;
      if (!price) return;
      const isLong = s.type === "long";
      const y = yS(price) + (isLong ? 16 : -16);
      ctx.beginPath();
      ctx.fillStyle = isLong ? C.accent : C.red;
      if (isLong) {
        ctx.moveTo(x, y - 9);
        ctx.lineTo(x + 5, y + 2);
        ctx.lineTo(x - 5, y + 2);
      } else {
        ctx.moveTo(x, y + 9);
        ctx.lineTo(x + 5, y - 2);
        ctx.lineTo(x - 5, y - 2);
      }
      ctx.fill();
    });

    ctx.fillStyle = C.sub;
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    for (let g = 0; g <= 4; g++) {
      const i = Math.round((g / 4) * (vis.length - 1));
      const t = vis[i]?.t;
      if (t) ctx.fillText(fmtDate(t), xS(i), pT + H + 16);
    }
  }, [candles, result, width, height, symbol, viewRange]);

  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

interface VolumeChartProps {
  candles: AdaptiveCandle[];
  result: AdaptiveBacktestResult | null;
  width: number;
  height: number;
  viewRange: ViewRange;
}

export function VolumeChart({ candles, result, width, height, viewRange }: VolumeChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !candles.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const [vStart, vEnd] = viewRange;
    const vis = candles.slice(vStart, vEnd);
    const dirV = result?.direction.slice(vStart, vEnd) ?? [];
    if (!vis.length) return;

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, height);

    const pL = 10;
    const pR = 72;
    const pT = 6;
    const pB = 18;
    const W = width - pL - pR;
    const H = height - pT - pB;
    const maxVol = Math.max(...vis.map((c) => c.vol));
    const xS = (i: number) => pL + (i / (vis.length - 1)) * W;
    const cW = Math.max(1, (W / vis.length) * 0.7);

    vis.forEach((c, i) => {
      const barH = (c.vol / maxVol) * H;
      ctx.fillStyle = `${dirV[i] === 1 ? C.accent : C.red}55`;
      ctx.fillRect(xS(i) - cW / 2, pT + H - barH, cW, barH);
    });

    ctx.fillStyle = C.sub;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    const fmtVol = (v: number) =>
      v > 1e9 ? `${(v / 1e9).toFixed(1)}B` : v > 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`;
    ctx.fillText(fmtVol(maxVol), pL + W + 3, pT + 10);
    ctx.fillStyle = `${C.sub}88`;
    ctx.fillText("vol", pL + W + 3, pT + H);
  }, [candles, result, width, height, viewRange]);

  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

interface ERChartProps {
  result: AdaptiveBacktestResult;
  width: number;
  height: number;
  minFactor: number;
  maxFactor: number;
  viewRange: ViewRange;
}

export function ERChart({
  result,
  width,
  height,
  minFactor,
  maxFactor,
  viewRange,
}: ERChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !result) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, height);

    const [vStart, vEnd] = viewRange;
    const er = result.er.slice(vStart, vEnd);
    const sf = result.smoothedFactor.slice(vStart, vEnd);
    if (!er.length) return;

    const pL = 10;
    const pR = 72;
    const pT = 8;
    const pB = 14;
    const W = width - pL - pR;
    const H = height - pT - pB;

    const xS = (i: number) => pL + (i / (er.length - 1)) * W;
    const erY = (v: number) => pT + H - v * H;
    const sfRange = maxFactor - minFactor;
    const sfY = (v: number) => pT + H - ((v - minFactor * 0.9) / (sfRange * 1.2)) * H;

    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    [0, 0.5, 1].forEach((g) => {
      ctx.beginPath();
      ctx.moveTo(pL, erY(g));
      ctx.lineTo(pL + W, erY(g));
      ctx.stroke();
    });

    const grad = ctx.createLinearGradient(0, pT, 0, pT + H);
    grad.addColorStop(0, `${C.purple}40`);
    grad.addColorStop(1, `${C.purple}08`);
    ctx.beginPath();
    er.forEach((v, i) => (i === 0 ? ctx.moveTo(xS(i), erY(v)) : ctx.lineTo(xS(i), erY(v))));
    ctx.lineTo(xS(er.length - 1), pT + H);
    ctx.lineTo(xS(0), pT + H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = C.purple;
    ctx.lineWidth = 1.5;
    er.forEach((v, i) => (i === 0 ? ctx.moveTo(xS(i), erY(v)) : ctx.lineTo(xS(i), erY(v))));
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = C.yellow;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    sf.forEach((v, i) => {
      if (Number.isNaN(v)) return;
      i === 0 ? ctx.moveTo(xS(i), sfY(v)) : ctx.lineTo(xS(i), sfY(v));
    });
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = C.purple;
    ctx.fillText("ER", pL + W + 3, pT + 10);
    ctx.fillStyle = C.yellow;
    ctx.fillText("F×", pL + W + 3, pT + H - 4);
    ctx.fillStyle = C.sub;
    [minFactor, maxFactor].forEach((v) => ctx.fillText(v.toFixed(1), pL + W + 20, sfY(v) + 3));
  }, [result, width, height, minFactor, maxFactor, viewRange]);

  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

interface EquityChartProps {
  result: AdaptiveBacktestResult;
  width: number;
  height: number;
}

export function EquityChart({ result, width, height }: EquityChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !result) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, height);

    const curve = result.equityCurve.filter((v) => !Number.isNaN(v));
    if (curve.length < 2) return;

    const pL = 10;
    const pR = 72;
    const pT = 8;
    const pB = 14;
    const W = width - pL - pR;
    const H = height - pT - pB;
    const yMin = Math.min(...curve) * 0.995;
    const yMax = Math.max(...curve) * 1.005;
    const full = result.equityCurve;
    const xS = (i: number) => pL + (i / (full.length - 1)) * W;
    const yS = (v: number) => pT + H - ((v - yMin) / (yMax - yMin)) * H;

    const base = 10000;
    const baseY = yS(base);
    ctx.strokeStyle = C.border2;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(pL, baseY);
    ctx.lineTo(pL + W, baseY);
    ctx.stroke();
    ctx.setLineDash([]);

    const isUp = (full[full.length - 1] || 0) >= base;
    const grad = ctx.createLinearGradient(0, pT, 0, pT + H);
    grad.addColorStop(0, `${isUp ? C.accent : C.red}35`);
    grad.addColorStop(1, `${isUp ? C.accent : C.red}05`);

    ctx.beginPath();
    let started = false;
    full.forEach((v, i) => {
      if (Number.isNaN(v)) return;
      if (!started) {
        ctx.moveTo(xS(i), yS(v));
        started = true;
      } else ctx.lineTo(xS(i), yS(v));
    });
    ctx.lineTo(xS(full.length - 1), pT + H);
    ctx.lineTo(pL, pT + H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isUp ? C.accent : C.red;
    started = false;
    full.forEach((v, i) => {
      if (Number.isNaN(v)) return;
      if (!started) {
        ctx.moveTo(xS(i), yS(v));
        started = true;
      } else ctx.lineTo(xS(i), yS(v));
    });
    ctx.stroke();

    const finalVal = curve[curve.length - 1];
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = isUp ? C.accent : C.red;
    ctx.fillText(`$${finalVal.toFixed(0)}`, pL + W + 3, yS(finalVal) + 3);
    ctx.fillStyle = C.sub;
    ctx.fillText("$10K", pL + W + 3, baseY + 3);
  }, [result, width, height]);

  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}
