import { relations } from "drizzle-orm";
import {
  users, positions, trades, signals, systemLogs, exchangeCredentials,
  tradingAccounts, accountLedger, accountSnapshots,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  positions: many(positions),
  trades: many(trades),
  credentials: many(exchangeCredentials),
}));

export const positionsRelations = relations(positions, ({ one, many }) => ({
  user: one(users, {
    fields: [positions.userId],
    references: [users.id],
  }),
  trades: many(trades),
  signal: one(signals, {
    fields: [positions.signalId],
    references: [signals.id],
  }),
}));

export const tradesRelations = relations(trades, ({ one }) => ({
  user: one(users, {
    fields: [trades.userId],
    references: [users.id],
  }),
  position: one(positions, {
    fields: [trades.positionId],
    references: [positions.id],
  }),
}));

export const signalsRelations = relations(signals, ({ many }) => ({
  positions: many(positions),
}));

export const systemLogsRelations = relations(systemLogs, ({}) => ({}));

export const exchangeCredentialsRelations = relations(exchangeCredentials, ({ one }) => ({
  user: one(users, {
    fields: [exchangeCredentials.userId],
    references: [users.id],
  }),
}));

export const tradingAccountsRelations = relations(tradingAccounts, ({ many }) => ({
  ledger: many(accountLedger),
  snapshots: many(accountSnapshots),
}));

export const accountLedgerRelations = relations(accountLedger, ({ one }) => ({
  account: one(tradingAccounts, {
    fields: [accountLedger.accountId],
    references: [tradingAccounts.id],
  }),
}));

export const accountSnapshotsRelations = relations(accountSnapshots, ({ one }) => ({
  account: one(tradingAccounts, {
    fields: [accountSnapshots.accountId],
    references: [tradingAccounts.id],
  }),
}));
