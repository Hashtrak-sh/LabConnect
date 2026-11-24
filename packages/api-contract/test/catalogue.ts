import { markdownSection } from './helpers.js';

// Parser for the endpoint tables of docs/04-api/API_CONTRACTS.md, and the comparison of a
// table with the contract. doc-equality.test.ts uses it for every covered section;
// catalogue.test.ts pins the cell shapes it understands.

/** HTTP methods a table may name. `CRUD` in the method column stands for all of them. */
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * One part of a path cell: the methods that apply to it and the concrete paths it stands for.
 * A part `/x[/{id}]` stands for two paths; `/x/{id}/a\|b` for `/x/{id}/a` and `/x/{id}/b`.
 */
export interface CatalogueGroup {
  /** The cell text the group came from, for messages. */
  source: string;
  methods: string[];
  /** True for `CRUD`: the row allows these methods but does not promise each one. */
  methodsOptional: boolean;
  paths: string[];
  /** Query parameter names shown in the cell (`?unread=true` → `unread`). */
  queryNames: string[];
}

export interface CatalogueSection {
  heading: string;
  rows: number;
  groups: CatalogueGroup[];
}

/** Header row and body rows of the first markdown table in the lines, split into cells. */
export function firstTable(lines: string[]): { header: string[]; rows: string[][] } {
  const start = lines.findIndex((line) => line.trimStart().startsWith('|'));
  if (start === -1) throw new Error('No table found');
  let end = start;
  while (end < lines.length && (lines[end] ?? '').trimStart().startsWith('|')) end += 1;
  const cells = lines.slice(start, end).map((line) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim()),
  );
  // Second row is the `|---|` separator.
  return { header: cells[0] ?? [], rows: cells.slice(2) };
}

/** `/a/b[/{id}]` → `/a/b`, `/a/b/{id}`; `/a/x\|y` → `/a/x`, `/a/y`. */
export function expandPath(path: string): string[] {
  const optional = /\[([^\]]+)\]/.exec(path);
  if (optional) {
    const before = path.slice(0, optional.index);
    const after = path.slice(optional.index + optional[0].length);
    return [...expandPath(before + after), ...expandPath(before + (optional[1] ?? '') + after)];
  }
  let results = [''];
  for (const segment of path.split('/').slice(1)) {
    const options = segment.split('\\|');
    results = results.flatMap((prefix) => options.map((option) => `${prefix}/${option}`));
  }
  for (const result of results) {
    if (!/^(\/[A-Za-z0-9{}._-]+)+$/.test(result)) {
      throw new Error(`Cannot expand path "${path}": "${result}" is not a plain path`);
    }
  }
  return results;
}

/** Path parameters are written `{name}`. */
const hasParameter = (path: string): boolean => /\{[^}]+\}/.test(path);
const firstSegment = (path: string): string => path.split('/')[1] ?? '';

/**
 * Resolves a part that continues the previous absolute path, as in
 * `/bookings/{id}/counter/accept` · `/counter/decline`: the continuation replaces everything
 * after the last path parameter of the previous absolute path.
 */
function resolveContinuation(previous: string, continuation: string): string {
  const segments = previous.replace(/\[[^\]]*\]/g, '').split('/');
  let lastParameter = -1;
  segments.forEach((segment, i) => {
    if (hasParameter(segment)) lastParameter = i;
  });
  if (lastParameter === -1) {
    throw new Error(
      `Cannot resolve "${continuation}" after "${previous}": the previous path has no ` +
        'parameter to continue from. Write the full path in API_CONTRACTS.md.',
    );
  }
  return segments.slice(0, lastParameter + 1).join('/') + continuation;
}

function parseMethods(text: string, context: string): { list: string[]; optional: boolean } {
  if (text === 'CRUD') return { list: [...methods], optional: true };
  const list = text.split('/').map((m) => m.trim());
  for (const m of list) {
    if (!(methods as readonly string[]).includes(m)) {
      throw new Error(`Unknown method "${m}" in "${context}"`);
    }
  }
  return { list, optional: false };
}

