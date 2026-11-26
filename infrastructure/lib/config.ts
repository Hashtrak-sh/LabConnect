/**
 * Deployment parameters. Everything that differs between environments or belongs to the
 * organisation (account, domain, e-mail addresses, sizing) is read here from CDK context
 * (`cdk synth -c key=value`, or `cdk.context.json`) and never written into the code.
 * Nothing in this file is a real account, domain or address.
 */
import { RETENTION_DAYS } from './retention.js';

/** The environments the code knows. Production is deliberately not here (see `assertStage`). */
export const KNOWN_STAGES = ['uat'] as const;
export type Stage = (typeof KNOWN_STAGES)[number];

/** docs/07-operations/AWS_ENVIRONMENTS_AND_DEPLOYMENT.md section 1: UAT runs in ap-south-1. */
export const DEFAULT_REGION = 'ap-south-1';

/** The repository whose workflows may assume the deploy role (CI_CD.md, GIT_WORKFLOW.md). */
export const DEFAULT_GITHUB_REPOSITORY = 'Hashtrak-sh/LabConnect';

export interface InfraConfig {
  stage: Stage;
  /** Prefix of resource names, for example `labconnect-uat`. */
  prefix: string;
  /** Unset while the account is not known: the stacks are then environment-agnostic and still synthesise. */
  account: string | undefined;
  region: string;
  /** Base domain of the web app, for example `uat.labconnect.example`. The API is `api.<domainName>`. */
  domainName: string | undefined;
  hostedZoneId: string | undefined;
  hostedZoneName: string | undefined;
  /** CIDRs allowed to reach the load balancer. Required while there is no domain (plain HTTP). */
  ingressCidrs: string[];
  alarmEmail: string | undefined;
  /** Sender of every e-mail, `Name <address>`. */
  sesFromAddress: string;
  apiImageTag: string;
  workerImageTag: string;
  migrateImageTag: string;
  githubRepository: string;
  /** Reuse an OIDC provider that already exists in the account (one per URL is allowed). */
  githubOidcProviderArn: string | undefined;
  azCount: number;
  natGateways: number;
  dbInstanceClass: string;
  dbAllocatedStorageGiB: number;
  apiDesiredCount: number;
  workerDesiredCount: number;
  apiCpu: number;
  apiMemoryMiB: number;
  workerCpu: number;
  workerMemoryMiB: number;
  logRetentionDays: number;
  enableOpenSearch: boolean;
  /** Monthly budget in USD for the AWS Budgets alert; unset means no budget is created. */
  budgetMonthlyUsd: number | undefined;
  /**
   * Demo one-time code for the API (UAT demonstrations only), six digits. Unset (the default)
   * sets nothing. See "Demo one-time codes" in infrastructure/README.md.
   */
  demoOtpCode: string | undefined;
}

/** The domain of the demo accounts: the demo seed's default, under a reserved top-level domain. */
export const DEMO_OTP_EMAIL_DOMAIN = 'demo.labconnect.test';

type Get = (key: string) => unknown;

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** The only place that decides which environments exist. */
export function assertStage(value: unknown): Stage {
  if (value === undefined || value === '') return 'uat';
  if (value === 'production' || value === 'prod') {
    throw new Error(
      'The production stage is not defined in this app. Production deployment is a ' +
        'human-approved step (CLAUDE.md section 5): a person must add the stage, its account ' +
        'and its sizing to infrastructure/lib/config.ts first. See infrastructure/README.md.',
    );
  }
  const known = KNOWN_STAGES.find((stage) => stage === value);
  if (known !== undefined) return known;
  const shown = typeof value === 'string' ? value : typeof value;
  throw new Error(`Unknown stage "${shown}". Known stages: ${KNOWN_STAGES.join(', ')}.`);
}

function text(get: Get, key: string): string | undefined {
  const value = get(key);
  // CDK context from the command line is a string; a number or boolean can come from cdk.json.
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
}

function integer(get: Get, key: string, fallback: number, min: number, max: number): number {
  const raw = text(get, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(
      `Context "${key}" must be an integer from ${String(min)} to ${String(max)}.`,
    );
  }
  return value;
}

function flag(get: Get, key: string, fallback: boolean): boolean {
  const raw = text(get, key);
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new RangeError(`Context "${key}" must be true or false.`);
}

function retentionDays(get: Get): number {
  const value = integer(get, 'logRetentionDays', 30, 1, 3653);
  if (!RETENTION_DAYS.includes(value)) {
    throw new RangeError(`Context "logRetentionDays" must be one of ${RETENTION_DAYS.join(', ')}.`);
  }
  return value;
}

/** The domain part of `Name <user@host>` or `user@host`. */
export function senderParts(from: string): { address: string; domain: string } {
  const match = /<([^>]+)>\s*$/.exec(from);
  const address = (match?.[1] ?? from).trim();
  if (!EMAIL.test(address)) throw new RangeError('sesFromAddress must contain one e-mail address.');
  return { address, domain: address.slice(address.indexOf('@') + 1) };
}

