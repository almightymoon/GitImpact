-- Job completion metadata for polling clients (no graphs/tokens)
ALTER TABLE "analysis_jobs" ADD COLUMN IF NOT EXISTS "result" jsonb;
