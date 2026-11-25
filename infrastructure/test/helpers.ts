import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { type LabConnectStacks, createLabConnectStacks } from '../lib/app.js';

/** The same context `cdk.json` provides. */
const BASE_CONTEXT = {
  stage: 'uat',
  '@aws-cdk/core:defaultCrossStackReferences': 'strong',
};

export interface Synthesised {
  stacks: LabConnectStacks;
  templates: {
    delivery: Template;
    network: Template;
    data: Template;
    messaging: Template;
    edge: Template;
    compute: Template;
    observability: Template;
  };
  /** Every template, as one array of parsed JSON objects. */
  all: Record<string, unknown>[];
}

const cache = new Map<string, Synthesised>();

/** Builds (and caches, since synthesis takes seconds) the whole app for a context. */
export function synthesise(context: Record<string, unknown> = {}): Synthesised {
  const key = JSON.stringify(context);
  const cached = cache.get(key);
  if (cached) return cached;
  const app = new cdk.App({ context: { ...BASE_CONTEXT, ...context } });
  const stacks = createLabConnectStacks(app);
  const templates = {
    delivery: Template.fromStack(stacks.delivery),
    network: Template.fromStack(stacks.network),
    data: Template.fromStack(stacks.data),
    messaging: Template.fromStack(stacks.messaging),
    edge: Template.fromStack(stacks.edge),
    compute: Template.fromStack(stacks.compute),
    observability: Template.fromStack(stacks.observability),
  };
  const result: Synthesised = {
    stacks,
    templates,
    all: Object.values(templates).map((template) => template.toJSON() as Record<string, unknown>),
  };
  cache.set(key, result);
  return result;
}

export const WITH_DOMAIN = {
  domainName: 'uat.labconnect.example',
  hostedZoneId: 'Z0000000000EXAMPLE',
  hostedZoneName: 'labconnect.example',
  alarmEmail: 'alerts@labconnect.example',
  account: '111111111111',
};

export interface Statement {
  Effect: string;
  Action: string | string[];
  Resource?: unknown;
  Condition?: unknown;
  Principal?: unknown;
  Sid?: string;
}

/** The policy statements attached to one role (inline `AWS::IAM::Policy` resources), by the role's physical name. */
export function statementsOfRole(template: Template, roleName: string): Statement[] {
  const json = template.toJSON() as {
    Resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;
  };
  const roleLogicalIds = Object.entries(json.Resources)
    .filter(([, r]) => r.Type === 'AWS::IAM::Role' && r.Properties.RoleName === roleName)
    .map(([id]) => id);
  const out: Statement[] = [];
  for (const resource of Object.values(json.Resources)) {
    if (resource.Type !== 'AWS::IAM::Policy') continue;
    const roles = resource.Properties.Roles as { Ref: string }[];
    if (!roles.some((role) => roleLogicalIds.includes(role.Ref))) continue;
    const document = resource.Properties.PolicyDocument as { Statement: Statement[] };
    out.push(...document.Statement);
  }
  return out;
}

export const actionsOf = (statement: Statement): string[] =>
  Array.isArray(statement.Action) ? statement.Action : [statement.Action];

export const resourcesOf = (statement: Statement): unknown[] =>
  Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];

/** The one resource of a type in a template; fails the test if there is not exactly one. */
export function single(template: Template, type: string): { Properties: Record<string, unknown> } {
  const found = resourcesOfType(template, type);
  if (found.length !== 1) throw new Error(`Expected one ${type}, found ${String(found.length)}.`);
  return (found[0] as [string, { Properties: Record<string, unknown> }])[1];
}

/** All resources of a type in a template, as `[logicalId, resource]`. */
export function resourcesOfType(
  template: Template,
  type: string,
): [string, { Properties: Record<string, unknown> }][] {
  const json = template.toJSON() as {
    Resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;
  };
  return Object.entries(json.Resources).filter(([, r]) => r.Type === type);
}
