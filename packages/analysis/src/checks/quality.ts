import type {
  CheckFinding,
  DependencyGraph,
  ParsedFile,
} from "@gitimpact/shared";
import { GraphStore } from "@gitimpact/graph";

function finding(
  partial: Omit<CheckFinding, "id" | "confidence"> & { confidence?: CheckFinding["confidence"] },
): CheckFinding {
  return {
    confidence: "MEDIUM",
    ...partial,
    id: `${partial.ruleId}:${partial.file ?? "repo"}:${partial.startLine ?? 0}:${partial.symbolName ?? partial.title}`,
  };
}

function cyclomaticApprox(content: string, startLine: number, endLine: number): number {
  const lines = content.split(/\r?\n/).slice(Math.max(0, startLine - 1), endLine);
  const body = lines.join("\n");
  const keywords = body.match(
    /\b(if|else if|for|while|case|catch|&&|\|\||\?)\b/g,
  );
  return 1 + (keywords?.length ?? 0);
}

export function runQualityChecks(input: {
  files: ParsedFile[];
  contentsByPath: Map<string, string>;
  graph: DependencyGraph;
}): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const store = new GraphStore(input.graph);

  // Circular dependencies via IMPORTS
  const cycles = findImportCycles(store);
  for (const cycle of cycles.slice(0, 15)) {
    findings.push(
      finding({
        ruleId: "circular_dependency",
        category: "quality",
        severity: "high",
        title: "Circular dependency detected",
        message: `Import cycle: ${cycle.map((id) => id.replace(/^FILE:/, "")).join(" → ")}`,
        file: cycle[0]?.replace(/^FILE:/, ""),
        evidence: cycle.join(" → "),
        confidence: "HIGH",
      }),
    );
  }

  const exportUses = buildExportUseMap(input.files, store);
  const nameCounts = new Map<string, number>();

  for (const file of input.files) {
    if (file.isTest) continue;
    const content = input.contentsByPath.get(file.path) ?? "";

    for (const fn of file.functions) {
      const loc = fn.endLine - fn.startLine + 1;
      const complexity = cyclomaticApprox(content, fn.startLine, fn.endLine);
      nameCounts.set(fn.name, (nameCounts.get(fn.name) ?? 0) + 1);

      if (loc >= 80) {
        findings.push(
          finding({
            ruleId: "large_function",
            category: "quality",
            severity: "medium",
            title: "Large function",
            message: `${fn.name} spans ${loc} lines. Consider splitting for maintainability.`,
            file: file.path,
            startLine: fn.startLine,
            endLine: fn.endLine,
            symbolName: fn.name,
            confidence: "HIGH",
          }),
        );
      }
      if (complexity >= 15) {
        findings.push(
          finding({
            ruleId: "high_complexity_function",
            category: "quality",
            severity: complexity >= 25 ? "high" : "medium",
            title: "High-complexity function",
            message: `${fn.name} has approximate cyclomatic complexity ${complexity}.`,
            file: file.path,
            startLine: fn.startLine,
            endLine: fn.endLine,
            symbolName: fn.name,
            confidence: "MEDIUM",
          }),
        );
      }

      if (fn.exported) {
        const key = `${file.path}:${fn.name}`;
        if (!exportUses.has(key)) {
          findings.push(
            finding({
              ruleId: "unused_export",
              category: "quality",
              severity: "low",
              title: "Possibly unused export",
              message: `Exported function ${fn.name} has no in-repo import/call references detected.`,
              file: file.path,
              startLine: fn.startLine,
              symbolName: fn.name,
              confidence: "LOW",
            }),
          );
        }
      }
    }

    for (const cls of file.classes) {
      const loc = cls.endLine - cls.startLine + 1;
      if (loc >= 250) {
        findings.push(
          finding({
            ruleId: "large_class",
            category: "quality",
            severity: "medium",
            title: "Large class",
            message: `${cls.name} spans ${loc} lines.`,
            file: file.path,
            startLine: cls.startLine,
            endLine: cls.endLine,
            symbolName: cls.name,
            confidence: "HIGH",
          }),
        );
      }
      for (const method of cls.methods) {
        const complexity = cyclomaticApprox(content, method.startLine, method.endLine);
        if (complexity >= 15) {
          findings.push(
            finding({
              ruleId: "high_complexity_function",
              category: "quality",
              severity: complexity >= 25 ? "high" : "medium",
              title: "High-complexity method",
              message: `${cls.name}.${method.name} has approximate cyclomatic complexity ${complexity}.`,
              file: file.path,
              startLine: method.startLine,
              endLine: method.endLine,
              symbolName: `${cls.name}.${method.name}`,
              confidence: "MEDIUM",
            }),
          );
        }
      }
    }

    // unsafe any
    const anyMatches = content.matchAll(/\bany\b/g);
    let anyCount = 0;
    for (const match of anyMatches) {
      anyCount += 1;
      if (anyCount > 8) break;
      const idx = match.index ?? 0;
      const line = content.slice(0, idx).split(/\n/).length;
      // Prefer type positions: `: any` or `as any`
      const around = content.slice(Math.max(0, idx - 3), idx + 6);
      if (!/:\s*any\b|as\s+any\b|<any>/.test(around) && !/: any/.test(around)) continue;
      findings.push(
        finding({
          ruleId: "unsafe_any",
          category: "quality",
          severity: "low",
          title: "Unsafe any usage",
          message: "Explicit `any` weakens type safety for this symbol/region.",
          file: file.path,
          startLine: line,
          evidence: around.trim(),
          confidence: "MEDIUM",
        }),
      );
    }

    // weak error handling: empty catch
    const emptyCatch = content.matchAll(/catch\s*\([^)]*\)\s*\{\s*\}/g);
    for (const match of emptyCatch) {
      const line = content.slice(0, match.index ?? 0).split(/\n/).length;
      findings.push(
        finding({
          ruleId: "weak_error_handling",
          category: "quality",
          severity: "medium",
          title: "Empty catch block",
          message: "Errors are swallowed without handling or logging.",
          file: file.path,
          startLine: line,
          confidence: "HIGH",
        }),
      );
    }
  }

  for (const [name, count] of nameCounts) {
    if (count < 4 || name.length < 3) continue;
    if (/^(handler|run|main|init|setup|test|get|set)$/i.test(name)) continue;
    findings.push(
      finding({
        ruleId: "duplicate_function_name",
        category: "quality",
        severity: "info",
        title: "Repeated function name",
        message: `Function name "${name}" appears ${count} times across the repository. Confirm intentional overloads vs copy-paste.`,
        symbolName: name,
        confidence: "LOW",
      }),
    );
  }

  return dedupe(findings).slice(0, 200);
}

