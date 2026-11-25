/**
 * Canonical JSON for hashing (AUDIT_AND_EVENT_ARCHITECTURE.md section 2): the same value
 * always gives the same bytes, whatever the key order or the runtime types.
 *
 * - Object keys are sorted by UTF-16 code unit, with no whitespace.
 * - `undefined` object members are left out; `undefined` in an array becomes `null`.
 * - Numbers must be finite; `-0` is written `0`.
 * - A bigint is written as its decimal digits (so `1n` and `1` give the same bytes).
 * - A Date is written as a quoted ISO 8601 UTC string with milliseconds.
 * - Anything else that is not plain JSON (functions, symbols, Map, Set, class instances,
 *   Buffer) is an error, so a hash can never depend on an accident of serialisation.
 */
export function canonicalJson(value: unknown): string {
  return write(value, new Set());
}

function write(value: unknown, path: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalJson: NaN and Infinity are not JSON.');
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'bigint':
      return value.toString(10);
    case 'object':
      return writeObject(value, path);
    default:
      throw new Error(`canonicalJson: cannot serialise a value of type ${typeof value}.`);
  }
}

function writeObject(value: object, path: Set<object>): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('canonicalJson: invalid Date.');
    return JSON.stringify(value.toISOString());
  }
  if (path.has(value)) throw new Error('canonicalJson: circular reference.');
  path.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item: unknown) => (item === undefined ? 'null' : write(item, path))).join(',')}]`;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('canonicalJson: only plain objects, arrays and Dates are supported.');
    }
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${write(record[key], path)}`);
    return `{${members.join(',')}}`;
  } finally {
    path.delete(value);
  }
}
