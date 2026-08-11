ALTER TABLE "artifacts" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_share_token_uidx" ON "artifacts" USING btree ("share_token");
