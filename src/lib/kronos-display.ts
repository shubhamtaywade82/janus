export interface KronosSignalMetadata {
  boost: number;
  directionSignal: number;
  volatilityForecast: number;
  confidence: number;
}

export interface KronosLivePrediction {
  directionSignal: number;
  volatilityForecast: number;
  confidence: number;
  timestamp?: string | Date;
}

export interface KronosCardData extends KronosSignalMetadata {
  isLive: boolean;
}

export function normalizeBinanceSymbol(symbol: string): string {
  return symbol.replace(/^B-/, "").replace(/_/g, "").toUpperCase();
}

export function kronosBias(directionSignal: number): "bullish" | "bearish" | "neutral" {
  if (directionSignal > 0.05) return "bullish";
  if (directionSignal < -0.05) return "bearish";
  return "neutral";
}

export function parseKronosMetadata(raw: unknown): KronosSignalMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const k = raw as Partial<KronosSignalMetadata>;
  if (
    typeof k.directionSignal !== "number" ||
    typeof k.volatilityForecast !== "number" ||
    typeof k.confidence !== "number"
  ) {
    return null;
  }
  return {
    boost: typeof k.boost === "number" ? k.boost : 0,
    directionSignal: k.directionSignal,
    volatilityForecast: k.volatilityForecast,
    confidence: k.confidence,
  };
}

export function resolveKronosForCard(
  metadata: KronosSignalMetadata | null | undefined,
  live: KronosLivePrediction | null | undefined,
): KronosCardData | null {
  if (live) {
    return {
      directionSignal: live.directionSignal,
      volatilityForecast: live.volatilityForecast,
      confidence: live.confidence,
      boost: metadata?.boost ?? 0,
      isLive: true,
    };
  }
  if (metadata) {
    return { ...metadata, isLive: false };
  }
  return null;
}
