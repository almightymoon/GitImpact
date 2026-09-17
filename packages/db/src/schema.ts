import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analyses_repository_id_idx").on(table.repositoryId),
    index("analyses_kind_pr_idx").on(table.kind, table.prNumber),
  ],
);

export const schema = { repositories, analyses };
