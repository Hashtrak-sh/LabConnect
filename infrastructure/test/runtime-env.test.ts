import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NOT_SET_IN_UAT } from '../lib/env-allowlist.js';
import { QUEUE_NAMES, queueUrlVariable } from '../lib/names.js';
import { resourcesOfType, synthesise } from './helpers.js';

interface Container {
  Environment?: { Name: string; Value: unknown }[];
  Secrets?: { Name: string; ValueFrom: unknown }[];
  Command?: string[];
  Image: unknown;
  HealthCheck?: { Command: string[] };
  User?: string;
  PortMappings?: { ContainerPort: number }[];
}

function taskDefinition(context: Record<string, unknown>, family: string) {
  const { templates } = synthesise(context);
  const found = resourcesOfType(templates.compute, 'AWS::ECS::TaskDefinition').find(
    ([, task]) => task.Properties.Family === family,
  );
  expect(found, family).toBeDefined();
  const properties = found?.[1].Properties as {
    ContainerDefinitions: Container[];
    TaskRoleArn: unknown;
    ExecutionRoleArn: unknown;
  };
  const container = properties.ContainerDefinitions[0] as Container;
  return {
    properties,
    container,
    env: new Map((container.Environment ?? []).map((e) => [e.Name, e.Value])),
    secrets: new Map((container.Secrets ?? []).map((s) => [s.Name, s.ValueFrom])),
    names: new Set([
      ...(container.Environment ?? []).map((e) => e.Name),
      ...(container.Secrets ?? []).map((s) => s.Name),
    ]),
  };
}

const exampleFile = fileURLToPath(new URL('../../.env.example', import.meta.url));
/** Every variable `.env.example` names, set or commented out. */
function envExampleKeys(): string[] {
  const keys = new Set<string>();
  for (const line of readFileSync(exampleFile, 'utf8').split(/\r?\n/)) {
    const match = /^#?\s*([A-Z][A-Z0-9_]+)=/.exec(line);
    if (match?.[1]) keys.add(match[1]);
  }
  return [...keys].sort();
}

const OPEN_SEARCH = { enableOpenSearch: 'true' };

describe('.env.example is covered', () => {
  const keys = envExampleKeys();
  const plain = ['api', 'worker', 'migrate'].map((s) => taskDefinition({}, `labconnect-uat-${s}`));
  const withSearch = ['api', 'worker', 'migrate'].map((s) =>
    taskDefinition(OPEN_SEARCH, `labconnect-uat-${s}`),
  );
  const set = new Set([...plain, ...withSearch].flatMap((task) => [...task.names]));

  it('reads the file and finds the variables', () => {
    expect(keys.length).toBeGreaterThan(50);
    expect(keys).toContain('WORKER_DATABASE_URL');
    expect(keys).toContain('QUEUE_URL_LC_FILES');
  });

  it('sets every variable on a task definition or lists it, with a reason, as not set in UAT', () => {
    const forgotten = keys.filter((key) => !set.has(key) && !(key in NOT_SET_IN_UAT));
    expect(
      forgotten,
      'Add these to compute-stack.ts, or to NOT_SET_IN_UAT in lib/env-allowlist.ts with a reason',
    ).toEqual([]);
  });

  it('keeps the list of exceptions honest', () => {
    const stale = Object.keys(NOT_SET_IN_UAT).filter((key) => !keys.includes(key));
    expect(stale, 'No longer in .env.example').toEqual([]);
    const contradictory = Object.keys(NOT_SET_IN_UAT).filter((key) => set.has(key));
    expect(contradictory, 'Listed as not set, but a task definition sets it').toEqual([]);
    for (const reason of Object.values(NOT_SET_IN_UAT)) expect(reason.length).toBeGreaterThan(5);
  });

  it('sets no variable that the application does not know', () => {
    // Variables set on a task definition that are not in .env.example would be typos.
    // .env.example shows two queue URLs as examples; the pattern is documented there for all five.
    const known = new Set([
      ...keys,
      ...Object.values(QUEUE_NAMES).map(queueUrlVariable),
      'NO_COLOR',
      // Read by the reference seed (MIGRATION_AND_SEED_STRATEGY.md section 1), not listed in .env.example.
      'QR_KMS_KEY_ARN_BOOKING',
      'QR_KMS_KEY_ARN_PACKAGE',
      'QR_KMS_KEY_ARN_REPORT',
      'API_DB_USER',
      'API_DB_PASSWORD',
      'WORKER_DB_USER',
      'WORKER_DB_PASSWORD',
    ]);
    const unknown = [...set].filter((name) => !known.has(name));
    expect(unknown).toEqual([]);
  });
});

