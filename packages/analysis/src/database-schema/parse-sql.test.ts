import { describe, expect, it } from "vitest";
import { parseSqlSchema } from "./parse-sql.js";

describe("parseSqlSchema", () => {
  it("extracts tables, columns, and inline references", () => {
    const sql = `
      CREATE TABLE profiles (
        id uuid PRIMARY KEY,
        email text NOT NULL UNIQUE,
        created_at timestamptz
      );
      CREATE TABLE messages (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES profiles (id),
        content text
      );
    `;
    const { tables, foreignKeys } = parseSqlSchema(sql, "schema.sql");
    expect(tables.map((t) => t.name).sort()).toEqual(["messages", "profiles"]);
    expect(tables.find((t) => t.name === "profiles")?.columns.some((c) => c.primaryKey)).toBe(
      true,
    );
    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromTable: "messages",
          fromColumn: "user_id",
          toTable: "profiles",
          toColumn: "id",
        }),
      ]),
    );
  });

  it("parses ALTER TABLE foreign keys", () => {
    const sql = `
      CREATE TABLE jobs (id text PRIMARY KEY, title text);
      CREATE TABLE user_job_status (id uuid PRIMARY KEY, job_id text);
      ALTER TABLE user_job_status
        ADD CONSTRAINT user_job_status_job_id_fkey
        FOREIGN KEY (job_id) REFERENCES jobs (id);
    `;
    const { foreignKeys } = parseSqlSchema(sql, "mig.sql");
    expect(foreignKeys[0]).toMatchObject({
      fromTable: "user_job_status",
      fromColumn: "job_id",
      toTable: "jobs",
      toColumn: "id",
    });
  });
});
