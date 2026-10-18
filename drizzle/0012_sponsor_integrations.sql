CREATE TABLE "ask_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ask_id" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"data_base64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ask_id" text NOT NULL,
	"variant" text NOT NULL,
	"format" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"photon_message_id" text,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "photon_inbound" (
	"message_id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"user_id" text,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_phones" (
	"user_id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"link_code" text,
	"code_expires_at" timestamp with time zone,
	"platform" text,
	"space_id" text,
	"agent_user_id" text,
	"last_inbound_id" text,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_phones_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "ask_attachments" ADD CONSTRAINT "ask_attachments_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_deliveries" ADD CONSTRAINT "phone_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_deliveries" ADD CONSTRAINT "phone_deliveries_ask_id_asks_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."asks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photon_inbound" ADD CONSTRAINT "photon_inbound_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_phones" ADD CONSTRAINT "user_phones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_deliveries_user_idx" ON "phone_deliveries" USING btree ("user_id","created_at");