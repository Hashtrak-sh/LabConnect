import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { actionsOf, statementsOfRole, synthesise } from './helpers.js';

/**
 * Invariants of .github/workflows/deploy-uat.yml, checked on its text. The infrastructure
 * package has no YAML parser (and must not gain a dependency for this), so these are
 * line-based: the workflow is written in the plain block style the helpers below read, and
 * a failure to read it (an unexpected shape) fails the test rather than passing silently.
 */
const WORKFLOW_PATH = fileURLToPath(
  new URL('../../.github/workflows/deploy-uat.yml', import.meta.url),
);
const CLI = fileURLToPath(new URL('../scripts/deploy/cli.mjs', import.meta.url));
const text = readFileSync(WORKFLOW_PATH, 'utf8');
/** The lines without comment-only lines. */
const lines = text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line));
const indentOf = (line: string): number => /^ */.exec(line)?.[0].length ?? 0;

/** The lines under `key:` at the given indentation, up to the next line at that indentation or less. */
function blockOf(source: string[], key: string, indent: number): string[] {
  const start = source.findIndex((line) => line === `${' '.repeat(indent)}${key}:`);
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of source.slice(start + 1)) {
    if (line.trim() !== '' && indentOf(line) <= indent) break;
    if (line.trim() !== '') out.push(line);
  }
  return out;
}
/** The names of the entries directly under a block (`  name:` lines at its first indentation). */
function childKeys(block: string[]): string[] {
  const first = block.find((line) => line.trim() !== '');
  if (first === undefined) return [];
  const indent = indentOf(first);
  return block
    .filter((line) => indentOf(line) === indent && /^\s*[A-Za-z_][\w-]*:/.test(line))
    .map((line) => /^\s*([A-Za-z_][\w-]*):/.exec(line)?.[1] ?? '');
}

const jobsBlock = blockOf(lines, 'jobs', 0);
const jobNames = childKeys(jobsBlock);
const jobBlock = (name: string): string[] => blockOf(jobsBlock, name, 2);

/** The body of every `run:` step, as one string each (a block scalar or a single line). */
function runScripts(): string[] {
  const scripts: string[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (!match) return;
    const indent = (match[1] ?? '').length;
    const rest = match[2] ?? '';
    if (rest !== '|' && rest !== '>' && rest !== '|-') {
      scripts.push(rest);
      return;
    }
    const body: string[] = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== '' && indentOf(next) <= indent) break;
      body.push(next);
    }
    scripts.push(body.join('\n'));
  });
  return scripts;
}