/**
 * Parses one table row from its method cell and path cell.
 *
 * Path cell grammar: parts separated by `·` or `,`. A part is a backticked path, optionally
 * preceded by its own methods (`POST /x`) and followed by a parenthetical note (`(upload)`).
 * A part without methods takes those of the previous part that had some, or the row's.
 * A path may carry a query string; only parameter names are kept (`…` and values are ignored).
 * A part is absolute when it starts with the first segment of the cell's first path or contains
 * a path parameter; otherwise it continues the previous absolute path.
 */
export function parseRow(methodCell: string, pathCell: string): CatalogueGroup[] {
  const rowMethods = parseMethods(methodCell.trim(), methodCell);
  const partPattern = /(?:\b([A-Z]+(?:\/[A-Z]+)*)\s+)?`([^`]+)`(?:\s*\([^)]*\))?/g;
  const leftover = pathCell.replace(partPattern, '').replace(/[\s·,]/g, '');
  if (leftover !== '')
    throw new Error(`Cannot parse path cell "${pathCell}" (left: "${leftover}")`);

  const groups: CatalogueGroup[] = [];
  let current = rowMethods;
  let root = '';
  let lastAbsolute = '';
  for (const match of pathCell.matchAll(partPattern)) {
    if (match[1]) current = parseMethods(match[1], pathCell);
    const [rawPath = '', query] = (match[2] ?? '').split('?');
    let path = rawPath;
    if (root === '') root = firstSegment(path);
    if (firstSegment(path) === root || hasParameter(path)) {
      lastAbsolute = path;
    } else {
      path = resolveContinuation(lastAbsolute, path);
    }
    const queryNames = (query ?? '')
      .split('&')
      .map((pair) => pair.split('=')[0] ?? '')
      .filter((name) => /^[A-Za-z][A-Za-z0-9]*$/.test(name));
    groups.push({
      source: match[0],
      methods: current.list,
      methodsOptional: current.optional,
      paths: expandPath(path),
      queryNames,
    });
  }
  return groups;
}

/** Parses the endpoint table of one section, located by its heading (`## 2. Public`). */
export function parseSection(markdown: string, heading: string): CatalogueSection {
  const { header, rows } = firstTable(markdownSection(markdown, heading));
  const methodColumn = header.indexOf('Method');
  const pathColumn = header.indexOf('Path');
  if (methodColumn === -1 || pathColumn === -1) {
    throw new Error(`Section "${heading}" has no Method and Path columns`);
  }
  const groups = rows.flatMap((row) => parseRow(row[methodColumn] ?? '', row[pathColumn] ?? ''));
  return { heading, rows: rows.length, groups };
}

/** Every `METHOD /path` a group allows. */
export function allowedKeys(group: CatalogueGroup): string[] {
  return group.methods.flatMap((m) => group.paths.map((p) => `${m} ${p}`));
}

/**
 * Compares covered sections with the contract's operation keys (`GET /x`).
 *
 * Missing: each path of a group must have at least one of the group's methods, and each method
 * (unless `CRUD`) must be used on at least one of its paths. With one method or one path this
 * means every combination; `GET/PATCH /x` means both.
 *
 * Extra: a contract operation whose first path segment occurs in a covered section must be
 * allowed by some group of the covered sections.
 */
export function compareWithContract(
  sections: CatalogueSection[],
  operationKeys: string[],
): { missing: string[]; extra: string[] } {
  const inContract = new Set(operationKeys);
  const missing: string[] = [];
  const allowed = new Set<string>();
  const roots = new Set<string>();
  for (const group of sections.flatMap((s) => s.groups)) {
    for (const key of allowedKeys(group)) allowed.add(key);
    for (const path of group.paths) {
      roots.add(firstSegment(path));
      if (!group.methods.some((m) => inContract.has(`${m} ${path}`))) {
        missing.push(`${group.methods.join('/')} ${path}`);
      }
    }
    if (group.methodsOptional) continue;
    for (const m of group.methods) {
      if (!group.paths.some((p) => inContract.has(`${m} ${p}`))) {
        missing.push(`${m} ${group.paths.join(' or ')}`);
      }
    }
  }
  const extra = operationKeys.filter((key) => {
    const path = key.split(' ')[1] ?? '';
    return roots.has(firstSegment(path)) && !allowed.has(key);
  });
  return { missing: [...new Set(missing)], extra };
}
