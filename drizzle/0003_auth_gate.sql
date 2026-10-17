CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "mode" text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "outcome" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_log" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "admin_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rejected_by" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_log_created_idx" ON "usage_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_employee_idx" ON "users" USING btree ("employee_id") WHERE "users"."employee_id" is not null;