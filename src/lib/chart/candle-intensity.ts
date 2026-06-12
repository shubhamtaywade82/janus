/**
 * Candle Intensity Engine
 *
 * Maps a per-bar metric (volume, body %, momentum, delta) to a color that
 * varies in hue + lightness — producing a proper heatmap gradient on the
 * candlestick chart.
 *
 * Uses **percentile-based normalisation** so that a single outlier spike
 * doesn't wash every other candle to near-minimum intensity.
 */

// ─── Public types ───────────────────────────────────────────────────────────

/** Which metric drives the heatmap colour. "off" restores the default flat candle colours. */
export type IntensityMode = "off" | "volume" | "body" | "momentum" | "volDelta";

export interface IntensityColors {
  color: string;
  wickColor: string;
  borderColor: string;
}

export interface CandleBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Colour ramps ───────────────────────────────────────────────────────────

/**
 * Bullish gradient: cool teal → vivid emerald → hot lime
 * Bearish gradient: cool crimson → vivid red → hot magenta
 *
 * Each stop is [hue, saturation%, lightness%].
 * We interpolate linearly between stops based on the normalised 0–1 score.
 */
const BULL_RAMP: [number, number, number][] = [
  [174, 55, 22],   // 0.0 — muted teal (very low intensity)
  [160, 70, 32],   // 0.25
  [148, 80, 42],   // 0.5 — mid green
  [142, 90, 50],   // 0.75
  [130, 100, 55],  // 1.0 — vivid bright lime-green (max intensity)
];

const BEAR_RAMP: [number, number, number][] = [
  [0,   45, 25],   // 0.0 — muted dark crimson
  [355, 60, 32],   // 0.25
  [350, 75, 42],   // 0.5 — mid red
  [345, 88, 50],   // 0.75
  [330, 100, 55],  // 1.0 — vivid hot magenta-pink (max intensity)
];

