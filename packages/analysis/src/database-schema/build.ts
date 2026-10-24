import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  DatabaseForeignKey,
  DatabaseSchemaModel,
  DatabaseSchemaSourceFile,
  DatabaseTable,
} from "@gitimpact/shared";
import { listPathsChangedSince } from "@gitimpact/git";
import { detectDatabaseSchemaPaths, isDatabaseSchemaPath } from "./detect.js";
import { parseSqlSchema } from "./parse-sql.js";
import { parsePrismaSchema } from "./parse-prisma.js";

const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_SCHEMA_FILES = 80;
const MAX_FILE_BYTES = 512_000;

function mergeTables(
  into: Map<string, DatabaseTable>,
  tables: DatabaseTable[],
): void {
  for (const table of tables) {
    const key = table.name.toLowerCase();
    const existing = into.get(key);
    if (!existing) {
      into.set(key, {
        ...table,
        name: table.name,
        columns: [...table.columns],
        sourceFiles: [...table.sourceFiles],
      });
      continue;
    }
    const names = new Set(existing.columns.map((c) => c.name));
    for (const col of table.columns) {
      if (!names.has(col.name)) {
        existing.columns.push(col);
        names.add(col.name);
      } else {
        const prev = existing.columns.find((c) => c.name === col.name);
        if (prev && col.primaryKey) prev.primaryKey = true;
        if (prev && col.references && !prev.references) {
          prev.references = col.references;
        }
      }
    }
    for (const src of table.sourceFiles) {
      if (!existing.sourceFiles.includes(src)) existing.sourceFiles.push(src);
    }
  }
}

function dedupeForeignKeys(fks: DatabaseForeignKey[]): DatabaseForeignKey[] {
  const seen = new Set<string>();
  const out: DatabaseForeignKey[] = [];
  for (const fk of fks) {
    const key = `${fk.fromTable}.${fk.fromColumn}->${fk.toTable}.${fk.toColumn}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fk);
  }
  return out;
}

export async function buildDatabaseSchemaModel(input: {
  clonePath?: string;
  allRelativeFiles: string[];
  lookbackDays?: number;
}): Promise<DatabaseSchemaModel | undefined> {
  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const recentPaths = new Set<string>();
  if (input.clonePath) {
    const changed = await listPathsChangedSince(input.clonePath, lookbackDays);
    for (const p of changed) {
      if (isDatabaseSchemaPath(p)) recentPaths.add(p.replace(/\\/g, "/"));
    }
  }

  const inventory = detectDatabaseSchemaPaths([
    ...input.allRelativeFiles,
    ...recentPaths,
  ]);

  // Prefer recent files first, then migrations/schemas over seeds
  const ranked = [...inventory].sort((a, b) => {
    const ar = recentPaths.has(a.path) ? 0 : 1;
    const br = recentPaths.has(b.path) ? 0 : 1;
    if (ar !== br) return ar - br;
    const order = { migration: 0, schema: 1, prisma: 1, seed: 2, other: 3 } as const;
    return (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.path.localeCompare(b.path);
  });

  const selected = ranked.slice(0, MAX_SCHEMA_FILES);
  if (selected.length === 0) return undefined;

  const sourceFiles: DatabaseSchemaSourceFile[] = selected.map((f) => ({
    path: f.path,
    kind: f.kind,
    recent: recentPaths.has(f.path),
  }));

  if (!input.clonePath) {
    return {
      tables: [],
      foreignKeys: [],
      sourceFiles,
      lookbackDays,
      summary: {
        tableCount: 0,
        columnCount: 0,
        foreignKeyCount: 0,
        recentFileCount: sourceFiles.filter((s) => s.recent).length,
      },
    };
  }

  const tables = new Map<string, DatabaseTable>();
  const foreignKeys: DatabaseForeignKey[] = [];

  for (const file of selected) {
    const absolute = path.join(input.clonePath, file.path);
    let content: string;
    try {
      content = await readFile(absolute, "utf8");
    } catch {
      continue;
    }
    if (content.length > MAX_FILE_BYTES) {
      content = content.slice(0, MAX_FILE_BYTES);
    }

    if (file.kind === "prisma" || file.path.endsWith(".prisma")) {
      const parsed = parsePrismaSchema(content, file.path);
      mergeTables(tables, parsed.tables);
      foreignKeys.push(...parsed.foreignKeys);
      continue;
    }

    if (/\.sql$/i.test(file.path) || file.kind === "migration" || file.kind === "schema" || file.kind === "seed") {
      if (!/\.sql$/i.test(file.path)) continue; // skip non-SQL drizzle TS for v1
      const parsed = parseSqlSchema(content, file.path);
      mergeTables(tables, parsed.tables);
      foreignKeys.push(...parsed.foreignKeys);
    }
  }

  const tableList = [...tables.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const fks = dedupeForeignKeys(foreignKeys);
  if (tableList.length === 0 && sourceFiles.length === 0) return undefined;

  return {
    tables: tableList,
    foreignKeys: fks,
    sourceFiles,
    lookbackDays,
    summary: {
      tableCount: tableList.length,
      columnCount: tableList.reduce((n, t) => n + t.columns.length, 0),
      foreignKeyCount: fks.length,
      recentFileCount: sourceFiles.filter((s) => s.recent).length,
    },
  };
}
