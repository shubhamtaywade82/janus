// src/lib/position-utils.ts
export function weightedEntryPrice(
  existingEntry: string,
  existingSize: string,
  newEntry: string,
  newSize: string
): string {
  const eSize = parseFloat(existingSize) || 0;
  const nSize = parseFloat(newSize) || 0;
  const totalSize = eSize + nSize;
  if (totalSize === 0) return "0";

  const weighted =
    (parseFloat(existingEntry) * eSize + parseFloat(newEntry) * nSize) /
    totalSize;
  return weighted.toFixed(8);
}
