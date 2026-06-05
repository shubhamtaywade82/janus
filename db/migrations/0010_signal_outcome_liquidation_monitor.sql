-- Migration: Signal outcome tracking + liquidation price population helper
--
-- 1. Add signal_outcome enum type
-- 2. Add outcome column to signals table
-- 3. Add index for win-rate queries (outcome + symbol + direction)

DO $$ BEGIN
  CREATE TYPE "signal_outcome" AS ENUM ('tp_hit', 'sl_hit', 'manual_close', 'liquidated', 'timeout', 'open');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "signals"
  ADD COLUMN IF NOT EXISTS "outcome" signal_outcome;

CREATE INDEX IF NOT EXISTS "idx_signals_outcome"
  ON "signals" ("symbol", "direction", "outcome")
  WHERE "outcome" IS NOT NULL;
