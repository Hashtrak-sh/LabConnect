import { readFileSync } from 'node:fs';

/** Reads a file relative to the repository root. */
export function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');
}

/** The lines of a markdown section, from its heading to the next heading of the same level. */
export function markdownSection(markdown: string, headingPrefix: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (start === -1) throw new Error(`Heading not found: ${headingPrefix}`);
  const level = /^#+ /.exec(headingPrefix)?.[0] ?? '## ';
  const end = lines.findIndex((line, i) => i > start && line.startsWith(level));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** The header and body rows of the first markdown table in the given lines, as trimmed cells. */
export function markdownTable(lines: string[]): { header: string[]; rows: string[][] } {
  const tableLines: string[] = [];
  for (const line of lines.slice(lines.findIndex((l) => l.trimStart().startsWith('|')))) {
    if (!line.trimStart().startsWith('|')) break;
    tableLines.push(line);
  }
  const [header = [], , ...rows] = tableLines.map((line) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim()),
  );
  return { header, rows };
}

/** Backticked tokens in a markdown cell. */
export function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
}

/** The values of a Prisma enum in enums.prisma, in order. */
export function prismaEnum(name: string): string[] {
  const schema = readRepoFile('packages/database/prisma/schema/enums.prisma');
  const body = new RegExp(`^enum ${name} \\{([^}]*)\\}`, 'm').exec(schema)?.[1];
  if (body === undefined) throw new Error(`Prisma enum not found: ${name}`);
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));
}

/**
 * The `enum:` list of a top-level schema in one of the split OpenAPI YAML files. A deliberately
 * small parse: the schema name at column 0, then `  enum:` and its `    - VALUE` items.
 */
export function yamlEnum(relativePath: string, schemaName: string): string[] {
  const lines = readRepoFile(relativePath).split(/\r?\n/);
  const start = lines.indexOf(`${schemaName}:`);
  if (start === -1) throw new Error(`Schema not found: ${schemaName}`);
  const end = lines.findIndex((line, i) => i > start && /^\S/.test(line));
  const block = lines.slice(start + 1, end === -1 ? undefined : end);
  const enumAt = block.indexOf('  enum:');
  if (enumAt === -1) throw new Error(`No enum in ${schemaName}`);
  const values: string[] = [];
  for (const line of block.slice(enumAt + 1)) {
    const match = /^ {4}- (\S+)$/.exec(line);
    if (!match) break;
    values.push(match[1] ?? '');
  }
  return values;
}
