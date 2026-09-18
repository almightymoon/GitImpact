/**
 * Summarize misses.jsonl
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const missesPath = path.join(__dirname, "misses.jsonl");

async function main(): Promise<void> {
  const raw = await readFile(missesPath, "utf8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

  const open = lines.filter((m) => m.status === "open");
  const byKind = new Map<string, number>();
  const byRepo = new Map<string, number>();
  for (const m of open) {
    const kind = String(m.kind ?? "other");
    const repo = String(m.repoId ?? "?");
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    byRepo.set(repo, (byRepo.get(repo) ?? 0) + 1);
  }

  console.log(
    JSON.stringify(
      {
        total: lines.length,
        open: open.length,
        byKind: Object.fromEntries(byKind),
        byRepo: Object.fromEntries(byRepo),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
