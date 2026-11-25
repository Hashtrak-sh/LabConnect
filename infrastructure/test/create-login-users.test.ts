import { describe, expect, it } from 'vitest';
import {
  LOGIN_SPECS,
  LoginUserError,
  type QueryClient,
  createLoginUsers,
  describeFailure,
  readLoginUsers,
} from '../scripts/create-login-users.mjs';

const ENV = {
  API_DB_USER: 'labconnect_api',
  API_DB_PASSWORD: 'api-password-1',
  WORKER_DB_USER: 'labconnect_worker',
  WORKER_DB_PASSWORD: 'worker-password-1',
};

/** A client that records what it is asked and answers "role exists" from a set. */
function fakeClient(existing: string[]) {
  const log: { text: string; values: unknown[] | undefined }[] = [];
  const client: QueryClient = {
    query(text, values) {
      log.push({ text, values });
      if (text.startsWith('SELECT 1 FROM pg_roles')) {
        const name = String(values?.[0]);
        return Promise.resolve({ rows: existing.includes(name) ? [{}] : [] });
      }
      if (text.includes('AS sql'))
        return Promise.resolve({ rows: [{ sql: `/* ${text.slice(0, 30)} */` }] });
      return Promise.resolve({ rows: [] });
    },
  };
  return { client, log };
}

describe('create-login-users', () => {
  it('maps the API login to app_rw and the worker login to app_worker', () => {
    expect(LOGIN_SPECS.map((s) => s.role)).toEqual(['app_rw', 'app_worker']);
    expect(readLoginUsers(ENV)).toEqual([
      { user: 'labconnect_api', password: 'api-password-1', role: 'app_rw' },
      { user: 'labconnect_worker', password: 'worker-password-1', role: 'app_worker' },
    ]);
  });

  it('refuses a missing or odd name or password, naming the variable and never a value', () => {
    expect(() => readLoginUsers({ ...ENV, API_DB_USER: 'Robert"; DROP' })).toThrow(/API_DB_USER/);
    expect(() => readLoginUsers({ ...ENV, WORKER_DB_PASSWORD: '' })).toThrow(/WORKER_DB_PASSWORD/);
    try {
      readLoginUsers({ ...ENV, API_DB_USER: 'bad name' });
    } catch (error) {
      expect(String(error)).not.toContain('bad name');
    }
  });

  it('prints its own messages, and of any other error only a code', () => {
    expect(describeFailure(new LoginUserError('API_DB_USER must be a plain identifier.'))).toBe(
      'API_DB_USER must be a plain identifier.',
    );
    // A database error's text can quote part of a statement, and the statements carry passwords.
    const database = Object.assign(new Error('syntax error at or near "api-password-1"'), {
      code: '42601',
    });
    expect(describeFailure(database)).toBe('create-login-users failed (42601)');
    expect(describeFailure(new Error('connect to postgresql://owner:secret@host failed'))).toBe(
      'create-login-users failed',
    );
    expect(describeFailure({ code: 'not a code; api-password-1' })).toBe(
      'create-login-users failed',
    );
    expect(describeFailure(undefined)).toBe('create-login-users failed');
  });

  it('creates missing users inside one transaction, quoting on the server', async () => {
    const { client, log } = fakeClient(['app_rw', 'app_worker']);
    const touched = await createLoginUsers(client, readLoginUsers(ENV));
    expect(touched).toEqual(['labconnect_api', 'labconnect_worker']);
    expect(log[0]?.text).toBe('BEGIN');
    expect(log.at(-1)?.text).toBe('COMMIT');
    const creates = log.filter((entry) =>
      entry.text.includes("format('CREATE ROLE %I LOGIN INHERIT PASSWORD %L IN ROLE %I'"),
    );
    expect(creates).toHaveLength(2);
    // The password is a bound parameter of format(), never part of the statement text.
    for (const entry of log) {
      expect(entry.text).not.toContain('password-1');
    }
    expect(creates[0]?.values).toEqual(['labconnect_api', 'api-password-1', 'app_rw']);
  });

  it('sets the password again for users that exist (rotation), and renews the membership', async () => {
    const { client, log } = fakeClient([
      'app_rw',
      'app_worker',
      'labconnect_api',
      'labconnect_worker',
    ]);
    await createLoginUsers(client, readLoginUsers(ENV));
    expect(
      log.some((entry) =>
        entry.text.includes("format('ALTER ROLE %I WITH LOGIN INHERIT PASSWORD %L'"),
      ),
    ).toBe(true);
    expect(log.some((entry) => entry.text.includes("format('GRANT %I TO %I'"))).toBe(true);
    expect(log.some((entry) => entry.text.includes('CREATE ROLE'))).toBe(false);
  });

  it('stops with a clear message, and rolls back, when the migrations have not created app_rw', async () => {
    const { client, log } = fakeClient([]);
    await expect(createLoginUsers(client, readLoginUsers(ENV))).rejects.toThrow(
      /role app_rw does not exist.*migrations/,
    );
    expect(log.at(-1)?.text).toBe('ROLLBACK');
  });
});