describe('deploy-uat.yml shape', () => {
  it('was read: it has a deploy job with steps and scripts', () => {
    expect(jobNames).toEqual(['deploy']);
    expect(runScripts().length).toBeGreaterThanOrEqual(6);
    expect(blockOf(jobBlock('deploy'), 'steps', 4).length).toBeGreaterThan(20);
  });

  it('is triggered by a push to main and by hand, and by nothing else', () => {
    const on = blockOf(lines, 'on', 0);
    expect(childKeys(on)).toEqual(['push', 'workflow_dispatch']);
    const branches = blockOf(on, 'push', 2).filter((line) => line.trim() !== '');
    expect(branches.map((line) => line.trim())).toEqual(['branches: [main]']);
    // Nothing after `workflow_dispatch:` (no inputs: nothing from a person reaches a script).
    expect(blockOf(on, 'workflow_dispatch', 2).filter((line) => line.trim() !== '')).toEqual([]);
    expect(text).not.toMatch(/pull_request/);
    expect(text).not.toMatch(
      /\bschedule:|workflow_run|repository_dispatch|issue_comment|\bpull_request_target/,
    );
    expect(text).not.toMatch(/github\.event\.(inputs|head_commit|pull_request|issue|comment)/);
  });

  it('runs on main only, and only when a person enabled it (every job)', () => {
    for (const name of jobNames) {
      const gate = jobBlock(name).find((line) => /^ {4}if:/.test(line));
      expect(gate, `job ${name} has no if:`).toBeDefined();
      expect(gate).toContain("vars.UAT_DEPLOY_ENABLED == 'true'");
      expect(gate).toContain("github.ref == 'refs/heads/main'");
    }
  });

  it('can read the contents only, except that the deploy job also gets an OIDC token', () => {
    const top = blockOf(lines, 'permissions', 0).map((line) => line.trim());
    expect(top).toEqual(['contents: read']);
    for (const name of jobNames) {
      const own = blockOf(jobBlock(name), 'permissions', 4).map((line) => line.trim());
      expect(own).toEqual(['contents: read', 'id-token: write']);
    }
    expect(text.match(/id-token:/g)).toHaveLength(1);
    expect(text).not.toMatch(
      /(write-all|contents: write|packages: write|actions: write|pull-requests: write)/,
    );
  });

  it('deploys in the uat environment, one at a time, and never cancels a deployment half way', () => {
    for (const name of jobNames) {
      expect(jobBlock(name)).toContain('    environment: uat');
    }
    expect(text).not.toMatch(/environment:\s*(?!uat\s*$)\S/m);
    expect(blockOf(lines, 'concurrency', 0).map((line) => line.trim())).toEqual([
      'group: deploy-uat',
      'cancel-in-progress: false',
    ]);
  });

  it('pins every action to a full commit SHA, and uses only the two it needs', () => {
    const uses = lines
      .map((line) => /^\s*(?:- )?uses:\s*(\S+)/.exec(line)?.[1])
      .filter((value): value is string => value !== undefined);
    expect(uses.length).toBeGreaterThan(0);
    for (const reference of uses) expect(reference).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(uses.map((reference) => reference.split('@')[0]).sort()).toEqual([
      'actions/checkout',
      'aws-actions/configure-aws-credentials',
    ]);
    // The version is written next to the SHA.
    for (const line of lines.filter((l) => /^\s*(?:- )?uses:/.test(l))) {
      expect(line).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    }
  });

  it('never puts an expression inside a script, and always fails on the first error', () => {
    for (const script of runScripts()) {
      expect(script).not.toContain('${{');
    }
    for (const script of runScripts().filter((s) => s.includes('\n'))) {
      expect(script.trimStart().startsWith('set -euo pipefail')).toBe(true);
    }
  });

  it('keeps the checkout from leaving credentials behind', () => {
    expect(text).toMatch(/persist-credentials: false/);
  });

  it('has no secrets, no production, and no infrastructure deployment', () => {
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/production|\bprod\b/i);
    for (const script of runScripts()) {
      expect(script).not.toMatch(/\bcdk\b/i);
      expect(script).not.toMatch(
        /cloudformation\s+(deploy|create-stack|update-stack|delete-stack|execute-change-set|create-change-set)/,
      );
      expect(script).not.toMatch(/\baws\s+iam\b|\baws\s+sts\s+assume-role/);
      expect(script).not.toMatch(/\bpnpm\b|\bnpm\b|\bnpx\b/);
    }
  });

  it('reads only the variables that are documented', () => {
    const variables = [...text.matchAll(/vars\.([A-Z_]+)/g)].map((m) => m[1]);
    expect(new Set(variables)).toEqual(
      new Set(['UAT_DEPLOY_ENABLED', 'AWS_UAT_DEPLOY_ROLE_ARN', 'AWS_REGION', 'UAT_API_BASE_URL']),
    );
    expect(new Set([...text.matchAll(/\$\{\{\s*([\w.]+)/g)].map((m) => m[1]))).toEqual(
      new Set([
        'github.sha',
        'vars.AWS_REGION',
        'vars.AWS_UAT_DEPLOY_ROLE_ARN',
        'vars.UAT_API_BASE_URL',
        'job.status',
      ]),
    );
  });

  it('stops the deployment of the services when the migration failed (the migration is its own earlier step)', () => {
    const steps = [...text.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1]);
    const migration = steps.indexOf('Run the database migration');
    const services = steps.indexOf('Deploy the api and worker services');
    expect(migration).toBeGreaterThan(-1);
    expect(services).toBeGreaterThan(migration);
    // No step before the last has `if:` or `continue-on-error`, so a failed step ends the job.
    expect(text).not.toMatch(/continue-on-error/);
    expect(lines.filter((line) => /^ {8}if:/.test(line))).toEqual(['        if: always()']);
  });

  it('passes the new task definition and the service to the rollout check', () => {
    const script = runScripts().find((s) => s.includes('update-service')) ?? '';
    expect(script).toContain('services-stable');
    expect(script).toMatch(/rollout-result --service "\$family" --task-definition "\$new_arn"/);
    const migration = runScripts().find((s) => s.includes('run-task')) ?? '';
    expect(migration).toContain('assignPublicIp=DISABLED');
    expect(migration).toContain('migration-result');
    expect(migration).toContain('tasks-stopped');
  });
});

