CREATE TYPE "public"."status_page_event_type" AS ENUM('incident', 'maintenance');--> statement-breakpoint
CREATE TABLE "github_watched_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"status_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_page_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status_page_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"event_type" "status_page_event_type" NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"impact" text,
	"shortlink" text,
	"message_id" text,
	"last_update_id" text,
	"last_updated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"mention_role_id" text,
	"check_interval_seconds" integer DEFAULT 600 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_etag" text,
	"last_status_indicator" text,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"status_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "status_page_events" ADD CONSTRAINT "status_page_events_status_page_id_status_pages_id_fk" FOREIGN KEY ("status_page_id") REFERENCES "public"."status_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_watched_repositories_guild_id_owner_repo_unique" ON "github_watched_repositories" USING btree ("guild_id","owner","repo");--> statement-breakpoint
CREATE UNIQUE INDEX "status_page_events_status_page_id_event_type_external_id_unique" ON "status_page_events" USING btree ("status_page_id","event_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "status_pages_guild_id_base_url_unique" ON "status_pages" USING btree ("guild_id","base_url");
