import type { ReadmeDigest } from "@gitimpact/shared";

function stripMarkdownNoise(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, "• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\r\n/g, "\n")
    .trim();
}

function sectionBody(raw: string, headingPattern: RegExp, options?: { keepCode?: boolean }): string | undefined {
  const match = raw.match(headingPattern);
  if (!match || match.index === undefined) return undefined;
  const start = match.index + match[0].length;
  const rest = raw.slice(start);
  const next = rest.search(/\n#{1,3}\s+/);
  const body = (next >= 0 ? rest.slice(0, next) : rest).trim();
  const cleaned = options?.keepCode
    ? body
        .replace(/`([^`]+)`/g, "$1")
        .replace(/!\[[^\]]*]\([^)]+\)/g, "")
        .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "• ")
        .trim()
    : stripMarkdownNoise(body);
  if (!cleaned || cleaned.length < 8) return undefined;
  return cleaned.slice(0, 900);
}

function firstParagraph(raw: string): string | undefined {
  const withoutTitle = raw.replace(/^#[^\n]*\n+/, "");
  const blocks = withoutTitle.split(/\n{2,}/).map((b) => b.trim());
  for (const block of blocks) {
    if (!block || block.startsWith("#") || block.startsWith("```")) continue;
    if (/^[-*|]/.test(block) && block.length < 40) continue;
    const cleaned = stripMarkdownNoise(block);
    if (cleaned.length >= 24) return cleaned.slice(0, 420);
  }
  return undefined;
}

function extractFeatures(raw: string): string[] {
  const featuresSection = sectionBody(
    raw,
    /\n##?\s+(?:features|what (?:it|this) does|capabilities)\b[^\n]*\n/i,
  );
  if (!featuresSection) return [];
  return featuresSection
    .split("\n")
    .map((line) => line.replace(/^•\s*/, "").trim())
    .filter((line) => line.length > 2 && line.length < 160)
    .slice(0, 8);
}

function extractTechnologies(raw: string, frameworks: string[]): string[] {
  const found = new Set<string>(frameworks);
  const techSection = sectionBody(
    raw,
    /\n##?\s+(?:tech(?:nolog(?:y|ies))?|stack|built with|dependencies)\b[^\n]*\n/i,
  );
  const haystack = `${techSection ?? ""}\n${raw.slice(0, 2000)}`;
  const known = [
    "TypeScript",
    "JavaScript",
    "React",
    "Next.js",
    "Node.js",
    "Express",
    "NestJS",
    "PostgreSQL",
    "Prisma",
    "Docker",
    "Kubernetes",
    "Terraform",
    "GraphQL",
    "Redis",
    "pnpm",
    "Turborepo",
  ];
  for (const name of known) {
    if (new RegExp(`\\b${name.replace(".", "\\.")}\\b`, "i").test(haystack)) {
      found.add(name);
    }
  }
  return [...found].slice(0, 12);
}

/**
 * Deterministic README digest — never dumps raw markdown into the UI.
 */
export function extractReadmeDigest(
  raw: string | undefined,
  frameworks: string[] = [],
): ReadmeDigest | undefined {
  if (!raw?.trim()) return undefined;
  const text = raw.replace(/\r\n/g, "\n");
  const titleMatch = text.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim();
  const description = firstParagraph(text);
  const installation = sectionBody(
    text,
    /\n##?\s+(?:install(?:ation)?|getting started|setup|quick ?start)\b[^\n]*\n/i,
    { keepCode: true },
  );
  const architecture = sectionBody(
    text,
    /\n##?\s+(?:architecture|design|how it works|overview|structure)\b[^\n]*\n/i,
  );

  return {
    title,
    description,
    installation: installation?.slice(0, 600),
    architecture: architecture?.slice(0, 600),
    technologies: extractTechnologies(text, frameworks),
    features: extractFeatures(text),
    rawAvailable: true,
    rawExcerpt: text.slice(0, 12_000),
  };
}
