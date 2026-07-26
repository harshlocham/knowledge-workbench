ALTER TABLE "chunks"
ADD COLUMN IF NOT EXISTS "search_vector" tsvector
GENERATED ALWAYS AS (to_tsvector('english', coalesce("content", ''))) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_search_vector_idx"
ON "chunks"
USING gin ("search_vector");
