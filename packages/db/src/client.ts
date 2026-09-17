import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema.js";

export type Database = ReturnType<typeof createDb>;

let client: ReturnType<typeof postgres> | null = null;
let db: Database | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is required for Postgres persistence");
  }
  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(sql, { schema });
}

export function getDb(): Database | null {
  if (!isDatabaseConfigured()) return null;
  if (!db) {
    client = postgres(process.env.DATABASE_URL!, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    db = drizzle(client, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
    db = null;
  }
}
