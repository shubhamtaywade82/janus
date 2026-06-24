import { getUsdtInrRate } from "./coindcx";
import { WalletLedgerService } from "./WalletLedgerService";

export type PaperWalletCurrency = "USDT" | "INR";

export async function usdtToWallet(
  amountUsdt: number,
  currency: PaperWalletCurrency
): Promise<number> {
  if (currency === "USDT") return amountUsdt;
  const rate = await getUsdtInrRate();
  return amountUsdt * rate;
}

export async function walletToUsdt(
  amount: number,
  currency: PaperWalletCurrency
): Promise<number> {
  if (currency === "USDT") return amount;
  const rate = await getUsdtInrRate();
  return rate > 0 ? amount / rate : amount;
}

export async function lockPaperPositionMargin(
  userId: number,
  marginUsdt: number,
  referenceId: number,
  currency: PaperWalletCurrency,
  referenceType = "position"
): Promise<void> {
  const marginWallet = await usdtToWallet(marginUsdt, currency);
  await WalletLedgerService.lockMargin(
    userId,
    "paper",
    currency,
    marginWallet.toFixed(8),
    referenceId,
    referenceType
  );
}

export async function releasePaperPositionMargin(
  userId: number,
  marginUsdt: number,
  realizedPnlUsdt: number,
  positionId: number,
  currency: PaperWalletCurrency
): Promise<void> {
  const marginWallet = await usdtToWallet(marginUsdt, currency);
  const pnlWallet = await usdtToWallet(realizedPnlUsdt, currency);
  await WalletLedgerService.releaseMargin(
    userId,
    "paper",
    currency,
    marginWallet.toFixed(8),
    pnlWallet.toFixed(8),
    positionId,
    pnlWallet > 0
  );
}

export function computeMarginUsdt(
  size: number,
  entryPrice: number,
  leverage: number
): number {
  if (leverage <= 0 || size <= 0 || entryPrice <= 0) return 0;
  return (size * entryPrice) / leverage;
}

/** Pre-fix rows stored USDT margin in `positions.margin` while `marginCurrency` was INR. */
export function isLegacyInrLabelledUsdtMargin(
  marginStored: number,
  marginCurrency: PaperWalletCurrency,
  marginUsdtExpected: number
): boolean {
  return (
    marginCurrency === "INR" &&
    marginStored > 0 &&
    marginUsdtExpected > 0 &&
    marginStored <= marginUsdtExpected * 1.05
  );
}

export function paperMarginStoredToUsdtSync(
  marginStored: number,
  marginCurrency: PaperWalletCurrency,
  marginUsdtExpected: number,
  usdtInrRate: number
): number {
  if (marginCurrency === "USDT") return marginStored;
  if (isLegacyInrLabelledUsdtMargin(marginStored, marginCurrency, marginUsdtExpected)) {
    return marginStored;
  }
  return usdtInrRate > 0 ? marginStored / usdtInrRate : marginStored;
}

export function paperMarginStoredToWalletSync(
  marginStored: number,
  marginCurrency: PaperWalletCurrency,
  marginUsdtExpected: number,
  usdtInrRate: number
): number {
  if (marginCurrency === "USDT") return marginStored;
  if (isLegacyInrLabelledUsdtMargin(marginStored, marginCurrency, marginUsdtExpected)) {
    return marginStored * usdtInrRate;
  }
  return marginStored;
}

export async function paperMarginStoredToUsdt(
  marginStored: number,
  marginCurrency: PaperWalletCurrency,
  marginUsdtExpected: number
): Promise<number> {
  if (marginCurrency === "USDT") return marginStored;
  if (isLegacyInrLabelledUsdtMargin(marginStored, marginCurrency, marginUsdtExpected)) {
    return marginStored;
  }
  return walletToUsdt(marginStored, marginCurrency);
}

export async function paperMarginStoredToWallet(
  marginStored: number,
  marginCurrency: PaperWalletCurrency,
  marginUsdtExpected: number
): Promise<number> {
  if (marginCurrency === "USDT") return marginStored;
  if (isLegacyInrLabelledUsdtMargin(marginStored, marginCurrency, marginUsdtExpected)) {
    return usdtToWallet(marginStored, "INR");
  }
  return marginStored;
}

export async function usdtMarginToStored(
  marginUsdt: number,
  currency: PaperWalletCurrency
): Promise<number> {
  return currency === "INR" ? usdtToWallet(marginUsdt, "INR") : marginUsdt;
}

export async function resolvePaperPositionMargin(input: {
  marginStored: number;
  marginCurrency: PaperWalletCurrency;
  size: number;
  entryPrice: number;
  leverage: number;
}): Promise<{ marginUsdt: number; marginWallet: number }> {
  const marginUsdtExpected = computeMarginUsdt(
    input.size,
    input.entryPrice,
    input.leverage
  );
  const marginUsdt = await paperMarginStoredToUsdt(
    input.marginStored,
    input.marginCurrency,
    marginUsdtExpected
  );
  const marginWallet = await paperMarginStoredToWallet(
    input.marginStored,
    input.marginCurrency,
    marginUsdtExpected
  );
  return { marginUsdt, marginWallet };
}