export function loadConfig(get: Get): InfraConfig {
  const stage = assertStage(get('stage'));
  const domainName = text(get, 'domainName')?.toLowerCase();
  if (domainName !== undefined && !DOMAIN.test(domainName)) {
    throw new RangeError('Context "domainName" must be a DNS name such as uat.labconnect.example.');
  }
  const hostedZoneId = text(get, 'hostedZoneId');
  const hostedZoneName = text(get, 'hostedZoneName')?.toLowerCase();
  if (hostedZoneId !== undefined && domainName === undefined) {
    throw new RangeError('Context "hostedZoneId" needs "domainName".');
  }
  if (hostedZoneId !== undefined && hostedZoneName === undefined) {
    throw new RangeError('Context "hostedZoneId" needs "hostedZoneName" (the zone\'s DNS name).');
  }
  const account = text(get, 'account');
  if (account !== undefined && !/^\d{12}$/.test(account)) {
    throw new RangeError('Context "account" must be a 12-digit AWS account id.');
  }
  const region = text(get, 'region') ?? DEFAULT_REGION;
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) {
    throw new RangeError('Context "region" must look like ap-south-1.');
  }
  const alarmEmail = text(get, 'alarmEmail');
  if (alarmEmail !== undefined && !EMAIL.test(alarmEmail)) {
    throw new RangeError('Context "alarmEmail" must be an e-mail address.');
  }
  const ingressCidrs = (text(get, 'ingressCidrs') ?? '')
    .split(',')
    .map((cidr) => cidr.trim())
    .filter((cidr) => cidr !== '');
  for (const cidr of ingressCidrs) {
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr) || cidr.endsWith('/0')) {
      throw new RangeError(`ingressCidrs: "${cidr}" is not an IPv4 CIDR narrower than /1.`);
    }
  }
  // A placeholder in the reserved ".invalid" domain (RFC 2606): mail to or from it can never
  // work, so a forgotten value fails loudly at the first send instead of using a real domain.
  const sesFromAddress =
    text(get, 'sesFromAddress') ??
    (domainName === undefined
      ? 'LabConnect <no-reply@labconnect.invalid>'
      : `LabConnect <no-reply@${domainName}>`);
  senderParts(sesFromAddress);
  const demoOtpCode = text(get, 'demoOtpCode');
  if (demoOtpCode !== undefined && !/^\d{6}$/.test(demoOtpCode)) {
    // Never repeats the value.
    throw new RangeError('Context "demoOtpCode" must be exactly six digits.');
  }
  const imageTag = text(get, 'imageTag') ?? 'bootstrap';
  const budget = text(get, 'budgetMonthlyUsd');
  return {
    stage,
    prefix: `labconnect-${stage}`,
    account,
    region,
    domainName,
    hostedZoneId,
    hostedZoneName,
    ingressCidrs,
    alarmEmail,
    sesFromAddress,
    apiImageTag: text(get, 'apiImageTag') ?? imageTag,
    workerImageTag: text(get, 'workerImageTag') ?? imageTag,
    migrateImageTag: text(get, 'migrateImageTag') ?? imageTag,
    githubRepository: text(get, 'githubRepository') ?? DEFAULT_GITHUB_REPOSITORY,
    githubOidcProviderArn: text(get, 'githubOidcProviderArn'),
    azCount: integer(get, 'azCount', 2, 2, 3),
    natGateways: integer(get, 'natGateways', 1, 1, 3),
    dbInstanceClass: text(get, 'dbInstanceClass') ?? 'db.t4g.medium',
    dbAllocatedStorageGiB: integer(get, 'dbAllocatedStorageGiB', 50, 20, 65536),
    apiDesiredCount: integer(get, 'apiDesiredCount', 1, 0, 10),
    workerDesiredCount: integer(get, 'workerDesiredCount', 1, 0, 10),
    apiCpu: integer(get, 'apiCpu', 512, 256, 4096),
    apiMemoryMiB: integer(get, 'apiMemoryMiB', 1024, 512, 30720),
    workerCpu: integer(get, 'workerCpu', 512, 256, 4096),
    workerMemoryMiB: integer(get, 'workerMemoryMiB', 1024, 512, 30720),
    logRetentionDays: retentionDays(get),
    enableOpenSearch: flag(get, 'enableOpenSearch', false),
    budgetMonthlyUsd:
      budget === undefined ? undefined : integer(get, 'budgetMonthlyUsd', 0, 1, 1_000_000),
    demoOtpCode,
  };
}

/** The public origin of the API. Without a domain the caller passes the load balancer's name. */
export function apiHost(config: InfraConfig): string | undefined {
  return config.domainName === undefined ? undefined : `api.${config.domainName}`;
}