function buildExportUseMap(
  files: ParsedFile[],
  store: GraphStore,
): Set<string> {
  const used = new Set<string>();
  for (const file of files) {
    for (const edge of store.getOutgoing(`FILE:${file.path}`)) {
      if (edge.type === "IMPORTS" || edge.type === "CALLS") {
        const target = store.getNode(edge.to);
        if (target?.file && target.name) {
          used.add(`${target.file}:${target.name.split(".").pop()}`);
          used.add(`${target.file}:${target.name}`);
        }
      }
    }
    for (const fn of file.functions) {
      for (const call of fn.calls) {
        if (call.resolvedFile && call.resolvedSymbol) {
          used.add(`${call.resolvedFile}:${call.resolvedSymbol}`);
        }
      }
    }
    for (const cls of file.classes) {
      for (const method of cls.methods) {
        for (const call of method.calls) {
          if (call.resolvedFile && call.resolvedSymbol) {
            used.add(`${call.resolvedFile}:${call.resolvedSymbol}`);
          }
        }
      }
    }
  }
  return used;
}

function findImportCycles(store: GraphStore): string[][] {
  const files = store.getNodes().filter((n) => n.type === "FILE").map((n) => n.id);
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      if (idx >= 0) {
        const cycle = [...stack.slice(idx), node];
        if (cycle.length >= 3) cycles.push(cycle);
      }
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const edge of store.getOutgoing(node)) {
      if (edge.type !== "IMPORTS") continue;
      if (!edge.to.startsWith("FILE:")) continue;
      dfs(edge.to);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const file of files.slice(0, 400)) dfs(file);
  return cycles;
}

function dedupe(findings: CheckFinding[]): CheckFinding[] {
  const seen = new Set<string>();
  const out: CheckFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}
