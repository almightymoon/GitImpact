-- GitImpact initial schema
CREATE TABLE IF NOT EXISTS repositories (
  id text PRIMARY KEY,
  owner text NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main',
  languages jsonb DEFAULT '[]'::jsonb,
  frameworks jsonb DEFAULT '[]'::jsonb,
  analyzed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS repositories_owner_name_idx
  ON repositories (owner, name);

CREATE TABLE IF NOT EXISTS analyses (
  id text PRIMARY KEY,
  repository_id text NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'repository',
  pr_number integer,
  route_path text NOT NULL,
  summary jsonb NOT NULL,
  graph jsonb NOT NULL,
  impact jsonb,
  pr_overview jsonb,
  changes jsonb,
  pull_request jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analyses_repository_id_idx ON analyses (repository_id);
CREATE INDEX IF NOT EXISTS analyses_kind_pr_idx ON analyses (kind, pr_number);
