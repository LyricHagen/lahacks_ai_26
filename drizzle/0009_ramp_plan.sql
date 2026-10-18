CREATE TABLE "ramp_dismissals" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"user_id" text,
	"visitor_id" text,
	"section" text NOT NULL,
	"ref_id" text NOT NULL,
	"skill_id" text,
	"week_start" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ramp_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"user_id" text,
	"visitor_id" text,
	"employee_id" text NOT NULL,
	"week_start" date NOT NULL,
	"signature" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ramp_dismissals" ADD CONSTRAINT "ramp_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramp_plans" ADD CONSTRAINT "ramp_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ramp_plans" ADD CONSTRAINT "ramp_plans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ramp_dismissals_owner_ref_idx" ON "ramp_dismissals" USING btree ("owner","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ramp_plans_owner_week_idx" ON "ramp_plans" USING btree ("owner","week_start");