CREATE TYPE "public"."artifact_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('research_brief', 'study_guide', 'compare_sources', 'learning_roadmap');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notebook_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"type" "artifact_type" NOT NULL,
	"title" text NOT NULL,
	"status" "artifact_status" DEFAULT 'pending' NOT NULL,
	"content" jsonb,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_notebook_id_notebooks_id_fk" FOREIGN KEY ("notebook_id") REFERENCES "public"."notebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_notebook_id_idx" ON "artifacts" USING btree ("notebook_id");--> statement-breakpoint
CREATE INDEX "artifacts_notebook_created_at_idx" ON "artifacts" USING btree ("notebook_id","created_at");--> statement-breakpoint
CREATE INDEX "artifacts_owner_id_idx" ON "artifacts" USING btree ("owner_id");