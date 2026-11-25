import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES } from '../lib/names.js';
import { LOG_SIGNALS } from '../lib/stacks/observability-stack.js';
import { WITH_DOMAIN, resourcesOfType, synthesise } from './helpers.js';

const { templates } = synthesise();
const source = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

/** What a CloudWatch Logs filter pattern means for plain text: `"a phrase"` or `%regex%`. */
function matcher(pattern: string): RegExp {
  if (pattern.startsWith('%') && pattern.endsWith('%')) return new RegExp(pattern.slice(1, -1));
  const phrase = /^"(.*)"$/.exec(pattern)?.[1];
  if (phrase === undefined) throw new Error(`Unexpected pattern ${pattern}`);
  return new RegExp(phrase.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
}

describe('log signals follow the worker source', () => {
  const jobs = source('apps/worker/src/modules/platform/platform-jobs.ts');
  const runner = source('apps/worker/src/modules/platform/polling-runner.ts');

  it('finds the exact phrases in the code that writes them', () => {
    expect(jobs).toContain('BROKEN at seq');
    expect(jobs).toContain('rows unsealed for over an hour');
    expect(jobs).toContain('timers gave up (FAILED)');
    expect(jobs).toContain(
      'outbox relay: ${String(published)} published, ${String(failed)} failed',
    );
    expect(runner).toContain('Job ${job.name} failed:');
  });

  it('matches the lines as the worker writes them and ignores the harmless ones', () => {
    const lines = {
      auditChainBroken: ['audit chain 2026-11 BROKEN at seq 41 (SEAL_BROKEN), audit row 0192'],
      auditUnsealed: ['audit chain 2026-11: 3 rows unsealed for over an hour'],
      outboxFailures: [
        'outbox relay: 10 published, 2 failed',
        'outbox relay: 0 published, 7 failed',
      ],
      timersFailed: ['timers: 2 timers gave up (FAILED)'],
      jobFailed: ['Job outbox-relay failed: Error: boom', 'Job audit-verify failed: x'],
    } as const;
    for (const [key, hits] of Object.entries(lines)) {
      const signal = LOG_SIGNALS[key as keyof typeof LOG_SIGNALS];
      for (const line of hits)
        expect(matcher(signal.pattern).test(line), `${key}: ${line}`).toBe(true);
    }
    const quiet = [
      'outbox relay: 10 published, 0 failed',
      'audit verification: 3 chains match their audit rows',
      'timers: 4 fired, 0 to retry, 0 failed',
      'audit seal: 12 rows sealed',
    ];
    for (const signal of Object.values(LOG_SIGNALS)) {
      for (const line of quiet) expect(matcher(signal.pattern).test(line), line).toBe(false);
    }
  });
});

describe('alarms', () => {
  const alarms = resourcesOfType(templates.observability, 'AWS::CloudWatch::Alarm').map(
    ([, a]) => a.Properties,
  );
  const names = alarms.map((a) => a.AlarmName as string);

  it('sends every alarm to the encrypted SNS topic, and recoveries too', () => {
    for (const alarm of alarms) {
      expect(alarm.AlarmActions, String(alarm.AlarmName)).toHaveLength(1);
      expect(alarm.OKActions, String(alarm.AlarmName)).toHaveLength(1);
    }
    templates.observability.hasResourceProperties('AWS::SNS::Topic', {
      KmsMasterKeyId: Match.anyValue(),
    });
  });

  it.each(Object.keys(QUEUE_NAMES))('alarms on any message in the %s dead-letter queue', (key) => {
    expect(names).toContain(`labconnect-uat-Dlq-${key}`);
  });

  it('has the alarms the documents call for', () => {
    for (const name of [
      'Api5xxRate',
      'ApiTasksRunning',
      'WorkerTasksRunning',
      'DbCpu',
      'DbFreeStorage',
      'DbFreeMemory',
      'AuditChainBroken',
      'AuditRowsUnsealed',
      'OutboxRelayFailures',
      'TimersGaveUp',
      'WorkerJobFailed',
      'FilesQueueAge',
      'GuardDutyDeliveryFailures',
      'SesBounceRate',
      'SesComplaintRate',
    ]) {
      expect(names, name).toContain(`labconnect-uat-${name}`);
    }
  });

  it('has the 20 alarms the documentation of this task lists', () => {
    expect(alarms).toHaveLength(20);
  });

  it('alarms on an audit chain break at the first occurrence', () => {
    templates.observability.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'labconnect-uat-AuditChainBroken',
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      EvaluationPeriods: 1,
    });
  });

  it('alarms on the API 5xx rate above 2 percent, ignoring quiet periods', () => {
    const alarm = alarms.find((a) => a.AlarmName === 'labconnect-uat-Api5xxRate');
    expect(alarm?.Threshold).toBe(2);
    expect(JSON.stringify(alarm?.Metrics)).toContain(
      'IF(requests >= 10, 100 * errors / requests, 0)',
    );
  });

  it('filters the worker log group for each signal', () => {
    const filters = resourcesOfType(templates.observability, 'AWS::Logs::MetricFilter').map(
      ([, f]) => f.Properties,
    );
    expect(filters).toHaveLength(Object.keys(LOG_SIGNALS).length);
    for (const signal of Object.values(LOG_SIGNALS)) {
      expect(
        filters.some((f) => f.FilterPattern === signal.pattern),
        signal.name,
      ).toBe(true);
    }
    for (const filter of filters) {
      expect(filter.LogGroupName).toBeDefined();
      expect(JSON.stringify(filter.MetricTransformations)).toContain('LabConnect/Worker');
    }
  });

  it('subscribes the alarm e-mail address when there is one, and nobody otherwise', () => {
    templates.observability.resourceCountIs('AWS::SNS::Subscription', 0);
    synthesise(WITH_DOMAIN).templates.observability.hasResourceProperties(
      'AWS::SNS::Subscription',
      {
        Protocol: 'email',
        Endpoint: 'alerts@labconnect.example',
      },
    );
  });

  it('adds a budget only when one is asked for', () => {
    templates.observability.resourceCountIs('AWS::Budgets::Budget', 0);
    synthesise({
      ...WITH_DOMAIN,
      budgetMonthlyUsd: '500',
    }).templates.observability.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 500, Unit: 'USD' } }),
    });
  });
});

describe('log groups', () => {
  it('keep their logs for the configured time and survive a stack deletion', () => {
    const groups = resourcesOfType(templates.compute, 'AWS::Logs::LogGroup');
    expect(groups.map(([, g]) => g.Properties.LogGroupName).sort()).toEqual([
      '/labconnect/uat/api',
      '/labconnect/uat/migrate',
      '/labconnect/uat/worker',
    ]);
    for (const [, group] of groups) expect(group.Properties.RetentionInDays).toBe(30);
    templates.compute.hasResource('AWS::Logs::LogGroup', { DeletionPolicy: 'Retain' });
    synthesise({ logRetentionDays: '90' }).templates.compute.hasResourceProperties(
      'AWS::Logs::LogGroup',
      { LogGroupName: '/labconnect/uat/worker', RetentionInDays: 90 },
    );
  });
});
