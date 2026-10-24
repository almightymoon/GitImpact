import type { DatabaseSchemaFileKind } from "@gitimpact/shared";

const MIGRATION_RE =
  /(^|\/)(migrations?|db\/migrate|supabase\/migrations|drizzle|flyway|liquibase|alembic\/versions)(\/|$)/i;
const SEED_RE =
  /(^|\/)(seeds?|fixtures\/db|supabase\/seed)(\/|$)|(^|\/)seed[._-].*\.(sql|ts|js|py)$/i;
const PRISMA_RE = /(^|\/)schema\.prisma$/i;
const SQL_FILE_RE = /\.sql$/i;

function schemaSqlMatch(p: string): boolean {
  return (
    /(^|\/)(schema|structure|database)\.sql$/i.test(p) ||
    /(^|\/)sql\/.*\.sql$/i.test(p) ||
    /(^|\/)supabase\/.*\.sql$/i.test(p)
  );
}

export function classifyDatabaseSchemaPath(
  filePath: string,
): DatabaseSchemaFileKind | null {
  const p = filePath.replace(/\\/g, "/");
  if (PRISMA_RE.test(p)) return "prisma";
  if (MIGRATION_RE.test(p) && (SQL_FILE_RE.test(p) || /\.(ts|js)$/i.test(p))) {
    return "migration";
  }
  if (SEED_RE.test(p)) return "seed";
  if (
    schemaSqlMatch(p) ||
    (SQL_FILE_RE.test(p) && /schema|migration|seed/i.test(p))
  ) {
    return "schema";
  }
  if (
    /schema\.ts$/i.test(p) &&
    /drizzle|db|database|schema/i.test(p)
  ) {
    return "schema";
  }
  if (SQL_FILE_RE.test(p) && MIGRATION_RE.test(p)) return "migration";
  return null;
}

export function isDatabaseSchemaPath(filePath: string): boolean {
  return classifyDatabaseSchemaPath(filePath) != null;
}

export function detectDatabaseSchemaPaths(
  filePaths: string[],
): Array<{ path: string; kind: DatabaseSchemaFileKind }> {
  const out: Array<{ path: string; kind: DatabaseSchemaFileKind }> = [];
  const seen = new Set<string>();
  for (const raw of filePaths) {
    const p = raw.replace(/\\/g, "/");
    if (seen.has(p)) continue;
    const kind = classifyDatabaseSchemaPath(p);
    if (!kind) continue;
    seen.add(p);
    out.push({ path: p, kind });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
