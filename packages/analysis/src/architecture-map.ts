import type {
  ArchitectureBandId,
  ArchitectureComponent,
  ArchitectureEdge,
  ArchitectureMap,
  GraphNode,
  InfraSignal,
} from "@gitimpact/shared";

export type { ArchitectureBandId, ArchitectureComponent, ArchitectureEdge, ArchitectureMap };

const ARCH_FILE_RE =
  /\.(ya?ml|yml|sql|html|css|scss|tf|toml)$|Dockerfile|docker-compose|vercel\.json|netlify\.toml|nginx|Caddyfile|helm|Chart\.|argocd|\.github\/workflows\//i;

export function collectArchitectureArtifacts(allRelativeFiles: string[]): string[] {
  return allRelativeFiles
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => ARCH_FILE_RE.test(p) && !/node_modules|package-lock|pnpm-lock|tsconfig/.test(p))
    .slice(0, 80);
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

function classifyArtifact(path: string): Omit<ArchitectureComponent, "id" | "files"> | null {
  const p = path.replace(/\\/g, "/");
  const name = baseName(p).toLowerCase();

  if (/docker-compose/i.test(name) || /compose\.(ya?ml)$/i.test(name)) {
    return {
      band: "deployment",
      title: "Compose configuration",
      role: "deployment configuration",
      pathHint: path,
      shape: "box",
    };
  }
  if (/^Dockerfile/i.test(name) || /\/Dockerfile/i.test(p)) {
    return {
      band: "deployment",
      title: "Container definition",
      role: "container configuration",
      pathHint: path,
      shape: "box",
    };
  }
  if (/vercel\.json/i.test(name) || /netlify\.toml/i.test(name)) {
    return {
      band: "deployment",
      title: "Hosting configuration",
      role: "static / edge hosting config",
      pathHint: path,
      shape: "box",
    };
  }
  if (/nginx|Caddyfile|traefik/i.test(name) || /proxy/i.test(p)) {
    return {
      band: "deployment",
      title: "Reverse proxy",
      role: "proxy configuration",
      pathHint: path,
      shape: "box",
    };
  }
  if (/\.github\/workflows\//i.test(p)) {
    return {
      band: "deployment",
      title: "CI workflow",
      role: "GitHub Actions pipeline",
      pathHint: path,
      shape: "box",
    };
  }
  if (/helm|Chart\.ya?ml/i.test(p)) {
    return {
      band: "deployment",
      title: "Helm chart",
      role: "Kubernetes packaging",
      pathHint: path,
      shape: "box",
    };
  }
  if (
    /k8s|kubernetes|deployment\.ya?ml|service\.ya?ml|kustomization\.ya?ml|-(?:dep|svc)\.ya?ml/i.test(
      p,
    )
  ) {
    return {
      band: "deployment",
      title: "Deployment configuration",
      role: "Kubernetes manifest",
      pathHint: path,
      shape: "box",
    };
  }
  if (/argocd|applicationset|applications?\.ya?ml/i.test(p)) {
    return {
      band: "deployment",
      title: "GitOps application",
      role: "Argo CD definition",
      pathHint: path,
      shape: "box",
    };
  }
  if (/\.tf$/i.test(p) || /terraform/i.test(p)) {
    return {
      band: "deployment",
      title: "Infrastructure as code",
      role: "Terraform configuration",
      pathHint: path,
      shape: "box",
    };
  }
  if (/schema\.sql|migrations?\//i.test(p) || (/\.sql$/i.test(p) && /supabase/i.test(p))) {
    return {
      band: "persistence",
      title: /supabase/i.test(p) ? "Supabase SQL assets" : "Server SQL schema",
      role: /supabase/i.test(p)
        ? "Supabase persistence definition"
        : "SQL persistence definition",
      pathHint: path,
      shape: "box",
    };
  }
  if (/\.sql$/i.test(p)) {
    return {
      band: "persistence",
      title: "SQL schema",
      role: "SQL persistence definition",
      pathHint: path,
      shape: "box",
    };
  }
  if (/index\.html$/i.test(name)) {
    return {
      band: "client",
      title: "HTML host",
      role: "client host",
      pathHint: path,
      shape: "box",
    };
  }
  if (/\.(css|scss)$/i.test(name)) {
    return {
      band: "client",
      title: "Presentation styles",
      role: "client styles",
      pathHint: path,
      shape: "box",
    };
  }

  return null;
}

