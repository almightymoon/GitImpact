-- v0.7 GitHub App installations + webhook delivery idempotency

CREATE TABLE IF NOT EXISTS github_installations (
  installation_id bigint PRIMARY KEY,
  account_login text NOT NULL,
  account_type text NOT NULL DEFAULT 'Organization',
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS github_installations_account_login_idx
  ON github_installations (account_login);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id text PRIMARY KEY,
  event text NOT NULL,
  action text,
  owner text,
  repo text,
  pr_number integer,
  installation_id bigint,
  status text NOT NULL DEFAULT 'received',
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx ON webhook_deliveries (status);
CREATE INDEX IF NOT EXISTS webhook_deliveries_repo_pr_idx
  ON webhook_deliveries (owner, repo, pr_number);

-- analyses.routes may already exist from later code; ensure column for older DBs
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS routes jsonb;
