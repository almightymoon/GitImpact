/**
 * Detect how a Python project is packaged / laid out (no code execution).
 */
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { PythonPackageManager, PythonProjectInfo } from "@gitimpact/shared";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function detectPythonProject(
  rootDir: string,
  relativeFiles: string[] = [],
): Promise<PythonProjectInfo | null> {
  const hasPy = relativeFiles.some((f) => f.replace(/\\/g, "/").endsWith(".py"));
  const managers = new Set<PythonPackageManager>();
  const manifests: string[] = [];

  const candidates: Array<{ file: string; mark: (text: string) => void }> = [
    {
      file: "pyproject.toml",
      mark: (text) => {
        manifests.push("pyproject.toml");
        if (/\[tool\.poetry\]/i.test(text)) managers.add("poetry");
        if (/\[tool\.uv\]/i.test(text) || /\[tool\.uv\./i.test(text)) managers.add("uv");
        if (/\[project\]/i.test(text) && !managers.has("poetry")) managers.add("pip");
        if (/\[build-system\]/i.test(text) && /setuptools/i.test(text)) {
          managers.add("setuptools");
        }
      },
    },
    {
      file: "requirements.txt",
      mark: () => {
        manifests.push("requirements.txt");
        managers.add("pip");
      },
    },
    {
      file: "requirements-dev.txt",
      mark: () => {
        manifests.push("requirements-dev.txt");
        managers.add("pip");
      },
    },
    {
      file: "Pipfile",
      mark: () => {
        manifests.push("Pipfile");
        managers.add("pipenv");
      },
    },
    {
      file: "uv.lock",
      mark: () => {
        manifests.push("uv.lock");
        managers.add("uv");
      },
    },
    {
      file: "poetry.lock",
      mark: () => {
        manifests.push("poetry.lock");
        managers.add("poetry");
      },
    },
    {
      file: "setup.py",
      mark: () => {
        manifests.push("setup.py");
        managers.add("setuptools");
      },
    },
    {
      file: "setup.cfg",
      mark: () => {
        manifests.push("setup.cfg");
        managers.add("setuptools");
      },
    },
  ];

  for (const candidate of candidates) {
    const abs = path.join(rootDir, candidate.file);
    if (!(await exists(abs))) continue;
    try {
      const text = await readFile(abs, "utf8");
      candidate.mark(text);
    } catch {
      manifests.push(candidate.file);
    }
  }

  if (!hasPy && manifests.length === 0) return null;

  const normalized = relativeFiles.map((f) => f.replace(/\\/g, "/"));
  const srcLayout = normalized.some((f) => /^src\/[^/]+\/.*\.py$/.test(f));
  const packagesLayout = normalized.some((f) => /^packages\/[^/]+\/.*\.py$/.test(f));
  let layout: PythonProjectInfo["layout"] = "unknown";
  if (srcLayout) layout = "src";
  else if (packagesLayout) layout = "packages";
  else if (hasPy) layout = "flat";

  return {
    packageManagers: [...managers],
    layout,
    manifests: [...new Set(manifests)],
    srcLayout,
  };
}