function classifyCodeFile(file: string, nodeType?: string): Omit<ArchitectureComponent, "id" | "files"> | null {
  const p = file.replace(/\\/g, "/");
  const name = baseName(p).toLowerCase();
  const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";

  // Client entry points
  if (
    (/^(main|app|client)\.(js|ts|jsx|tsx)$/i.test(name) && /src|client|frontend|web|public/i.test(dir)) ||
    (/main\.(js|ts|jsx|tsx)$/i.test(name) && !/server/i.test(dir))
  ) {
    // Prefer browser if under client-ish path or has sibling html
    if (!/server|api|backend/i.test(dir) || /client|frontend|public|web/i.test(dir)) {
      return {
        band: "client",
        title: "Browser application",
        role: "client entry",
        pathHint: file,
        shape: "box",
      };
    }
  }

  if (/models?\.(js|ts)$/i.test(name) && !/server|api/i.test(dir)) {
    return {
      band: "client",
      title: "Client models",
      role: "client-side domain models",
      pathHint: file,
      shape: "box",
    };
  }

  if (/lib\/api\.(js|ts)$/i.test(p) || (/api\.(js|ts)$/i.test(name) && /src\/lib|client|frontend/i.test(dir))) {
    return {
      band: "client",
      title: "Client integration",
      role: "client API / fetch layer",
      pathHint: file,
      shape: "box",
    };
  }

  if (
    nodeType === "COMPONENT" ||
    /\.(jsx|tsx)$/i.test(name) ||
    /components?\//i.test(p) ||
    /pages?\//i.test(p) ||
    /app\/.*\/page\./i.test(p)
  ) {
    if (!/api|server|route\./i.test(p)) {
      return {
        band: "client",
        title: /integration|api\.|fetch/i.test(name) ? "Client integration" : "UI surface",
        role: "browser UI module",
        pathHint: file,
        shape: "box",
      };
    }
  }

  // Server entry
  if (
    (/^(index|server|app)\.(js|ts)$/i.test(name) && /server|api|backend/i.test(dir)) ||
    (/^(index|server)\.(js|ts)$/i.test(name) && !/client|frontend|public/i.test(dir))
  ) {
    return {
      band: "server",
      title: "Server runtime",
      role: "backend entry",
      pathHint: file,
      shape: "box",
    };
  }

  if (/auth\.(js|ts)$/i.test(name) || /middleware\/auth/i.test(p)) {
    return {
      band: "server",
      title: "Authentication",
      role: "auth / session handling",
      pathHint: file,
      shape: "box",
    };
  }

  if (/storage\.(js|ts)$/i.test(name)) {
    return {
      band: "server",
      title: "Storage adapter",
      role: "separates storage concern",
      pathHint: file,
      shape: "box",
    };
  }

  if (
    /db\.(js|ts)$/i.test(name) ||
    /database|prisma|drizzle/i.test(p) ||
    nodeType === "DATABASE_MODEL"
  ) {
    // Prefer server-side db clients as persistence; client lib/db stays with client integration
    if (/src\/lib\/db\./i.test(p) && !/server|api|backend/i.test(p)) {
      return {
        band: "client",
        title: "Client integration",
        role: "client data / API helpers",
        pathHint: file,
        shape: "box",
      };
    }
    return {
      band: "persistence",
      title: "Data access",
      role: "database client / models",
      pathHint: file,
      shape: "box",
    };
  }

  if (
    nodeType === "API_ROUTE" ||
    nodeType === "CONTROLLER" ||
    /routes?\//i.test(p) ||
    /app\/api\//i.test(p) ||
    /pages\/api\//i.test(p)
  ) {
    return {
      band: "server",
      title: "API handlers",
      role: "HTTP request handlers",
      pathHint: file,
      shape: "box",
    };
  }

  if (nodeType === "SERVICE" || /services?\//i.test(p)) {
    return {
      band: "server",
      title: "Domain services",
      role: "backend business logic",
      pathHint: file,
      shape: "box",
    };
  }

  if (/vite\.config|webpack\.config|next\.config/i.test(name)) {
    return {
      band: "deployment",
      title: "Build configuration",
      role: "bundler / framework config",
      pathHint: file,
      shape: "box",
    };
  }

  return null;
}

function mergeKey(c: Omit<ArchitectureComponent, "id" | "files"> & { pathHint?: string }): string {
  return `${c.band}:${c.title}`;
}

/**
 * Build a GitDiagram-style semantic architecture map from code + infra artifacts.
 */
