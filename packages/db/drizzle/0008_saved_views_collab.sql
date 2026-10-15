-- v1.2 collab: org scoping + visibility + light roles on saved views
ALTER TABLE "saved_views" ADD COLUMN IF NOT EXISTS "org_login" text;
ALTER TABLE "saved_views" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'repo';
ALTER TABLE "saved_views" ADD COLUMN IF NOT EXISTS "created_by" text;
ALTER TABLE "saved_views" ADD COLUMN IF NOT EXISTS "role_required" text NOT NULL DEFAULT 'viewer';

CREATE INDEX IF NOT EXISTS "saved_views_org_login_idx" ON "saved_views" ("org_login");
CREATE INDEX IF NOT EXISTS "saved_views_visibility_idx" ON "saved_views" ("repository_id", "visibility");
