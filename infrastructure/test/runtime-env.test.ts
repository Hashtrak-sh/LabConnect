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
  const plain = ['api', 'worker', 'migrate', 'web'].map((s) =>
    taskDefinition({}, `labconnect-uat-${s}`),
  );
  const withSearch = ['api', 'worker', 'migrate', 'web'].map((s) =>
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
      'NOTIFICATIONS_CONTEXT_SOURCE',
      'WEB_BASE_URL',
      ...Object.values(QUEUE_NAMES).map(queueUrlVariable),
    ]) {
      expect(api.names.has(name), name).toBe(false);
    }
  });

  it('sends the sign-in code through SES, with the same sender and configuration set as the worker, and no SMTP', () => {
    const worker = taskDefinition({}, 'labconnect-uat-worker');
    expect(api.env.get('EMAIL_TRANSPORT')).toBe('ses');
    expect(api.env.get('SES_CONFIGURATION_SET')).toBe('labconnect-uat');
    expect(api.env.has('SES_FROM_ADDRESS')).toBe(true);
    expect(api.env.get('SES_FROM_ADDRESS')).toEqual(worker.env.get('SES_FROM_ADDRESS'));
    expect(api.env.get('SES_CONFIGURATION_SET')).toEqual(worker.env.get('SES_CONFIGURATION_SET'));
    expect(api.env.get('AWS_REGION')).toBeDefined();
    expect(api.env.has('SMTP_HOST')).toBe(false);
    expect(api.env.has('SMTP_PORT')).toBe(false);
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

describe('the web task definition', () => {
  const web = taskDefinition({}, 'labconnect-uat-web');

  it('reads exactly the variables the web app and its server read, all in .env.example', () => {
    expect([...web.names].sort()).toEqual(['API_BASE_URL', 'NODE_ENV', 'PORT']);
    for (const name of web.names) expect(envExampleKeys(), name).toContain(name);
  });

  it('points the web server at the API by its private name, with the /v1 prefix and the API port', () => {
    expect(web.env.get('API_BASE_URL')).toBe('http://api.labconnect-uat.internal:3001/v1');
    expect(web.env.get('PORT')).toBe('3000');
  });

  it('holds no secret, no database URL, no AWS setting, nothing of the API, worker or migration task', () => {
    expect(web.secrets.size).toBe(0);
    const other = new Set(
      ['api', 'worker', 'migrate'].flatMap((s) => [
        ...taskDefinition({}, `labconnect-uat-${s}`).names,
      ]),
    );
    // NODE_ENV and PORT are shared names with different values; everything else is the web's own.
    for (const name of web.names) {
      if (name === 'NODE_ENV' || name === 'PORT') continue;
      expect(other.has(name), name).toBe(false);
    }
    const secretNames = /SECRET|PASSWORD|PRIVATE_KEY|ENCRYPTION_KEY|DATABASE_URL|AWS_/;
    for (const name of web.names) expect(secretNames.test(name), name).toBe(false);
  });

  it('is a deployed process but sets no APP_ENV: it has no use for the fake-gateway switch', () => {
    expect(web.env.get('NODE_ENV')).toBe('production');
    expect(web.env.has('APP_ENV')).toBe(false);
  });

  it('keeps every other task definition free of the web variable', () => {
    for (const service of ['api', 'worker', 'migrate']) {
      expect(taskDefinition({}, `labconnect-uat-${service}`).names.has('API_BASE_URL')).toBe(false);
    }
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

describe('demo one-time codes (UAT demonstrations only)', () => {
  const DEMO_VARIABLES = ['DEMO_OTP_CODE', 'DEMO_OTP_EMAIL_DOMAIN'];
  const DEMO = { demoOtpCode: '444444' };

  it('is off by default: no task definition and no synthesised template mentions the variables', () => {
    for (const service of ['api', 'worker', 'migrate']) {
      const task = taskDefinition({}, `labconnect-uat-${service}`);
      for (const name of DEMO_VARIABLES) expect(task.names.has(name)).toBe(false);
    }
    const text = JSON.stringify(synthesise({}).all);
    expect(text).not.toContain('DEMO_OTP');
    expect(text).not.toContain('444444');
  });

  it('sets both variables on the API task definition when the context parameter is given', () => {
    const api = taskDefinition(DEMO, 'labconnect-uat-api');
    expect(api.env.get('DEMO_OTP_CODE')).toBe('444444');
    expect(api.env.get('DEMO_OTP_EMAIL_DOMAIN')).toBe('demo.labconnect.test');
    // The API is a UAT process, which is the only place the API accepts them.
    expect(api.env.get('APP_ENV')).toBe('uat');
    expect(api.env.get('NODE_ENV')).toBe('production');
  });

  it('never sets them on the worker, the migration task or anything else', () => {
    for (const service of ['worker', 'migrate']) {
      const task = taskDefinition(DEMO, `labconnect-uat-${service}`);
      for (const name of DEMO_VARIABLES) expect(task.names.has(name)).toBe(false);
    }
    const { templates } = synthesise(DEMO);
    for (const [name, template] of Object.entries(templates)) {
      for (const [, task] of resourcesOfType(template, 'AWS::ECS::TaskDefinition')) {
        const isApi = task.Properties.Family === 'labconnect-uat-api';
        const label = `${name} ${String(task.Properties.Family)}`;
        expect(JSON.stringify(task).includes('DEMO_OTP'), label).toBe(isApi);
      }
    }
  });

  it('is listed as not set by default, with a reason, in the allow-list', () => {
    for (const name of DEMO_VARIABLES) expect(NOT_SET_IN_UAT[name]).toMatch(/demoOtpCode/);
  });
});
