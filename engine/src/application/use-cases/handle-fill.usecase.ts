import type { Fill } from "../../domain/fills/fill.js";
import { LedgerEngine } from "../services/ledger-engine.js";

export class HandleFillUseCase {
  constructor(
    private readonly ledgerEngine: LedgerEngine,
    private readonly accountId: string
  ) {}

  async execute(fill: Omit<Fill, "id">, markPrice: number, contractMultiplier = 1): Promise<void> {
    await this.ledgerEngine.applyFill(fill);
    await this.ledgerEngine.recalcPosition(
      this.accountId, fill.symbol, fill.exchange, markPrice, contractMultiplier
    );
  }
}