export function buildArchitectureMap(input: {
  codeFiles: Array<{ path: string; type?: string }>;
  artifacts?: string[];
  infraSignals?: InfraSignal[];
  graphNodes?: GraphNode[];
}): ArchitectureMap {
  const bucket = new Map<string, ArchitectureComponent>();

  const upsert = (
    partial: Omit<ArchitectureComponent, "id" | "files"> & { files?: string[] },
  ) => {
    const key = mergeKey(partial);
    const existing = bucket.get(key);
    const files = [...(existing?.files ?? []), ...(partial.files ?? [])];
    const unique = [...new Set(files)];
    bucket.set(key, {
      id: key,
      band: partial.band,
      title: partial.title,
      role: partial.role,
      pathHint: partial.pathHint ?? existing?.pathHint,
      files: unique.slice(0, 8),
      shape: partial.shape,
    });
  };

  // Code files
  const codePaths = new Set<string>();
  for (const file of input.codeFiles) {
    codePaths.add(file.path.replace(/\\/g, "/"));
    const classified = classifyCodeFile(file.path, file.type);
    if (classified) {
      upsert({ ...classified, files: [file.path] });
    }
  }
  for (const node of input.graphNodes ?? []) {
    if (node.type === "FILE" || node.type === "INFRASTRUCTURE") {
      const p = node.file.replace(/\\/g, "/");
      if (codePaths.has(p)) continue;
      const classified =
        node.type === "INFRASTRUCTURE"
          ? classifyArtifact(p)
          : classifyCodeFile(p, node.type);
      if (classified) upsert({ ...classified, files: [p] });
    }
  }

  // Artifacts (html, sql, docker, etc.)
  for (const artifact of input.artifacts ?? []) {
    const classified = classifyArtifact(artifact);
    if (classified) upsert({ ...classified, files: [artifact] });
  }

  // Infra signals fallback
  for (const signal of input.infraSignals ?? []) {
    const classified = classifyArtifact(signal.path) ?? {
      band: "deployment" as const,
      title: signal.label,
      role: `${signal.kind} configuration`,
      pathHint: signal.path,
      shape: "box" as const,
    };
    upsert({ ...classified, files: [signal.path] });
  }

  // External actors & stores when relevant bands exist
  const hasServer = [...bucket.values()].some((c) => c.band === "server");
  const hasClient = [...bucket.values()].some((c) => c.band === "client");
  const hasPersistence = [...bucket.values()].some((c) => c.band === "persistence");
  const hasStorageAdapter = [...bucket.values()].some((c) =>
    /storage/i.test(c.title),
  );

  if (hasServer) {
    upsert({
      band: "actors",
      title: "HTTP consumer",
      role: "external actor",
      shape: "actor",
    });
  }
  if (hasClient) {
    upsert({
      band: "actors",
      title: "Browser",
      role: "external actor",
      shape: "actor",
    });
  }
  if (hasPersistence) {
    upsert({
      band: "persistence",
      title: "Database service",
      role: "external persistence",
      shape: "store",
    });
  }
  if (hasStorageAdapter) {
    upsert({
      band: "persistence",
      title: "Storage service",
      role: "external storage",
      shape: "store",
    });
  }

  // Fallback: unclassified code folders as shared modules (avoid empty diagram)
  if (bucket.size === 0) {
    for (const file of input.codeFiles.slice(0, 12)) {
      const parts = file.path.split("/");
      const root = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length)).join("/") : file.path;
      upsert({
        band: "shared",
        title: root,
        role: "module in the repository",
        pathHint: file.path,
        shape: "box",
        files: [file.path],
      });
    }
  }

  const components = [...bucket.values()];
  const byTitle = (title: string) => components.find((c) => c.title === title);

  const edges: ArchitectureEdge[] = [];
  const link = (fromTitle: string, toTitle: string, label: string) => {
    const from = byTitle(fromTitle);
    const to = byTitle(toTitle);
    if (!from || !to) return;
    edges.push({ from: from.id, to: to.id, label });
  };

  // Semantic edges (GitDiagram-style)
  link("HTTP consumer", "Server runtime", "addresses");
  link("HTTP consumer", "API handlers", "addresses");
  link("Browser", "HTML host", "loads");
  link("HTML host", "Browser application", "hosts");
  link("Browser application", "Presentation styles", "owns");
  link("Browser application", "Client models", "owns");
  link("Browser application", "Client integration", "owns");
  link("Browser application", "UI surface", "owns");
  link("Hosting configuration", "HTML host", "hosts");
  link("Compose configuration", "Server runtime", "configures");
  link("Container definition", "Server runtime", "packages");
  link("Deployment configuration", "Server runtime", "configures");
  link("Reverse proxy", "Server runtime", "exposes");
  link("CI workflow", "Server runtime", "builds");
  link("Build configuration", "Browser application", "bundles");
  link("Server runtime", "Storage adapter", "uses");
  link("Storage adapter", "Storage service", "separates storage concern");
  link("Server runtime", "Data access", "uses");
  link("Data access", "Database service", "queries");
  link("Server SQL schema", "Database service", "defines schema for");
  link("Supabase SQL assets", "Database service", "defines schema for");
  link("SQL schema", "Database service", "defines schema for");
  link("Authentication", "Server runtime", "secures");
  link("API handlers", "Domain services", "calls");
  link("API handlers", "Authentication", "uses");

  const narrative: string[] = [];
  const bands = new Set(components.map((c) => c.band));
  if (bands.has("client") && bands.has("server")) {
    narrative.push("Browser client and server runtime are separated — requests cross the HTTP boundary.");
  }
  if (bands.has("deployment")) {
    narrative.push("Deployment configuration packages, exposes, or hosts the running services.");
  }
  if (bands.has("persistence")) {
    narrative.push("Persistence definitions and data access map onto external storage services.");
  }
  if (narrative.length === 0) {
    narrative.push("Systems are inferred from file roles (entrypoints, schemas, deploy configs) — not folder names alone.");
  }
  narrative.push("Arrows are semantic architecture links (configures, hosts, owns…), plus any resolved imports.");

  return { components, edges, narrative };
}
