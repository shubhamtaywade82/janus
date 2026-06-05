-- Migration: Alert Engine Tables
-- Adds three tables to make alert generation fully backend-driven:
--   user_alert_rules  — replaces localStorage "janus_alert_rules"
--   user_alert_logs   — replaces localStorage "janus_alert_logs"
--   system_alert_logs — persists backend-detected indicator/SMC/KNN events

CREATE TABLE IF NOT EXISTS "user_alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"type" varchar(30) NOT NULL,
	"operator" varchar(5),
	"value" numeric(18, 8),
	"is_active" boolean DEFAULT true NOT NULL,
	"cooldown_seconds" integer DEFAULT 60 NOT NULL,
	"notify_telegram" boolean DEFAULT true NOT NULL,
	"notify_webhook" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_user_alert_rules_user" ON "user_alert_rules" ("user_id","is_active");

CREATE TABLE IF NOT EXISTS "user_alert_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"rule_id" integer,
	"symbol" varchar(20) NOT NULL,
	"type" varchar(30) NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb,
	"triggered_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_user_alert_logs_user_time" ON "user_alert_logs" ("user_id","triggered_at");

ALTER TABLE "user_alert_logs" ADD CONSTRAINT "user_alert_logs_rule_id_user_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."user_alert_rules"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE IF NOT EXISTS "system_alert_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"type" varchar(30) NOT NULL,
	"direction" varchar(10),
	"interval" varchar(10),
	"message" text NOT NULL,
	"metadata" jsonb,
	"triggered_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_system_alert_logs_symbol_time" ON "system_alert_logs" ("symbol","triggered_at");
