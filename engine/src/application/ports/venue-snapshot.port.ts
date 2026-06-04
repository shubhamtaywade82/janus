/**
 * VenueSnapshot — captures best bid/ask from both the data-source exchange
 * and the execution exchange before placing an order.
 *
 * Used to detect cross-exchange drift: if the execution venue has already
 * moved significantly against the signal generated from the data-source,
 * the order should be rejected to avoid chasing a stale price.
 */

export interface VenueSnapshot {
  symbol: string;
  /** Binance (data source) */
  dataBid: number;
  dataAsk: number;
  dataMid: number;
  /** Execution venue */
  execBid: number;
  execAsk: number;
  execMid: number;
  /** Price drift: execMid - dataMid */
  drift: number;
  /** Absolute drift in basis points */
  driftBps: number;
  ts: number;
}

export function buildVenueSnapshot(
  symbol: string,
  dataBid: number,
  dataAsk: number,
  execBid: number,
  execAsk: number
): VenueSnapshot {
  const dataMid = (dataBid + dataAsk) / 2;
  const execMid = (execBid + execAsk) / 2;
  const drift = execMid - dataMid;
  const driftBps = dataMid > 0 ? (Math.abs(drift) / dataMid) * 10_000 : 0;

  return { symbol, dataBid, dataAsk, dataMid, execBid, execAsk, execMid, drift, driftBps, ts: Date.now() };
}

/**
 * Returns true when the execution venue has drifted beyond the allowed
 * threshold — signal should be discarded.
 */
export function isDriftExcessive(snapshot: VenueSnapshot, maxDriftBps: number): boolean {
  return snapshot.driftBps > maxDriftBps;
}
