import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// `booking.status` is written in exactly one place: BookingEngine (packages/core/src/booking/engine.ts).
// The database trigger is the real backstop (a status change needs `app.transition_id`). This is a
// source scan that catches the likely ways of bypassing the engine in application code.
//
// What it flags, in every non-test source file under apps/ and packages/core/src except engine.ts:
//  A. any use of the `app.transition_id` setting (the only way past the trigger);
//  B. a Prisma write on the booking model (`.booking.update|updateMany|upsert|create|createMany...`)
//     whose arguments mention `status`;
//  C. raw SQL `UPDATE booking` or `INSERT INTO booking` that mentions `status`.
//
// Limits: it is textual. It does not follow a data object built elsewhere and passed in
// (`data: someObject`), a spread of an object that holds `status`, a SQL string assembled from pieces,
// a model reached through an alias (`const b = tx.booking; b.update(...)`), or a database function
// called through `$queryRaw`. A is the strongest rule: without `app.transition_id` no status write
// can succeed, and it cannot be hidden by indirection except by building the setting name from parts.
// packages/database (its test factories walk bookings with `set_config` on purpose) is out of scope.

const REPO = resolve(import.meta.dirname, '../../../..');
const ENGINE = 'packages/core/src/booking/engine.ts';
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  'generated',
  'test',
  'tests',
  '__tests__',
]);
const SOURCE = /\.(?:[cm]?[tj]sx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[tj]sx?$/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** The text inside the balanced parentheses that start at `open`. */
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

function findViolations(source: string): string[] {
  const text = stripComments(source);
  const found: string[] = [];
  if (/app\.transition_id/.test(text)) found.push('uses app.transition_id');
  for (const match of text.matchAll(
    /\.booking\.(?:update|updateMany|upsert|create|createMany|createManyAndReturn|updateManyAndReturn)\s*\(/g,
  )) {
    const args = balanced(text, match.index + match[0].length - 1);
    if (/\bstatus\b/.test(args)) found.push(`writes booking status: ${match[0].trim()}`);
  }
  for (const match of text.matchAll(
    /\b(?:UPDATE\s+"?booking"?|INSERT\s+INTO\s+"?booking"?)(?![\w"])/gi,
  )) {
    const rest = text.slice(match.index, match.index + 400).split('`')[0] ?? '';
    if (/\bstatus\b/i.test(rest)) found.push(`raw SQL writes booking status: ${match[0]}`);
  }
  return found;
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* sourceFiles(join(dir, entry.name));
    } else if (
      SOURCE.test(entry.name) &&
      !TEST_FILE.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      yield join(dir, entry.name);
    }
  }
}

describe('the booking status has one writer', () => {
  it('no source file under apps/ or packages/core/src writes booking.status except the engine', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of ['apps', 'packages/core/src']) {
      for (const file of sourceFiles(join(REPO, root))) {
        const path = relative(REPO, file).replaceAll('\\', '/');
        if (path === ENGINE) continue;
        scanned += 1;
        for (const violation of findViolations(readFileSync(file, 'utf8')))
          offenders.push(`${path}: ${violation}`);
      }
    }
    expect(scanned).toBeGreaterThan(20); // the scan really walked the tree
    expect(offenders).toEqual([]);
  });

  it('the engine itself is the file that the scan skips (so the rule is not vacuous)', () => {
    expect(findViolations(readFileSync(join(REPO, ENGINE), 'utf8')).length).toBeGreaterThan(0);
  });

  describe('the scanner', () => {
    it('flags a Prisma write that sets status', () => {
      expect(
        findViolations('await tx.booking.update({ where: { id }, data: { status: "PAID" } });'),
      ).toHaveLength(1);
      expect(findViolations('await tx.booking.create({ data: { status, id } })')).toHaveLength(1);
      expect(
        findViolations('await tx.booking.updateMany({ where: { status: "X" }, data: {} })'),
      ).toHaveLength(1);
    });

    it('flags raw SQL and the transition setting', () => {
      expect(
        findViolations("tx.$executeRaw`UPDATE booking SET status = 'PAID' WHERE id = ${id}`"),
      ).toHaveLength(1);
      expect(findViolations('INSERT INTO "booking" (id, status) VALUES ($1, $2)')).toHaveLength(1);
      expect(findViolations("SELECT set_config('app.transition_id', 'T-03', true)")).toHaveLength(
        1,
      );
    });

    it('leaves alone writes that do not touch status, other tables and comments', () => {
      expect(
        findViolations('await tx.booking.update({ where: { id }, data: { itemName: "x" } });'),
      ).toEqual([]);
      expect(findViolations('await tx.booking.findMany({ where: { status: "PAID" } });')).toEqual(
        [],
      );
      expect(findViolations('await tx.bookingLine.update({ data: { status: "DONE" } });')).toEqual(
        [],
      );
      expect(findViolations("tx.$executeRaw`UPDATE booking_line SET status = 'DONE'`")).toEqual([]);
      expect(
        findViolations('// tx.booking.update({ data: { status } }) and app.transition_id'),
      ).toEqual([]);
      expect(findViolations('/* UPDATE booking SET status */ const a = 1;')).toEqual([]);
    });
  });
});