describe('the API task definition', () => {
  const api = taskDefinition({}, 'labconnect-uat-api');

  it('is a deployed UAT process that may run the fake payment gateway', () => {
    expect(api.env.get('NODE_ENV')).toBe('production');
    expect(api.env.get('APP_ENV')).toBe('uat');
    expect(api.env.get('PAYMENT_GATEWAY')).toBe('fake');
    expect(api.env.get('PORT')).toBe('3001');
  });

  it('trusts exactly one proxy: the load balancer (OQ-89)', () => {
    expect(api.env.get('API_TRUST_PROXY_HOPS')).toBe('1');
  });

  it('gets its database login, identity secrets and payment keys from Secrets Manager', () => {
    for (const name of [
      'API_DATABASE_URL',
      'AUTH_JWT_PRIVATE_KEY',
      'AUTH_HASH_SECRET',
      'AUTH_ENCRYPTION_KEY',
      'PAYMENT_PAYLOAD_ENCRYPTION_KEY',
      'PAYMENT_FAKE_WEBHOOK_SECRET',
    ]) {
      expect(api.secrets.has(name), name).toBe(true);
    }
  });

  it('keeps worker-only configuration away from the API', () => {
    for (const name of [
      'WORKER_DATABASE_URL',
      'DATABASE_URL',
      'FILES_SCANNER',
      'EMAIL_TRANSPORT',
      'SES_FROM_ADDRESS',
      'NOTIFICATIONS_CONTEXT_SOURCE',
      'WEB_BASE_URL',
      ...Object.values(QUEUE_NAMES).map(queueUrlVariable),
    ]) {
      expect(api.names.has(name), name).toBe(false);
    }
  });

  it('puts no secret into a plain environment variable', () => {
    const secretNames = /SECRET|PASSWORD|PRIVATE_KEY|ENCRYPTION_KEY|DATABASE_URL/;
    for (const name of api.env.keys()) {
      if (name === 'AUTH_JWT_KEY_ID') continue;
      expect(secretNames.test(name), name).toBe(false);
    }
  });

  it('listens on 3001 and is checked at /v1/health', () => {
    expect(api.container.PortMappings?.[0]?.ContainerPort).toBe(3001);
    expect(api.container.HealthCheck?.Command.join(' ')).toContain('/v1/health');
  });

  it('allows the web origin to refresh sessions', () => {
    expect(JSON.stringify(api.env.get('AUTH_ALLOWED_ORIGINS'))).toContain('http://');
    const withDomain = taskDefinition(
      {
        domainName: 'uat.labconnect.example',
        hostedZoneId: 'Z1',
        hostedZoneName: 'labconnect.example',
      },
      'labconnect-uat-api',
    );
    expect(withDomain.env.get('AUTH_ALLOWED_ORIGINS')).toBe('https://uat.labconnect.example');
  });
});

