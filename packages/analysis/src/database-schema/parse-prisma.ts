import type { DatabaseColumn, DatabaseForeignKey, DatabaseTable } from "@gitimpact/shared";

/**
 * Best-effort Prisma schema extractor (models + @relation / @id fields).
 * Not a full Prisma parser — enough for ERD visualization.
 */
export function parsePrismaSchema(
  source: string,
  sourceFile: string,
): { tables: DatabaseTable[]; foreignKeys: DatabaseForeignKey[] } {
  const tables: DatabaseTable[] = [];
  const foreignKeys: DatabaseForeignKey[] = [];
  let fkCounter = 0;

  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\}/g;
  let match: RegExpExecArray | null;
  while ((match = modelRe.exec(source)) !== null) {
    const tableName = match[1]!;
    const body = match[2] ?? "";
    const columns: DatabaseColumn[] = [];

    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const field = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/);
      if (!field) continue;
      const name = field[1]!;
      const typeName = field[2]!;
      const isList = Boolean(field[3]);
      const optional = Boolean(field[4]);
      const attrs = field[5] ?? "";

      // Relation fields (capitalized type, or @relation) — skip as columns, capture FK-ish attrs
      const isRelationType = /^[A-Z]/.test(typeName) && !/^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes|Unsupported)$/.test(typeName);
      if (isRelationType || isList) {
        const fieldsAttr = attrs.match(/fields:\s*\[([^\]]+)\]/);
        const refsAttr = attrs.match(/references:\s*\[([^\]]+)\]/);
        if (fieldsAttr && refsAttr) {
          const fromCol = fieldsAttr[1]!.split(",")[0]!.trim();
          const toCol = refsAttr[1]!.split(",")[0]!.trim();
          fkCounter += 1;
          foreignKeys.push({
            id: `fk_${tableName}_${fromCol}_${fkCounter}`,
            fromTable: tableName,
            fromColumn: fromCol,
            toTable: typeName,
            toColumn: toCol,
            sourceFile,
          });
        }
        continue;
      }

      columns.push({
        name,
        type: typeName.toLowerCase(),
        primaryKey: /@id\b/.test(attrs),
        unique: /@unique\b/.test(attrs),
        nullable: optional,
      });
    }

    tables.push({
      name: tableName,
      columns,
      sourceFiles: [sourceFile],
    });
  }

  return { tables, foreignKeys };
}
