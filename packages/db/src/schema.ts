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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analyses_repository_id_idx").on(table.repositoryId),
    index("analyses_kind_pr_idx").on(table.kind, table.prNumber),
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

export const schema = {
  repositories,
  analyses,
  githubInstallations,
  webhookDeliveries,
};
