import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDiffFilesBetween, resolveLocalRefSha } from "./index.js";

const exec = promisify(execFile);

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "gi-diff-"));
  await exec("git", ["init"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await writeFile(path.join(dir, "a.ts"), "export function a() { return 1 }\n");
  await exec("git", ["add", "."], { cwd: dir });
  await exec("git", ["commit", "-m", "init"], { cwd: dir });
  await writeFile(path.join(dir, "a.ts"), "export function a() { return 2 }\n");
  await writeFile(path.join(dir, "b.ts"), "export function b() { return a() }\n");
  await exec("git", ["add", "."], { cwd: dir });
  await exec("git", ["commit", "-m", "change"], { cwd: dir });
  return dir;
}

describe("getDiffFilesBetween", () => {
  it("returns changed files with status and patch between refs", async () => {
    const dir = await initRepo();
    const files = await getDiffFilesBetween(dir, "HEAD~1", "HEAD");
    expect(files.some((f) => f.filename === "a.ts" && f.status === "modified")).toBe(true);
    expect(files.some((f) => f.filename === "b.ts" && f.status === "added")).toBe(true);
    const a = files.find((f) => f.filename === "a.ts");
    expect(a?.patch).toMatch(/return 2/);
    const sha = await resolveLocalRefSha(dir, "HEAD");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