function interpolateRamp(ramp: [number, number, number][], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const segCount = ramp.length - 1;
  const scaledT = clamped * segCount;
  const idx = Math.min(Math.floor(scaledT), segCount - 1);
  const frac = scaledT - idx;

  const [h1, s1, l1] = ramp[idx];
  const [h2, s2, l2] = ramp[idx + 1];

  const h = h1 + (h2 - h1) * frac;
  const s = s1 + (s2 - s1) * frac;
  const l = l1 + (l2 - l1) * frac;

  return `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
}

// ─── Percentile normalisation ───────────────────────────────────────────────

/**
 * Precompute percentile lookup from an array of raw metric values.
 * Returns { p10, p50, p90 } — we'll map the value into [0,1] using
 * a piecewise linear function anchored at p10=0.05, p50=0.4, p90=0.9.
 * This prevents outlier spikes from flattening the rest.
 */
interface PercentileBands {
  p10: number;
  p50: number;
  p90: number;
  max: number;
}

function computePercentiles(values: number[]): PercentileBands {
  if (values.length === 0) return { p10: 0, p50: 0, p90: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (pct: number) => sorted[Math.min(Math.floor(pct * sorted.length), sorted.length - 1)];
  return {
    p10: pick(0.10),
    p50: pick(0.50),
    p90: pick(0.90),
    max: sorted[sorted.length - 1],
  };
}

/**
 * Piecewise linear percentile mapping:
 *   value ≤ p10  →  0.05 .. 0.15 (cool zone)
 *   p10 < value ≤ p50  →  0.15 .. 0.45 (normal zone)
 *   p50 < value ≤ p90  →  0.45 .. 0.85 (warm zone)
 *   value > p90  →  0.85 .. 1.0 (hot zone)
 */
function percentileNormalize(value: number, bands: PercentileBands): number {
  if (bands.max <= 0) return 0.5;
  if (value <= bands.p10) {
    // Below p10: map proportionally into [0.05, 0.15]
    const t = bands.p10 > 0 ? value / bands.p10 : 0;
    return 0.05 + t * 0.10;
  }
  if (value <= bands.p50) {
    const t = (value - bands.p10) / Math.max(bands.p50 - bands.p10, 1e-10);
    return 0.15 + t * 0.30;
  }
  if (value <= bands.p90) {
    const t = (value - bands.p50) / Math.max(bands.p90 - bands.p50, 1e-10);
    return 0.45 + t * 0.40;
  }
  // Above p90: map into [0.85, 1.0], capped at max
  const t = (value - bands.p90) / Math.max(bands.max - bands.p90, 1e-10);
  return 0.85 + Math.min(t, 1) * 0.15;
}

// ─── Metric extractors ─────────────────────────────────────────────────────

function extractMetric(bar: CandleBar, mode: IntensityMode): number {
  switch (mode) {
    case "volume":
      return bar.volume;

    case "body": {
      // Body percentage relative to full range (high - low)
      const range = bar.high - bar.low;
      if (range <= 0) return 0;
      return Math.abs(bar.close - bar.open) / range;
    }

    case "momentum": {
      // Absolute % price change (close vs open)
      if (bar.open <= 0) return 0;
      return Math.abs((bar.close - bar.open) / bar.open);
    }

    case "volDelta": {
      // Volume × direction magnitude — high volume + big body = high delta
      const range = bar.high - bar.low;
      const bodyRatio = range > 0 ? Math.abs(bar.close - bar.open) / range : 0;
      return bar.volume * bodyRatio;
    }

    default:
      return 0;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Precompute percentile bands for the entire data set.
 * Call once on full data reload; returns an opaque handle.
 */
export function buildIntensityBands(bars: CandleBar[], mode: IntensityMode): PercentileBands {
  if (mode === "off") return { p10: 0, p50: 0, p90: 0, max: 0 };
  const values = bars.map((b) => extractMetric(b, mode));
  return computePercentiles(values);
}

/**
 * Get the heatmap colour for a single bar given precomputed bands.
 */
export function getIntensityColor(
  bar: CandleBar,
  mode: IntensityMode,
  bands: PercentileBands,
  themeUpColor?: string,
  themeDownColor?: string,
): IntensityColors {
  if (mode === "off") {
    // Default flat candle colours — green/red or theme colors
    const isBull = bar.close >= bar.open;
    const up = themeUpColor || "rgba(14, 203, 129, 1)";
    const down = themeDownColor || "rgba(246, 70, 93, 1)";
    const c = isBull ? up : down;
    return { color: c, wickColor: c, borderColor: c };
  }

  const metric = extractMetric(bar, mode);
  const t = percentileNormalize(metric, bands);
  const isBull = bar.close >= bar.open;
  const color = interpolateRamp(isBull ? BULL_RAMP : BEAR_RAMP, t);

  return { color, wickColor: color, borderColor: color };
}

/**
 * Get intensity colour for a single live-tick bar using a running max estimate.
 * Used during animation when we don't want to recompute full percentiles.
 * Falls back to a simpler linear mapping against the running max.
 */
export function getLiveIntensityColor(
  bar: CandleBar,
  mode: IntensityMode,
  bands: PercentileBands,
  themeUpColor?: string,
  themeDownColor?: string,
): IntensityColors {
  return getIntensityColor(bar, mode, bands, themeUpColor, themeDownColor);
}

/**
 * Mode metadata for UI rendering.
 */
export const INTENSITY_MODES: { mode: IntensityMode; label: string; description: string; icon: string }[] = [
  { mode: "off",       label: "Default",       description: "Standard green/red candles",      icon: "🕯️" },
  { mode: "volume",    label: "Volume",         description: "Higher volume → hotter color",    icon: "📊" },
  { mode: "body",      label: "Body Size",      description: "Larger body → hotter color",      icon: "📏" },
  { mode: "momentum",  label: "Momentum",       description: "Bigger price change → hotter",    icon: "⚡" },
  { mode: "volDelta",  label: "Vol × Body",     description: "Volume weighted by body ratio",   icon: "🔥" },
];