describe('deploy-uat.yml and its scripts', () => {
  const scripts = runScripts().join('\n');

  it('calls only commands the command line has', () => {
    const commands = [...scripts.matchAll(/"\$DEPLOY_SCRIPT" ([a-z-]+)/g)].map((m) => m[1] ?? '');
    expect(commands.length).toBeGreaterThan(5);
    for (const command of new Set(commands)) {
      const result = spawnSync(process.execPath, [CLI, command], { input: '', encoding: 'utf8' });
      expect(result.stderr, command).not.toContain('Unknown command');
    }
  });
});

describe('deploy-uat.yml and the permissions of the uat-deployer role', () => {
  /** The IAM actions each AWS CLI call or waiter of the workflow needs. A new call must be added here, and to the role, on purpose. */
  const NEEDS: Record<string, string[]> = {
    'cloudformation describe-stacks': ['cloudformation:DescribeStacks'],
    'sts get-caller-identity': [],
    'ecr get-login-password': ['ecr:GetAuthorizationToken'],
    'ecr batch-get-image': ['ecr:BatchGetImage'],
    'ecs describe-task-definition': ['ecs:DescribeTaskDefinition'],
    'ecs register-task-definition': ['ecs:RegisterTaskDefinition', 'iam:PassRole'],
    'ecs run-task': ['ecs:RunTask', 'iam:PassRole'],
    'ecs wait tasks-stopped': ['ecs:DescribeTasks'],
    'ecs describe-tasks': ['ecs:DescribeTasks'],
    'ecs update-service': ['ecs:UpdateService'],
    'ecs wait services-stable': ['ecs:DescribeServices'],
    'ecs describe-services': ['ecs:DescribeServices'],
  };
  const calls = [
    ...runScripts()
      .join('\n')
      .matchAll(/\baws (\w+) (wait \S+|[a-z-]+)/g),
  ].map((m) => `${m[1] ?? ''} ${m[2] ?? ''}`);

  it('uses only AWS calls this test knows', () => {
    expect(calls.length).toBeGreaterThan(8);
    for (const call of new Set(calls)) expect(Object.keys(NEEDS), call).toContain(call);
  });

  it('is allowed every one of them by the role, and the push needs the image actions', () => {
    const granted = new Set(
      statementsOfRole(synthesise().templates.delivery, 'uat-deployer').flatMap(actionsOf),
    );
    for (const call of new Set(calls)) {
      for (const action of NEEDS[call] ?? [])
        expect(granted.has(action), `${call}: ${action}`).toBe(true);
    }
    for (const action of [
      'ecr:InitiateLayerUpload',
      'ecr:UploadLayerPart',
      'ecr:CompleteLayerUpload',
      'ecr:PutImage',
    ]) {
      expect(granted.has(action), action).toBe(true);
    }
    expect(scripts()).toContain('docker push');
  });

  function scripts(): string {
    return runScripts().join('\n');
  }
});
