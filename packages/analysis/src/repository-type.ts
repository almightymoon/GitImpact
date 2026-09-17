import type {
  DetectedRoute,
  GraphNode,
  InfraSignal,
  ImportantModule,
  ParsedFile,
  RepositoryType,
} from "@gitimpact/shared";

export function detectInfraSignals(
  filePaths: string[],
  packageDeps: Record<string, string> = {},
): InfraSignal[] {
  const signals: InfraSignal[] = [];
  const seen = new Set<string>();

  const push = (kind: InfraSignal["kind"], label: string, path: string) => {
    const key = `${kind}:${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    signals.push({ kind, label, path });
  };

  for (const filePath of filePaths) {
    const p = filePath.replace(/\\/g, "/");
    if (/(^|\/)Dockerfile(\.|$)/i.test(p) || /docker-compose/i.test(p)) {
      push("docker", "Docker", p);
    }
    if (/\.tf$/i.test(p) || /(^|\/)terraform\//i.test(p)) {
      push("terraform", "Terraform", p);
    }
    if (
      /(^|\/)(?:k8s|kubernetes|manifests)\//i.test(p) ||
      /\.(ya?ml)$/i.test(p) && /kind:\s*Deployment|apiVersion:\s*apps\//i.test(p)
    ) {
      if (/\.(ya?ml)$/i.test(p)) push("kubernetes", "Kubernetes manifest", p);
    }
    if (/(^|\/)charts?\//i.test(p) || /Chart\.ya?ml$/i.test(p)) {
      push("helm", "Helm chart", p);
    }
    if (/argocd|application\.ya?ml$/i.test(p) || /(^|\/)argocd\//i.test(p)) {
      push("argocd", "Argo CD", p);
    }
    if (/(^|\/)\.github\/workflows\//i.test(p)) {
      push("github_actions", "GitHub Actions", p);
    }
  }

  if (packageDeps["@pulumi/pulumi"] || packageDeps.cdktf) {
    push("terraform", "Infrastructure as code (package)", "package.json");
  }

  return signals.slice(0, 40);
}

export function detectImportantModules(
  files: ParsedFile[],
  graphNodes: GraphNode[],
): ImportantModule[] {
  const counts = new Map<string, number>();
  const paths =
    files.length > 0
      ? files.map((f) => f.path)
      : graphNodes.filter((n) => n.type === "FILE").map((n) => n.file);

  for (const filePath of paths) {
    const parts = filePath.replace(/\\/g, "/").split("/");
    let key: string;
    if (parts[0] === "packages" || parts[0] === "apps" || parts[0] === "services") {
      key = parts.slice(0, 2).join("/");
    } else if (parts[0] === "src" && parts.length > 1) {
      key = parts.slice(0, 2).join("/");
    } else {
      key = parts[0] ?? filePath;
    }
    if (!key || key.startsWith(".")) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const roleFor = (path: string): string | undefined => {
    if (/^apps\//.test(path) || /frontend|web|ui|client/i.test(path)) return "Application";
    if (/^packages\//.test(path) || /lib|shared|core/i.test(path)) return "Library / package";
    if (/api|server|backend|service/i.test(path)) return "Service";
    if (/test/i.test(path)) return "Tests";
    if (/infra|deploy|ops|k8s|terraform/i.test(path)) return "Infrastructure";
    return undefined;
  };

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([path, fileCount]) => ({
      path,
      label: path,
      fileCount,
      role: roleFor(path),
    }));
}

export function detectRepositoryType(input: {
  frameworks: string[];
  routes: DetectedRoute[];
  files: ParsedFile[];
  packageDeps?: Record<string, string>;
  filePaths?: string[];
  infraSignals?: InfraSignal[];
}): { type: RepositoryType; label: string } {
  const frameworks = input.frameworks.map((f) => f.toLowerCase());
  const deps = input.packageDeps ?? {};
  const paths = (
    input.filePaths ??
    input.files.map((f) => f.path)
  ).map((p) => p.replace(/\\/g, "/"));
  const infra = input.infraSignals ?? detectInfraSignals(paths, deps);
  const hasWorkspace =
    Boolean(deps) &&
    (paths.some((p) => p === "pnpm-workspace.yaml" || p === "lerna.json") ||
      paths.some((p) => p.startsWith("packages/") || p.startsWith("apps/")));
  const hasApiRoutes = input.routes.length > 0;
  const hasFrontend = frameworks.some((f) =>
    /next|react|vue|svelte|angular|remix/.test(f),
  );
  const hasBackend = frameworks.some((f) =>
    /express|nestjs|fastify|koa|hono/.test(f),
  );
  const hasNext = frameworks.some((f) => f.includes("next"));
  const codeFileCount = input.files.length;
  const infraHeavy =
    infra.length >= 3 &&
    codeFileCount < 15 &&
    infra.some((s) =>
      ["terraform", "kubernetes", "helm", "argocd"].includes(s.kind),
    );
  const gitops =
    infra.some((s) => s.kind === "argocd") ||
    paths.some((p) => /argocd|gitops/i.test(p));
  const devops =
    infra.some((s) => s.kind === "github_actions" || s.kind === "docker") &&
    codeFileCount < 20 &&
    !hasApiRoutes;

  if (gitops) {
    return { type: "GITOPS", label: "GitOps / Infrastructure" };
  }
  if (infraHeavy) {
    return { type: "INFRASTRUCTURE", label: "Infrastructure" };
  }
  if (devops && !hasFrontend && !hasBackend) {
    return { type: "DEVOPS", label: "DevOps / CI configuration" };
  }
  if (hasWorkspace || paths.filter((p) => p.startsWith("packages/")).length >= 2) {
    return { type: "MONOREPO", label: "Monorepo" };
  }
  if (hasNext && hasApiRoutes) {
    return { type: "FULLSTACK", label: "Next.js Full-Stack Application" };
  }
  if (hasFrontend && hasBackend) {
    return { type: "FULLSTACK", label: "Full-Stack Application" };
  }
  if (hasFrontend && !hasApiRoutes) {
    return { type: "FRONTEND", label: `${input.frameworks[0] ?? "Frontend"} Application` };
  }
  if (hasBackend || (hasApiRoutes && !hasFrontend)) {
    return {
      type: "API_SERVICE",
      label: hasBackend
        ? `${input.frameworks.find((f) => /express|nest|fastify|koa|hono/i.test(f)) ?? "API"} Service`
        : "API Service",
    };
  }
  if (deps.react || deps.vue || deps.svelte) {
    return { type: "LIBRARY", label: "Frontend Library" };
  }
  if (codeFileCount > 0 && !hasApiRoutes && paths.some((p) => /(^|\/)src\//.test(p))) {
    const looksLib = paths.some(
      (p) =>
        p === "src/index.ts" ||
        p === "src/index.js" ||
        p === "src/index.tsx" ||
        p.endsWith("/src/index.ts"),
    );
    if (looksLib && !hasFrontend && !hasBackend) {
      return { type: "LIBRARY", label: "Library" };
    }
    return { type: "APPLICATION", label: "Application" };
  }
  if (codeFileCount === 0 && infra.length > 0) {
    return { type: "INFRASTRUCTURE", label: "Infrastructure" };
  }
  if (codeFileCount > 0) {
    return { type: "APPLICATION", label: "Application" };
  }
  return { type: "UNKNOWN", label: "Unknown" };
}

export function buildArchitectureSummary(input: {
  typeLabel: string;
  frameworks: string[];
  modules: ImportantModule[];
  routeCount: number;
  testCount: number;
  languages: Array<{ language: string; percentage: number }>;
}): string {
  const parts: string[] = [];
  parts.push(`Classified as a ${input.typeLabel}.`);
  if (input.frameworks.length) {
    parts.push(`Detected stack: ${input.frameworks.join(", ")}.`);
  }
  if (input.languages.length) {
    const top = input.languages
      .slice(0, 3)
      .map((l) => `${l.language} (${Math.round(l.percentage)}%)`)
      .join(", ");
    parts.push(`Primary languages: ${top}.`);
  }
  if (input.modules.length) {
    parts.push(
      `Key areas: ${input.modules
        .slice(0, 5)
        .map((m) => m.label)
        .join(", ")}.`,
    );
  }
  if (input.routeCount > 0) {
    parts.push(`${input.routeCount} HTTP API endpoint${input.routeCount === 1 ? "" : "s"} detected.`);
  }
  if (input.testCount > 0) {
    parts.push(`${input.testCount} test file${input.testCount === 1 ? "" : "s"} mapped.`);
  }
  return parts.join(" ");
}
