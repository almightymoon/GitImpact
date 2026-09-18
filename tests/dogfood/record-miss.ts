/**
 * Append a miss to misses.jsonl
 *
 *   pnpm dogfood:miss -- --repo express --kind missing_call --note "..."
 */
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const missesPath = path.join(__dirname, "misses.jsonl");
const matrixPath = path.join(__dirname, "matrix.json");

function argValue(flag: string): string | undefined {
  const args = process.argv.filter((a) => a !== "--");
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

async function main(): Promise<void> {
  const repoId = argValue("--repo");
  const kind = argValue("--kind") ?? "other";
  const severity = argValue("--severity") ?? "medium";
  const note = argValue("--note") ?? "";
  const from = argValue("--from");
  const to = argValue("--to");
  const expected = argValue("--expected");
  const actual = argValue("--actual");
  const status = argValue("--status") ?? "open";

  if (!repoId) {
    console.error(
      "Usage: pnpm dogfood:miss -- --repo <id> --kind missing_call --note \"...\" [--from ...] [--to ...] [--severity high]",
    );
    process.exit(1);
  }

  const matrix = JSON.parse(await readFile(matrixPath, "utf8")) as {
    repos: Array<{ id: string; url: string }>;
  };
  const repo = matrix.repos.find((r) => r.id === repoId);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const id = `miss_${stamp}_${repoId}_${Date.now().toString(36)}`;

  const entry = {
    id,
    recordedAt: new Date().toISOString(),
    repoId,
    repoUrl: repo?.url ?? null,
    kind,
    severity,
    from: from ?? null,
    to: to ?? null,
    expected: expected ?? null,
    actual: actual ?? null,
    note,
    status,
  };

  await appendFile(missesPath, `${JSON.stringify(entry)}\n`);
  console.log(`Appended ${id} → ${missesPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
