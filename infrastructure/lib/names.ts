import type { InfraConfig } from './config.js';

/** The five queues of AUDIT_AND_EVENT_ARCHITECTURE.md section 3 (the names `packages/core` uses). */
export const QUEUE_NAMES = {
  notifications: 'lc-notifications.fifo',
  searchSync: 'lc-search-sync',
  files: 'lc-files',
  timers: 'lc-timers',
  analytics: 'lc-analytics',
} as const;
export type QueueKey = keyof typeof QUEUE_NAMES;

/** The worker's variable for a queue URL: `QUEUE_URL_<NAME IN CAPITALS, other characters as _>`. */
export function queueUrlVariable(queueName: string): string {
  return `QUEUE_URL_${queueName.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')}`;
}

export function dlqName(queueName: string): string {
  return queueName.endsWith('.fifo')
    ? `${queueName.slice(0, -'.fifo'.length)}-dlq.fifo`
    : `${queueName}-dlq`;
}

/** Messages move to the dead-letter queue after this many receives (AUDIT_AND_EVENT_ARCHITECTURE.md section 3). */
export const MAX_RECEIVE_COUNT = 5;

export const FILES_QUARANTINE_PREFIX = 'quarantine';
export const FILES_CLEAN_PREFIX = 'clean';

export const API_PORT = 3001;
export const DATABASE_NAME = 'labconnect';
/** The RDS master user. It is also the owner of every schema object (the migration comments call it app_owner). */
export const DATABASE_OWNER_USER = 'app_owner';
/** Login users that inherit the roles the first migration creates (`app_rw`, `app_worker`). Same names as local development. */
export const DATABASE_API_USER = 'labconnect_api';
export const DATABASE_WORKER_USER = 'labconnect_worker';

export interface Names {
  secret(name: string): string;
  logGroup(service: string): string;
  clusterName: string;
  serviceName(service: string): string;
  roleName(role: string): string;
  ecrRepository(service: string): string;
  sesConfigurationSet: string;
  guardDutyRuleName: string;
  deployRoleName: string;
}

export function namesFor(config: InfraConfig): Names {
  const prefix = config.prefix;
  return {
    secret: (name) => `labconnect/${config.stage}/${name}`,
    logGroup: (service) => `/labconnect/${config.stage}/${service}`,
    clusterName: prefix,
    serviceName: (service) => `${prefix}-${service}`,
    roleName: (role) => `${prefix}-${role}`,
    ecrRepository: (service) => `labconnect/${service}`,
    sesConfigurationSet: `labconnect-${config.stage}`,
    guardDutyRuleName: 'lc-guardduty-scan-results',
    deployRoleName: `${config.stage}-deployer`,
  };
}

/** The order the stacks are deployed in; each depends on the ones before it that it uses. */
export function stackName(config: InfraConfig, part: string): string {
  return `LabConnect-${config.stage}-${part}`;
}
