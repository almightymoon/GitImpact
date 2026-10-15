CREATE TABLE IF NOT EXISTS "saved_views" (
  "id" text PRIMARY KEY,
  "repository_id" text NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "pinned_system_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "hidden_bands" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "saved_views_repository_id_idx" ON "saved_views" ("repository_id");
