ALTER TABLE "ask_messages" ADD COLUMN "variant" text DEFAULT 'short' NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD COLUMN "original_subject" text;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD COLUMN "original_body" text;--> statement-breakpoint
ALTER TABLE "ask_messages" ADD COLUMN "source" text DEFAULT 'template' NOT NULL;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "sent_app_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "answered_via" text;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "answer_note" text;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "answered_by_id" text;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "answered_doc_id" text;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_answered_by_id_employees_id_fk" FOREIGN KEY ("answered_by_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_answered_doc_id_documents_id_fk" FOREIGN KEY ("answered_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ask_messages_variant_idx" ON "ask_messages" USING btree ("ask_id","variant");