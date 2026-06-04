CREATE TABLE "open_interest_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"open_interest" numeric(24, 4) NOT NULL,
	"quote_oi" numeric(24, 4),
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_oi_symbol_timestamp" ON "open_interest_data" USING btree ("symbol","timestamp");
--> statement-breakpoint
CREATE TABLE "funding_rate_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"funding_rate" numeric(18, 8) NOT NULL,
	"mark_price" numeric(18, 8) NOT NULL,
	"next_funding_time" timestamp NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_funding_symbol_timestamp" ON "funding_rate_history" USING btree ("symbol","timestamp");
--> statement-breakpoint
CREATE TABLE "liquidation_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"side" varchar(10) NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"filled_qty" numeric(18, 8),
	"status" varchar(20),
	"trade_time" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_liquidation_symbol_time" ON "liquidation_events" USING btree ("symbol","trade_time");
