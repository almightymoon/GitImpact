CREATE TABLE IF NOT EXISTS "analysis_history" (
  "id" text PRIMARY KEY,
  "repository_id" text NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE,
  "analysis_id" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'repository',
  "commit_sha" text,
  "base_sha" text,
  "head_sha" text,
  "pr_number" integer,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "analysis_history_repository_id_idx" ON "analysis_history" ("repository_id");
CREATE INDEX IF NOT EXISTS "analysis_history_created_at_idx" ON "analysis_history" ("created_at");
CREATE INDEX IF NOT EXISTS "analysis_history_commit_sha_idx" ON "analysis_history" ("commit_sha");
CREATE INDEX IF NOT EXISTS "analysis_history_pr_number_idx" ON "analysis_history" ("pr_number");
