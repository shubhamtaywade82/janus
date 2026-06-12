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
