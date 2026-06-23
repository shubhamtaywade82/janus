// ─── PTA Relations ──────────────────────────────────────────────────────────
// Relations for tables defined in db/pta-schema.ts only.
// Existing relations (positions, trades, orders, etc.) stay in db/relations.ts.

import { relations } from "drizzle-orm";
import {
  tradePriceTicks,
  fundingEvents,
  systemEvents,
} from "./pta-schema";

export const tradePriceTicksRelations = relations(tradePriceTicks, () => ({}));

export const fundingEventsRelations = relations(fundingEvents, () => ({}));

export const systemEventsRelations = relations(systemEvents, () => ({}));
