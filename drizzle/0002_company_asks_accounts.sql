CREATE TYPE "public"."ask_message_status" AS ENUM('draft', 'copied', 'marked_sent');--> statement-breakpoint
CREATE TYPE "public"."ask_source" AS ENUM('seed', 'user', 'demo');--> statement-breakpoint
CREATE TYPE "public"."ask_status" AS ENUM('draft', 'ranked', 'drafted', 'sent', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."calendar_kind" AS ENUM('meeting', 'one_on_one', 'standup', 'focus', 'interview', 'office_hours', 'ooo');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('onboarding', 'runbook', 'how_to', 'reference');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'finished');--> statement-breakpoint
CREATE TYPE "public"."seniority" AS ENUM('junior', 'mid', 'senior', 'staff', 'principal', 'manager', 'director', 'executive');--> statement-breakpoint
CREATE TYPE "public"."skill_source" AS ENUM('owns_service', 'project', 'authored_doc', 'team', 'profile');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE SEQUENCE "public"."ask_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1000 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."user_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "ask_candidates" (
	"ask_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"rank" smallint NOT NULL,
	"score" real NOT NULL,
	"breakdown" jsonb NOT NULL,
	"explanation" text,
	"chosen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_candidates_ask_id_employee_id_pk" PRIMARY KEY("ask_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "ask_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"ask_id" text NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ask_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ask_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" "ask_message_status" DEFAULT 'draft' NOT NULL,
	"slot_start" timestamp with time zone,
	"slot_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asks" (
	"id" text PRIMARY KEY DEFAULT 'ask_' || nextval('ask_id_seq') NOT NULL,
	"user_id" text,
	"asker_employee_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tried" text,
	"status" "ask_status" DEFAULT 'draft' NOT NULL,
	"source" "ask_source" DEFAULT 'user' NOT NULL,
	"routed_to_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" "calendar_kind" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"busy" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"author_id" text NOT NULL,
	"service_id" text,
	"body" text NOT NULL,
	"updated_on" date NOT NULL,
	"embedding" vector(256)
);
--> statement-breakpoint
CREATE TABLE "employee_skills" (
	"employee_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"proficiency" smallint NOT NULL,
	"source" "skill_source" NOT NULL,
	"evidence" text NOT NULL,
	CONSTRAINT "employee_skills_employee_id_skill_id_pk" PRIMARY KEY("employee_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"department" text NOT NULL,
	"team" text NOT NULL,
	"seniority" "seniority" NOT NULL,
	"timezone" text NOT NULL,
	"start_date" date NOT NULL,
	"manager_id" text,
	"slack_handle" text NOT NULL,
	"email" text NOT NULL,
	"bio" text NOT NULL,
	"is_mentor" boolean DEFAULT false NOT NULL,
	"max_weekly_asks" smallint NOT NULL,
	"embedding" vector(256)
);
--> statement-breakpoint
CREATE TABLE "mentorships" (
	"id" serial PRIMARY KEY NOT NULL,
	"mentor_id" text NOT NULL,
	"mentee_id" text NOT NULL,
	"focus" text NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"description" text NOT NULL,
	"seed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"role" text NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	CONSTRAINT "project_members_project_id_employee_id_pk" PRIMARY KEY("project_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"team" text NOT NULL,
	"service_id" text,
	"status" "project_status" NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"repo" text NOT NULL,
	"description" text NOT NULL,
	"team" text NOT NULL,
	"primary_owner_id" text NOT NULL,
	"secondary_owner_id" text NOT NULL,
	"skill_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"embedding" vector(256)
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_usd" numeric(12, 6),
	"demo" boolean DEFAULT false NOT NULL,
	"ask_id" text,
	"req_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT 'usr_' || nextval('user_id_seq') NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"employee_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ask_candidates" ADD CONSTRAINT "ask_candidates_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_candidates" ADD CONSTRAINT "ask_candidates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_events" ADD CONSTRAINT "ask_events_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_recipient_id_employees_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_asker_employee_id_employees_id_fk" FOREIGN KEY ("asker_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_routed_to_id_employees_id_fk" FOREIGN KEY ("routed_to_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_id_employees_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentorships" ADD CONSTRAINT "mentorships_mentor_id_employees_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentorships" ADD CONSTRAINT "mentorships_mentee_id_employees_id_fk" FOREIGN KEY ("mentee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_primary_owner_id_employees_id_fk" FOREIGN KEY ("primary_owner_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_secondary_owner_id_employees_id_fk" FOREIGN KEY ("secondary_owner_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_log" ADD CONSTRAINT "usage_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_events_ask_idx" ON "ask_events" USING btree ("ask_id","at");--> statement-breakpoint
CREATE INDEX "ask_messages_ask_idx" ON "ask_messages" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "asks_routed_idx" ON "asks" USING btree ("routed_to_id","created_at");--> statement-breakpoint
CREATE INDEX "asks_user_idx" ON "asks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "calendar_events_employee_start_idx" ON "calendar_events" USING btree ("employee_id","starts_at");--> statement-breakpoint
CREATE INDEX "documents_service_idx" ON "documents" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "documents_embedding_idx" ON "documents" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "employee_skills_skill_idx" ON "employee_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "employees_manager_idx" ON "employees" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employees_team_idx" ON "employees" USING btree ("team");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_email_idx" ON "employees" USING btree ("email");--> statement-breakpoint
CREATE INDEX "employees_embedding_idx" ON "employees" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "mentorships_mentor_idx" ON "mentorships" USING btree ("mentor_id");--> statement-breakpoint
CREATE INDEX "mentorships_mentee_idx" ON "mentorships" USING btree ("mentee_id");--> statement-breakpoint
CREATE INDEX "project_members_employee_idx" ON "project_members" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "services_primary_idx" ON "services" USING btree ("primary_owner_id");--> statement-breakpoint
CREATE INDEX "services_secondary_idx" ON "services" USING btree ("secondary_owner_id");--> statement-breakpoint
CREATE INDEX "usage_log_user_idx" ON "usage_log" USING btree ("user_id","created_at");