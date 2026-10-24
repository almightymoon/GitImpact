import type { DatabaseColumn, DatabaseForeignKey, DatabaseTable } from "@gitimpact/shared";

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function unquoteIdent(raw: string): string {
  return raw.replace(/^["'`\[]+|["'`\]]+$/g, "").trim();
}

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseType(tokens: string[]): string {
  if (tokens.length === 0) return "unknown";
  let type = tokens[0]!;
  if (tokens[1]?.startsWith("(")) {
    type += tokens[1];
  } else if (tokens[1] === "(" && tokens[2]) {
    type += `(${tokens[2]}`;
    if (tokens[3] === ")") type += ")";
  }
  return type.toLowerCase();
}

function tokenizeColumnLine(line: string): string[] {
  return line
    .replace(/\s+/g, " ")
    .trim()
    .match(/(?:\([^)]*\)|[^\s,]+)/g) ?? [];
}

export function parseSqlSchema(
  sql: string,
  sourceFile: string,
): { tables: DatabaseTable[]; foreignKeys: DatabaseForeignKey[] } {
  const cleaned = stripSqlComments(sql);
  const tables = new Map<string, DatabaseTable>();
  const foreignKeys: DatabaseForeignKey[] = [];
  let fkCounter = 0;

  const createRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(([\s\S]*?)\)\s*(?:;|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = createRe.exec(cleaned)) !== null) {
    const tableName = unquoteIdent(match[1]!.replace(/^[^.]*\./, ""));
    const body = match[2] ?? "";
    const columns: DatabaseColumn[] = [];
    const tablePkCols = new Set<string>();

    for (const part of splitTopLevelCommas(body)) {
      const upper = part.toUpperCase();
      if (upper.startsWith("CONSTRAINT ") || upper.startsWith("UNIQUE (")) {
        const fk = part.match(
          /foreign\s+key\s*\(\s*([^)]+)\s*\)\s*references\s+([^\s(]+)\s*(?:\(\s*([^)]+)\s*\))?/i,
        );
        if (fk) {
          const fromCol = unquoteIdent(fk[1]!.split(",")[0]!);
          const toTable = unquoteIdent(fk[2]!.replace(/^[^.]*\./, ""));
          const toCol = unquoteIdent((fk[3] ?? "id").split(",")[0]!);
          fkCounter += 1;
          foreignKeys.push({
            id: `fk_${tableName}_${fromCol}_${fkCounter}`,
            fromTable: tableName,
            fromColumn: fromCol,
            toTable,
            toColumn: toCol,
            sourceFile,
          });
        }
        const pk = part.match(/primary\s+key\s*\(\s*([^)]+)\s*\)/i);
        if (pk) {
          for (const c of pk[1]!.split(",")) tablePkCols.add(unquoteIdent(c));
        }
        continue;
      }
      if (upper.startsWith("PRIMARY KEY") || upper.startsWith("FOREIGN KEY")) {
        const fk = part.match(
          /foreign\s+key\s*\(\s*([^)]+)\s*\)\s*references\s+([^\s(]+)\s*(?:\(\s*([^)]+)\s*\))?/i,
        );
        if (fk) {
          const fromCol = unquoteIdent(fk[1]!.split(",")[0]!);
          const toTable = unquoteIdent(fk[2]!.replace(/^[^.]*\./, ""));
          const toCol = unquoteIdent((fk[3] ?? "id").split(",")[0]!);
          fkCounter += 1;
          foreignKeys.push({
            id: `fk_${tableName}_${fromCol}_${fkCounter}`,
            fromTable: tableName,
            fromColumn: fromCol,
            toTable,
            toColumn: toCol,
            sourceFile,
          });
        }
        const pk = part.match(/primary\s+key\s*\(\s*([^)]+)\s*\)/i);
        if (pk) {
          for (const c of pk[1]!.split(",")) tablePkCols.add(unquoteIdent(c));
        }
        continue;
      }
      if (upper.startsWith("CHECK ") || upper.startsWith("EXCLUDE ")) continue;

      const tokens = tokenizeColumnLine(part);
      if (tokens.length < 2) continue;
      const name = unquoteIdent(tokens[0]!);
      if (!name || /^(constraint|primary|foreign|unique|check|exclude)$/i.test(name)) {
        continue;
      }
      const typeTokens = tokens.slice(1);
      const type = parseType(typeTokens);
      const lineUpper = part.toUpperCase();
      const primaryKey = /\bPRIMARY\s+KEY\b/.test(lineUpper);
      const unique = /\bUNIQUE\b/.test(lineUpper);
      const nullable = !/\bNOT\s+NULL\b/.test(lineUpper) && !primaryKey;
      const ref = part.match(
        /\breferences\s+([^\s(]+)\s*(?:\(\s*([^)]+)\s*\))?/i,
      );
      const column: DatabaseColumn = {
        name,
        type,
        primaryKey,
        unique,
        nullable,
      };
      if (ref) {
        const toTable = unquoteIdent(ref[1]!.replace(/^[^.]*\./, ""));
        const toCol = unquoteIdent((ref[2] ?? "id").split(",")[0]!);
        column.references = { table: toTable, column: toCol };
        fkCounter += 1;
        foreignKeys.push({
          id: `fk_${tableName}_${name}_${fkCounter}`,
          fromTable: tableName,
          fromColumn: name,
          toTable,
          toColumn: toCol,
          sourceFile,
        });
      }
      columns.push(column);
    }

    for (const col of columns) {
      if (tablePkCols.has(col.name)) col.primaryKey = true;
    }

    const existing = tables.get(tableName);
    if (existing) {
      const names = new Set(existing.columns.map((c) => c.name));
      for (const col of columns) {
        if (!names.has(col.name)) existing.columns.push(col);
      }
      if (!existing.sourceFiles.includes(sourceFile)) {
        existing.sourceFiles.push(sourceFile);
      }
    } else {
      tables.set(tableName, {
        name: tableName,
        columns,
        sourceFiles: [sourceFile],
      });
    }
  }

  const alterFkRe =
    /alter\s+table\s+([^\s]+)\s+add\s+(?:constraint\s+\S+\s+)?foreign\s+key\s*\(\s*([^)]+)\s*\)\s*references\s+([^\s(]+)\s*(?:\(\s*([^)]+)\s*\))?/gi;
  while ((match = alterFkRe.exec(cleaned)) !== null) {
    const fromTable = unquoteIdent(match[1]!.replace(/^[^.]*\./, ""));
    const fromColumn = unquoteIdent(match[2]!.split(",")[0]!);
    const toTable = unquoteIdent(match[3]!.replace(/^[^.]*\./, ""));
    const toColumn = unquoteIdent((match[4] ?? "id").split(",")[0]!);
    fkCounter += 1;
    foreignKeys.push({
      id: `fk_${fromTable}_${fromColumn}_${fkCounter}`,
      fromTable,
      fromColumn,
      toTable,
      toColumn,
      sourceFile,
    });
  }

  return { tables: [...tables.values()], foreignKeys };
}
