-- v1.0 durable analysis jobs
CREATE TABLE IF NOT EXISTS "analysis_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "status" text DEFAULT 'QUEUED' NOT NULL,
  "payload" jsonb NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "last_error" text,
  "phase" text,
  "dedupe_key" text,
  "owner" text,
  "repo" text,
  "pull_request_number" integer,
  "commit_sha" text,
  "request_id" text,
  "schema_version" text DEFAULT '1.0' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "analysis_jobs_status_idx" ON "analysis_jobs" ("status");
CREATE INDEX IF NOT EXISTS "analysis_jobs_type_idx" ON "analysis_jobs" ("type");
CREATE INDEX IF NOT EXISTS "analysis_jobs_dedupe_idx" ON "analysis_jobs" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "analysis_jobs_owner_repo_idx" ON "analysis_jobs" ("owner", "repo");
CREATE INDEX IF NOT EXISTS "analysis_jobs_created_at_idx" ON "analysis_jobs" ("created_at");

-- Cache versioning columns on analyses
ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "commit_sha" text;
ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "base_sha" text;
ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "head_sha" text;
ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "schema_version" text DEFAULT '1.0';
ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "analyses_commit_sha_idx" ON "analyses" ("commit_sha");
CREATE INDEX IF NOT EXISTS "analyses_expires_at_idx" ON "analyses" ("expires_at");
