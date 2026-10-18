ALTER TYPE "public"."ask_state" ADD VALUE 'confirming' BEFORE 'retrieving';--> statement-breakpoint
CREATE TABLE "ask_doc_checks" (
	"ask_id" text NOT NULL,
	"document_id" text NOT NULL,
	"rank" smallint NOT NULL,
	"score" real NOT NULL,
	"section" text NOT NULL,
	"why" text NOT NULL,
	"verdict" text,
	"verdict_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ask_doc_checks_ask_id_document_id_pk" PRIMARY KEY("ask_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "ask_candidates" ALTER COLUMN "rank" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_candidates" ALTER COLUMN "score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_candidates" ALTER COLUMN "breakdown" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "ask_candidates" ADD COLUMN "sources" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_candidates" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "asks" ADD COLUMN "retrieval" jsonb;--> statement-breakpoint
ALTER TABLE "ask_doc_checks" ADD CONSTRAINT "ask_doc_checks_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_doc_checks" ADD CONSTRAINT "ask_doc_checks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_doc_checks_doc_idx" ON "ask_doc_checks" USING btree ("document_id","verdict");