import { useEffect, useRef } from "react";
import type { AdaptiveCandle, AdaptiveEngineResult } from "@/lib/adaptive-supertrend";
import { AST_COLORS as C } from "./theme";

interface PriceChartProps {
  candles: AdaptiveCandle[];
  result: AdaptiveEngineResult;
  width: number;
  height: number;
  visibleBars?: number;
}

export function PriceChart({
  candles,
  result,
  width,
  height,
  visibleBars = 120,
}: PriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !candles.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const padL = 12;
    const padR = 68;
    const padT = 18;
    const padB = 28;
    const W = width - padL - padR;
    const H = height - padT - padB;

    const n = candles.length;
    const visStart = Math.max(0, n - visibleBars);
    const vis = candles.slice(visStart);
    const stVis = result.stLine.slice(visStart);
    const dirVis = result.direction.slice(visStart);

    const allPrices = vis.flatMap((c) => [c.high, c.low]);
    const stPrices = stVis.filter((v) => !Number.isNaN(v));
    const allY = [...allPrices, ...stPrices];
    const yMin = Math.min(...allY) * 0.998;
    const yMax = Math.max(...allY) * 1.002;

    const xScale = (i: number) => padL + (i / (vis.length - 1)) * W;
    const yScale = (v: number) => padT + H - ((v - yMin) / (yMax - yMin)) * H;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = C.gridLine;
    ctx.lineWidth = 1;
    for (let g = 0; g <= 5; g++) {
      const y = padT + (g / 5) * H;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + W, y);
      ctx.stroke();
      const price = yMax - (g / 5) * (yMax - yMin);
      ctx.fillStyle = C.sub;
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText(price.toFixed(2), padL + W + 4, y + 4);
    }

    const cW = Math.max(1, W / vis.length - 1.5);
    vis.forEach((c, i) => {
      const x = xScale(i);
      const bull = c.close >= c.open;
      ctx.strokeStyle = bull ? C.accent : C.red;
      ctx.fillStyle = bull ? `${C.accent}99` : `${C.red}99`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yScale(c.high));
      ctx.lineTo(x, yScale(c.low));
      ctx.stroke();
      const oY = yScale(Math.max(c.open, c.close));
      const cY = yScale(Math.min(c.open, c.close));
      const bH = Math.max(1, Math.abs(oY - cY));
      ctx.fillRect(x - cW / 2, oY, cW, bH);
    });

    ctx.lineWidth = 2;
    let inBull = dirVis[0] === 1;
    ctx.beginPath();
    let started = false;
    stVis.forEach((v, i) => {
      if (Number.isNaN(v)) return;
      const isBull = dirVis[i] === 1;
      if (isBull !== inBull || !started) {
        if (started) ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = isBull ? C.accent : C.red;
        inBull = isBull;
        ctx.moveTo(xScale(i), yScale(v));
        started = true;
      } else {
        ctx.lineTo(xScale(i), yScale(v));
      }
    });
    ctx.stroke();

    result.signals.forEach((s) => {
      const si = s.i - visStart;
      if (si < 0 || si >= vis.length) return;
      const x = xScale(si);
      const y = yScale(s.price) + (s.type === "long" ? 14 : -14);
      ctx.beginPath();
      ctx.fillStyle = s.type === "long" ? C.accent : C.red;
      if (s.type === "long") {
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 5, y + 2);
        ctx.lineTo(x - 5, y + 2);
      } else {
        ctx.moveTo(x, y + 8);
        ctx.lineTo(x + 5, y - 2);
        ctx.lineTo(x - 5, y - 2);
      }
      ctx.fill();
    });

    ctx.fillStyle = C.sub;
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    for (let g = 0; g <= 4; g++) {
      const i = Math.round((g / 4) * (vis.length - 1));
      const barNum = visStart + i;
      ctx.fillText(`Bar ${barNum}`, xScale(i), padT + H + 18);
    }
  }, [candles, result, width, height, visibleBars]);

  return <canvas ref={canvasRef} style={{ width, height, display: "block" }} />;
}

interface EquityChartProps {
  curve: number[];
  width: number;
  height: number;
}

