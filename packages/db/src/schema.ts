import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
  bigint,
} from "drizzle-orm/pg-core";

export const repositories = pgTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    languages: jsonb("languages").$type<unknown>().default([]),
    frameworks: jsonb("frameworks").$type<string[]>().default([]),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("repositories_owner_name_idx").on(table.owner, table.name),
  ],
);

export const analyses = pgTable(
  "analyses",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("repository"),
    prNumber: integer("pr_number"),
    routePath: text("route_path").notNull(),
    summary: jsonb("summary").$type<unknown>().notNull(),
    graph: jsonb("graph").$type<unknown>().notNull(),
    impact: jsonb("impact").$type<unknown>(),
    prOverview: jsonb("pr_overview").$type<unknown>(),
    changes: jsonb("changes").$type<unknown>(),
    pullRequest: jsonb("pull_request").$type<unknown>(),
    routes: jsonb("routes").$type<unknown>(),
    intelligence: jsonb("intelligence").$type<unknown>(),
    checks: jsonb("checks").$type<unknown>(),
    commitSha: text("commit_sha"),
    baseSha: text("base_sha"),
    headSha: text("head_sha"),
    schemaVersion: text("schema_version").default("1.0"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analyses_repository_id_idx").on(table.repositoryId),
    index("analyses_kind_pr_idx").on(table.kind, table.prNumber),
    index("analyses_commit_sha_idx").on(table.commitSha),
    index("analyses_expires_at_idx").on(table.expiresAt),
  ],
);

/** GitHub App installations (account → installation_id) */
export const githubInstallations = pgTable(
  "github_installations",
  {
    installationId: bigint("installation_id", { mode: "number" }).primaryKey(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull().default("Organization"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("github_installations_account_login_idx").on(table.accountLogin)],
);

/** Webhook delivery idempotency log */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    event: text("event").notNull(),
    action: text("action"),
    owner: text("owner"),
    repo: text("repo"),
    prNumber: integer("pr_number"),
    installationId: bigint("installation_id", { mode: "number" }),
    status: text("status").notNull().default("received"),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    index("webhook_deliveries_status_idx").on(table.status),
    index("webhook_deliveries_repo_pr_idx").on(table.owner, table.repo, table.prNumber),
  ],
);

/** Durable analysis / GitHub update jobs (v1.0) */
export const analysisJobs = pgTable(
  "analysis_jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    status: text("status").notNull().default("QUEUED"),
    payload: jsonb("payload").$type<unknown>().notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    phase: text("phase"),
    dedupeKey: text("dedupe_key"),
    owner: text("owner"),
    repo: text("repo"),
    pullRequestNumber: integer("pull_request_number"),
    commitSha: text("commit_sha"),
    requestId: text("request_id"),
    schemaVersion: text("schema_version").notNull().default("1.0"),
    result: jsonb("result").$type<{
      analysisId?: string;
      routePath?: string;
      fromCache?: boolean;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analysis_jobs_status_idx").on(table.status),
    index("analysis_jobs_type_idx").on(table.type),
    index("analysis_jobs_dedupe_idx").on(table.dedupeKey),
    index("analysis_jobs_owner_repo_idx").on(table.owner, table.repo),
    index("analysis_jobs_created_at_idx").on(table.createdAt),
  ],
);

/** v1.2 — append-only analysis history for compare / team workflows */
export const analysisHistory = pgTable(
  "analysis_history",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    analysisId: text("analysis_id").notNull(),
    kind: text("kind").notNull().default("repository"),
    commitSha: text("commit_sha"),
    baseSha: text("base_sha"),
    headSha: text("head_sha"),
    prNumber: integer("pr_number"),
    snapshot: jsonb("snapshot").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analysis_history_repository_id_idx").on(table.repositoryId),
    index("analysis_history_created_at_idx").on(table.createdAt),
    index("analysis_history_commit_sha_idx").on(table.commitSha),
    index("analysis_history_pr_number_idx").on(table.prNumber),
  ],
);

export const schema = {
  repositories,
  analyses,
  githubInstallations,
  webhookDeliveries,
  analysisJobs,
  analysisHistory,
};