describe('the worker task definition', () => {
  const worker = taskDefinition({}, 'labconnect-uat-worker');

  it('is a deployed UAT process', () => {
    expect(worker.env.get('NODE_ENV')).toBe('production');
    expect(worker.env.get('APP_ENV')).toBe('uat');
    expect(worker.env.get('PAYMENT_GATEWAY')).toBe('fake');
  });

  it('gets all five queue URLs under the variable names the code reads', () => {
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(worker.env.has(queueUrlVariable(name)), name).toBe(true);
    }
    expect(worker.env.has('QUEUE_URL_LC_FILES')).toBe(true);
    expect(worker.env.has('QUEUE_URL_LC_NOTIFICATIONS_FIFO')).toBe(true);
  });

  it('trusts GuardDuty results only, sends mail through SES, and consumes the notification queue', () => {
    expect(worker.env.get('FILES_SCANNER')).toBe('guardduty');
    expect(worker.env.get('EMAIL_TRANSPORT')).toBe('ses');
    expect(worker.env.get('NOTIFICATIONS_CONTEXT_SOURCE')).toBe('booking');
    expect(worker.env.get('SES_CONFIGURATION_SET')).toBe('labconnect-uat');
    expect(worker.env.has('WEB_BASE_URL')).toBe(true);
    expect(worker.env.has('SES_FROM_ADDRESS')).toBe(true);
    expect(worker.env.has('FILES_KMS_KEY_ID')).toBe(true);
    expect(worker.env.has('FILES_DEV_AUTO_SCAN')).toBe(false);
  });

  it('connects to the database as the worker login and has no identity secrets', () => {
    expect(worker.secrets.has('WORKER_DATABASE_URL')).toBe(true);
    for (const name of [
      'API_DATABASE_URL',
      'DATABASE_URL',
      'AUTH_JWT_PRIVATE_KEY',
      'AUTH_HASH_SECRET',
      'AUTH_ENCRYPTION_KEY',
    ]) {
      expect(worker.names.has(name), name).toBe(false);
    }
    expect(worker.secrets.has('PAYMENT_PAYLOAD_ENCRYPTION_KEY')).toBe(true);
  });

  it('has no port and no health check (there is nothing to call)', () => {
    expect(worker.container.PortMappings).toBeUndefined();
    expect(worker.container.HealthCheck).toBeUndefined();
  });
});

describe('the migration task definition', () => {
  const migrate = taskDefinition({}, 'labconnect-uat-migrate');

  it('runs migrate, creates the login users, seeds reference data, in that order and stopping on failure', () => {
    const script = (migrate.container.Command ?? []).join(' ');
    expect(script).toMatch(
      /^sh -c set -e; .*prisma migrate deploy; node create-login-users\.mjs; node dist\/seed\/cli\.js reference$/,
    );
  });

  it('connects as the schema owner and holds the two login passwords, nothing else secret', () => {
    expect([...migrate.secrets.keys()].sort()).toEqual([
      'API_DB_PASSWORD',
      'API_DB_USER',
      'DATABASE_URL',
      'WORKER_DB_PASSWORD',
      'WORKER_DB_USER',
    ]);
    expect(migrate.env.get('APP_ENV')).toBe('uat');
  });

  it('has a task role with no policy of its own', () => {
    const { templates } = synthesise();
    const policies = JSON.stringify(
      resourcesOfType(templates.compute, 'AWS::IAM::Policy').map(([, p]) => p.Properties.Roles),
    );
    expect(policies).not.toContain('migrateTaskRole');
  });
});

describe('with OpenSearch', () => {
  it('gives both processes the URL and basic-auth login; none without it', () => {
    for (const service of ['api', 'worker']) {
      const withSearch = taskDefinition(OPEN_SEARCH, `labconnect-uat-${service}`);
      expect(withSearch.env.get('OPENSEARCH_AUTH_MODE')).toBe('basic');
      expect(withSearch.env.has('OPENSEARCH_URL')).toBe(true);
      expect(withSearch.secrets.has('OPENSEARCH_USERNAME')).toBe(true);
      expect(withSearch.secrets.has('OPENSEARCH_PASSWORD')).toBe(true);
      const without = taskDefinition({}, `labconnect-uat-${service}`);
      expect(without.names.has('OPENSEARCH_URL')).toBe(false);
    }
  });
});