export function EquityChart({ curve, width, height }: EquityChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !curve.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const padL = 6;
    const padR = 54;
    const padT = 10;
    const padB = 20;
    const W = width - padL - padR;
    const H = height - padT - padB;

    const yMin = Math.min(...curve) * 0.998;
    const yMax = Math.max(...curve) * 1.002;
    const xS = (i: number) => padL + (i / (curve.length - 1)) * W;
    const yS = (v: number) => padT + H - ((v - yMin) / (yMax - yMin)) * H;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = C.gridLine;
    ctx.lineWidth = 1;
    for (let g = 0; g <= 3; g++) {
      const y = padT + (g / 3) * H;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + W, y);
      ctx.stroke();
      const v = yMax - (g / 3) * (yMax - yMin);
      ctx.fillStyle = C.sub;
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`$${v.toFixed(0)}`, padL + W + 4, y + 3);
    }

    const grad = ctx.createLinearGradient(0, padT, 0, padT + H);
    grad.addColorStop(0, `${C.accent}40`);
    grad.addColorStop(1, `${C.accent}00`);
    ctx.beginPath();
    ctx.moveTo(xS(0), yS(curve[0]));
    curve.forEach((v, i) => ctx.lineTo(xS(i), yS(v)));
    ctx.lineTo(xS(curve.length - 1), padT + H);
    ctx.lineTo(xS(0), padT + H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.5;
    curve.forEach((v, i) =>
      i === 0 ? ctx.moveTo(xS(i), yS(v)) : ctx.lineTo(xS(i), yS(v))
    );
    ctx.stroke();
  }, [curve, width, height]);

  return <canvas ref={canvasRef} style={{ width, height, display: "block" }} />;
}

interface ERChartProps {
  er: number[];
  smoothedFactor: number[];
  width: number;
  height: number;
  minFactor: number;
  maxFactor: number;
  visibleBars?: number;
}

export function ERChart({
  er,
  smoothedFactor,
  width,
  height,
  minFactor,
  maxFactor,
  visibleBars = 120,
}: ERChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const padL = 6;
    const padR = 52;
    const padT = 10;
    const padB = 18;
    const W = width - padL - padR;
    const H = height - padT - padB;

    const vis = er.slice(Math.max(0, er.length - visibleBars));
    const sfVis = smoothedFactor.slice(Math.max(0, smoothedFactor.length - visibleBars));

    const xS = (i: number) => padL + (i / (vis.length - 1)) * W;
    const erY = (v: number) => padT + H - v * H;
    const sfMin = minFactor * 0.95;
    const sfMax = maxFactor * 1.05;
    const sfY = (v: number) => padT + H - ((v - sfMin) / (sfMax - sfMin)) * H;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = C.gridLine;
    ctx.lineWidth = 1;
    [0, 0.5, 1].forEach((g) => {
      const y = erY(g);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + W, y);
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.moveTo(xS(0), erY(vis[0] || 0));
    vis.forEach((v, i) => ctx.lineTo(xS(i), erY(v)));
    ctx.lineTo(xS(vis.length - 1), padT + H);
    ctx.lineTo(xS(0), padT + H);
    ctx.closePath();
    ctx.fillStyle = `${C.purple}25`;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = C.purple;
    ctx.lineWidth = 1.5;
    vis.forEach((v, i) =>
      i === 0 ? ctx.moveTo(xS(i), erY(v)) : ctx.lineTo(xS(i), erY(v))
    );
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    sfVis.forEach((v, i) => {
      if (Number.isNaN(v)) return;
      i === 0 ? ctx.moveTo(xS(i), sfY(v)) : ctx.lineTo(xS(i), sfY(v));
    });
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = C.purple;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillText("ER", padL + W + 4, padT + 4);
    ctx.fillStyle = C.warn;
    ctx.fillText("F", padL + W + 4, padT + H - 4);
    [minFactor, maxFactor].forEach((v) => {
      ctx.fillStyle = `${C.warn}88`;
      ctx.fillText(v.toFixed(1), padL + W + 14, sfY(v) + 3);
    });
  }, [er, smoothedFactor, width, height, minFactor, maxFactor, visibleBars]);

  return <canvas ref={canvasRef} style={{ width, height, display: "block" }} />;
}
