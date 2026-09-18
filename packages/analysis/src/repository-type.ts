import type {
  DetectedRoute,
  GraphNode,
  InfraSignal,
  ImportantModule,
  ParsedFile,
  RepositoryType,
} from "@gitimpact/shared";

function isYamlPath(p: string): boolean {
  return /\.ya?ml$/i.test(p);
}

function looksLikeKubernetesManifest(p: string): boolean {
  if (!isYamlPath(p)) return false;
  if (/(^|\/)(?:k8s|kubernetes|manifests)\//i.test(p)) return true;
  if (/(?:^|\/)kustomization\.ya?ml$/i.test(p)) return true;
  if (/(?:^|\/)manifests?\.ya?ml$/i.test(p)) return true;
  // Filename heuristics (no content peek): deployment.yaml, guestbook-ui-svc.yaml, carts-dep.yaml
  if (
    /(?:^|\/|-)(?:deployment|service|ingress|configmap|secret|statefulset|daemonset|rollout|job)s?(?:[.-]|$)/i.test(
      p,
    )
  ) {
    return true;
  }
  if (/-(?:dep|svc)\.ya?ml$/i.test(p)) return true;
  return false;
}

function looksLikeArgoCdOrGitOps(p: string): boolean {
  if (/argocd|gitops/i.test(p)) return true;
  if (/(^|\/)applicationset\//i.test(p)) return true;
  if (/(?:^|\/)applications?\.ya?ml$/i.test(p)) return true;
  if (/appset[^/]*\.ya?ml$/i.test(p)) return true;
  if (/(^|\/)(?:sync-waves|pre-post-sync|blue-green)\//i.test(p)) return true;
  return false;
}

export function detectInfraSignals(
  filePaths: string[],
  packageDeps: Record<string, string> = {},
): InfraSignal[] {
  const signals: InfraSignal[] = [];
  const seen = new Set<string>();
  const kindCounts = new Map<InfraSignal["kind"], number>();
  const PER_KIND = 8;

  const push = (kind: InfraSignal["kind"], label: string, path: string) => {
    const key = `${kind}:${path}`;
    if (seen.has(key)) return;
    const count = kindCounts.get(kind) ?? 0;
    if (count >= PER_KIND) return;
    seen.add(key);
    kindCounts.set(kind, count + 1);
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
    if (looksLikeKubernetesManifest(p)) {
      push("kubernetes", "Kubernetes manifest", p);
    }
    if (/(^|\/)charts?\//i.test(p) || /Chart\.ya?ml$/i.test(p)) {
      push("helm", "Helm chart", p);
    }
    if (looksLikeArgoCdOrGitOps(p)) {
      push("argocd", "Argo CD / GitOps", p);
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
  filePaths?: string[],
): ImportantModule[] {
  const counts = new Map<string, number>();
  const paths =
    files.length > 0
      ? files.map((f) => f.path)
      : filePaths && filePaths.length > 0
        ? filePaths.map((p) => p.replace(/\\/g, "/"))
        : graphNodes
            .filter((n) => n.type === "FILE" || n.type === "INFRASTRUCTURE")
            .map((n) => n.file);

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
    if (
      /infra|deploy|ops|k8s|terraform|helm|guestbook|kustomize|applicationset|sock-shop|manifest/i.test(
        path,
      )
    ) {
      return "Infrastructure";
    }
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
  packageName?: string;
  filePaths?: string[];
  infraSignals?: InfraSignal[];
}): { type: RepositoryType; label: string } {
  const frameworks = input.frameworks.map((f) => f.toLowerCase());
  const deps = input.packageDeps ?? {};
  const packageName = input.packageName?.replace(/^@[^/]+\//, "");
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
  const yamlCount = paths.filter((p) => isYamlPath(p)).length;
  const hasDeployPackaging = paths.some(
    (p) =>
      /Chart\.ya?ml$/i.test(p) ||
      /kustomization\.ya?ml$/i.test(p) ||
      /(^|\/)applicationset\//i.test(p),
  );
  const infraHeavy =
    infra.length >= 3 &&
    codeFileCount < 15 &&
    infra.some((s) =>
      ["terraform", "kubernetes", "helm", "argocd"].includes(s.kind),
    );
  const gitops =
    infra.some((s) => s.kind === "argocd") ||
    paths.some((p) => /argocd|gitops|applicationset/i.test(p)) ||
    (codeFileCount === 0 &&
      yamlCount >= 5 &&
      hasDeployPackaging &&
      infra.some((s) => s.kind === "helm" || s.kind === "kubernetes"));
  const hasLibrarySource = paths.some(
    (p) =>
      /^(src|source|lib)\//i.test(p) ||
      /(^|\/)(src|source|lib)\//i.test(p),
  );
  // Almost every published package has GitHub Actions — that alone is not DevOps.
  const devops =
    infra.some((s) => s.kind === "docker") &&
    codeFileCount < 20 &&
    !hasApiRoutes &&
    !hasLibrarySource;

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
  if (
    codeFileCount > 0 &&
    !hasApiRoutes &&
    paths.some((p) => /(^|\/)(src|source|lib)\//i.test(p))
  ) {
    const escapeRegExp = (value: string) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const looksLib =
      paths.some(
        (p) =>
          /^(src|source|lib)\/index\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(p) ||
          /\/(src|source|lib)\/index\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(p),
      ) ||
      Boolean(
        packageName &&
          paths.some((p) =>
            new RegExp(
              `^(src|source|lib)/${escapeRegExp(packageName)}\\.(ts|tsx|js|jsx|mjs|cjs)$`,
              "i",
            ).test(p),
          ),
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
  infraSignals?: InfraSignal[];
  codeFileCount?: number;
  workspacePackages?: Array<{ root: string; name: string; kind: "app" | "package" }>;
}): string {
  const parts: string[] = [];
  parts.push(`Classified as a ${input.typeLabel}.`);
  if (input.frameworks.length) {
    parts.push(`Detected stack: ${input.frameworks.join(", ")}.`);
  }
  if (input.workspacePackages && input.workspacePackages.length >= 2) {
    const apps = input.workspacePackages.filter((p) => p.kind === "app");
    const pkgs = input.workspacePackages.filter((p) => p.kind === "package");
    const lines: string[] = [];
    if (apps.length) {
      lines.push(`Apps: ${apps.map((a) => a.name).join(", ")}`);
    }
    if (pkgs.length) {
      lines.push(`Packages: ${pkgs.map((p) => p.name).join(", ")}`);
    }
    parts.push(`Workspace layout — ${lines.join("; ")}.`);
  }
  if (input.languages.length) {
    const top = input.languages
      .slice(0, 3)
      .map((l) => `${l.language} (${Math.round(l.percentage)}%)`)
      .join(", ");
    parts.push(`Primary languages: ${top}.`);
  }
  if (input.infraSignals && input.infraSignals.length > 0) {
    const kinds = [...new Set(input.infraSignals.map((s) => s.label))];
    parts.push(`Infrastructure focus: ${kinds.slice(0, 6).join(", ")}.`);
  }
  if (input.modules.length) {
    parts.push(
      `Key areas: ${input.modules
        .slice(0, 5)
        .map((m) => m.label)
        .join(", ")}.`,
    );
  }
  if ((input.codeFileCount ?? 1) === 0 && (input.infraSignals?.length ?? 0) > 0) {
    parts.push(
      "No application source was parsed; manifests and deploy configuration are the primary story.",
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

/** Language mix from inventory paths — used when JS/TS parse surface is empty. */
export function detectInventoryLanguages(
  filePaths: string[],
): Array<{ language: string; fileCount: number; percentage: number }> {
  const counts = new Map<string, number>();
  for (const filePath of filePaths) {
    const p = filePath.replace(/\\/g, "/");
    let language: string | null = null;
    if (/\.ya?ml$/i.test(p)) language = "YAML";
    else if (/\.tf$/i.test(p)) language = "HCL";
    else if (/\.(ts|tsx)$/i.test(p)) language = "TypeScript";
    else if (/\.(js|jsx|mjs|cjs)$/i.test(p)) language = "JavaScript";
    else if (/\.py$/i.test(p)) language = "Python";
    else if (/\.go$/i.test(p)) language = "Go";
    else if (/\.jsonnet$/i.test(p) || /\.libsonnet$/i.test(p)) language = "Jsonnet";
    else if (/\.md$/i.test(p)) language = "Markdown";
    if (!language) continue;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  return [...counts.entries()]
    .map(([language, fileCount]) => ({
      language,
      fileCount,
      percentage: Math.round((fileCount / total) * 100),
    }))
    .sort((a, b) => b.percentage - a.percentage);
}
