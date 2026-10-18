CREATE TYPE "public"."ask_state" AS ENUM('draft', 'understanding', 'retrieving', 'ranking', 'shortlist', 'drafting', 'ready', 'sent', 'answered', 'stale', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."ask_urgency" AS ENUM('blocked_now', 'blocked_today', 'curious');--> statement-breakpoint
CREATE TYPE "public"."contact_channel" AS ENUM('slack', 'email', 'call');--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"known_skill_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_focus" text DEFAULT '' NOT NULL,
	"preferred_channel" "contact_channel" DEFAULT 'slack' NOT NULL,
	"ok_to_interrupt_seniors" boolean DEFAULT false NOT NULL,
	"role_confirmed_at" timestamp with time zone,
	"context_at" timestamp with time zone,
	"channels_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"used_defaults" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ask_events" ALTER COLUMN "kind" SET DEFAULT 'transition';--> statement-breakpoint
ALTER TABLE "asks" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "asks" ALTER COLUMN "status" SET DATA TYPE "public"."ask_state" USING (CASE "status"::text WHEN 'resolved' THEN 'answered' WHEN 'ranked' THEN 'shortlist' WHEN 'drafted' THEN 'ready' WHEN 'cancelled' THEN 'abandoned' ELSE "status"::text END)::"public"."ask_state";--> statement-breakpoint
ALTER TABLE "asks" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "ask_events" ADD COLUMN "from_state" "ask_state";--> statement-breakpoint
ALTER TABLE "ask_events" ADD COLUMN "to_state" "ask_state";--> statement-breakpoint
ALTER TABLE "ask_events" ADD COLUMN "actor" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_events" ADD COLUMN "actor_id" text;--> statement-breakpoint
ALTER TABLE "ask_events" ADD COLUMN "reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_events" ADD COLUMN "req_id" text;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "urgency" "ask_urgency" DEFAULT 'blocked_today' NOT NULL;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "confidential" text;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "visitor_id" text;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "understanding" jsonb;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "embedding" vector(256);--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "progress" text;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "progress_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "run_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "last_error_req_id" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asks_visitor_idx" ON "asks" USING btree ("visitor_id","created_at");--> statement-breakpoint
-- Seeded history written before the lifecycle existed: "created" and "resolved" become transitions,
-- "marked_sent" stays a note.
UPDATE "ask_events" SET "kind" = 'transition', "to_state" = 'sent', "actor" = 'system', "reason" = 'seeded history: asked and routed directly, no ranking was run' WHERE "kind" = 'created';--> statement-breakpoint
UPDATE "ask_events" SET "kind" = 'transition', "from_state" = 'sent', "to_state" = 'answered', "actor" = 'system', "reason" = 'seeded history: answered' WHERE "kind" = 'resolved';
