import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { InfraConfig } from '../config.js';
import { QUEUE_NAMES, type QueueKey } from '../names.js';
import type { ComputeStack } from './compute-stack.js';
import type { DataStack } from './data-stack.js';
import type { MessagingStack } from './messaging-stack.js';

export interface ObservabilityStackProps extends cdk.StackProps {
  config: InfraConfig;
  data: DataStack;
  messaging: MessagingStack;
  compute: ComputeStack;
}

/**
 * The log lines the worker writes (apps/worker/src/modules/platform/platform-jobs.ts and
 * polling-runner.ts). They carry counts only, never contents. Each is matched as plain text,
 * so a change to one of those messages must change the pattern here: test/observability.test.ts
 * keeps both in step with the source files.
 */
export const LOG_SIGNALS = {
  /** `audit chain <month> BROKEN at seq <n> (<kind>), audit row <id>` */
  auditChainBroken: { name: 'AuditChainBroken', pattern: '"BROKEN at seq"' },
  /** `audit chain <month>: <n> rows unsealed for over an hour` */
  auditUnsealed: { name: 'AuditRowsUnsealed', pattern: '"rows unsealed for over an hour"' },
  /** `outbox relay: <n> published, <m> failed`: only when m is not 0. OQ-66: rows past 50 attempts stay parked. */
  outboxFailures: {
    name: 'OutboxRelayFailures',
    pattern: '%outbox relay: [0-9]+ published, [1-9][0-9]* failed%',
  },
  /** `timers: <n> timers gave up (FAILED)` (OQ-83) */
  timersFailed: { name: 'TimersGaveUp', pattern: '"timers gave up (FAILED)"' },
  /** `Job <name> failed: <error>` */
  jobFailed: { name: 'WorkerJobFailed', pattern: '%Job [a-z-]+ failed:%' },
} as const;

/**
 * Observability (OBSERVABILITY.md section 3, "Alerts (initial)"): one SNS topic, and alarms
 * on the signals the code can already produce. Several alerts in that table need a metric
 * the application does not emit yet (outbox lag, timer backlog, stuck bookings, webhook
 * signature failures); they are listed in the "As built" section, not faked here.
 */
export class ObservabilityStack extends cdk.Stack {
  readonly alarmTopic: sns.Topic;
  readonly alarms: cloudwatch.Alarm[] = [];

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { config, data, messaging, compute } = props;

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${config.prefix}-alarms`,
      displayName: 'LabConnect UAT alarms',
      masterKey: messaging.messagingKey,
      enforceSSL: true,
    });
    if (config.alarmEmail !== undefined) {
      // The address has to confirm the subscription from the e-mail AWS sends.
      this.alarmTopic.addSubscription(new subscriptions.EmailSubscription(config.alarmEmail));
    }
    const action = new cwActions.SnsAction(this.alarmTopic);

    const alarm = (
      id: string,
      metric: cloudwatch.IMetric,
      options: {
        description: string;
        threshold: number;
        comparison?: cloudwatch.ComparisonOperator;
        evaluationPeriods?: number;
        missing?: cloudwatch.TreatMissingData;
      },
    ): cloudwatch.Alarm => {
      const created = new cloudwatch.Alarm(this, id, {
        alarmName: `${config.prefix}-${id}`,
        alarmDescription: options.description,
        metric,
        threshold: options.threshold,
        comparisonOperator:
          options.comparison ?? cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: options.evaluationPeriods ?? 1,
        treatMissingData: options.missing ?? cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      created.addAlarmAction(action);
      created.addOkAction(action);
      this.alarms.push(created);
      return created;
    };
    const five = cdk.Duration.minutes(5);

    // ---- queues: any message in a dead-letter queue (Medium), stuck scan results
    for (const key of Object.keys(QUEUE_NAMES) as QueueKey[]) {
      const pair = messaging.queues[key];
      alarm(
        `Dlq-${key}`,
        pair.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
          period: five,
          statistic: 'Maximum',
        }),
        {
          description: `Messages in ${QUEUE_NAMES[key]}'s dead-letter queue (RUNBOOK section 3: DLQ replay)`,
          threshold: 1,
        },
      );
    }
    alarm(
      'FilesQueueAge',
      messaging.queues.files.queue.metricApproximateAgeOfOldestMessage({
        period: five,
        statistic: 'Maximum',
      }),
      {
        description:
          'A scan result has waited in lc-files for more than 10 minutes: uploads are not being cleared',
        threshold: 600,
      },
    );
    alarm(
      'GuardDutyDeliveryFailures',
      new cloudwatch.Metric({
        namespace: 'AWS/Events',
        metricName: 'FailedInvocations',
        dimensionsMap: { RuleName: messaging.guardDutyRule.ruleName },
        period: five,
        statistic: 'Sum',
      }),
      {
        description: 'EventBridge could not deliver a GuardDuty scan result to lc-files',
        threshold: 1,
      },
    );

    // ---- API and web: 5xx above 2% of requests for 5 minutes (High). Ten requests at least, so one
    // failed request on a quiet night does not page anyone. Each alarm looks at its own target
    // group: the load balancer now serves both, and one service's errors must not page for the other.
    for (const [id, label, targetGroup] of [
      ['Api5xxRate', 'API', compute.apiTargetGroup],
      ['Web5xxRate', 'Web', compute.webTargetGroup],
    ] as const) {
      const requests = targetGroup.metrics.requestCount({ period: five, statistic: 'Sum' });
      const errors = targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: five,
        statistic: 'Sum',
      });
      alarm(
        id,
        new cloudwatch.MathExpression({
          expression: 'IF(requests >= 10, 100 * errors / requests, 0)',
          usingMetrics: { requests, errors },
          period: five,
          label: `${label} 5xx percent`,
        }),
        {
          description: `More than 2 percent of ${label} requests failed with 5xx for 5 minutes`,
          threshold: 2,
          comparison: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        },
      );
    }
    for (const [name, service] of [
      ['ApiTasksRunning', compute.apiService],
      ['WebTasksRunning', compute.webService],
      ['WorkerTasksRunning', compute.workerService],
    ] as const) {
      alarm(
        name,
        new cloudwatch.Metric({
          namespace: 'ECS/ContainerInsights',
          metricName: 'RunningTaskCount',
          dimensionsMap: {
            ClusterName: compute.cluster.clusterName,
            ServiceName: service.serviceName,
          },
          period: five,
          statistic: 'Minimum',
        }),
        {
          description: `No ${name.replace('TasksRunning', '').toLowerCase()} task is running`,
          threshold: 1,
          comparison: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
          evaluationPeriods: 2,
          missing: cloudwatch.TreatMissingData.BREACHING,
        },
      );
    }

    // ---- database
    alarm('DbCpu', data.database.metricCPUUtilization({ period: five, statistic: 'Average' }), {
      description: 'Database CPU above 80 percent for 15 minutes',
      threshold: 80,
      evaluationPeriods: 3,
    });
    alarm(
      'DbFreeStorage',
      data.database.metricFreeStorageSpace({ period: five, statistic: 'Minimum' }),
      {
        description: 'Less than 20 percent of the database storage is free',
        threshold: (config.dbAllocatedStorageGiB * 1024 ** 3) / 5,
        comparison: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      },
    );
    alarm(
      'DbFreeMemory',
      data.database.metricFreeableMemory({ period: five, statistic: 'Minimum' }),
      {
        description: 'Less than 128 MiB of database memory is freeable',
        threshold: 128 * 1024 ** 2,
        comparison: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 3,
      },
    );

    // ---- mail reputation (SES pauses an account whose rates stay high)
    for (const [id, metricName, threshold] of [
      ['SesBounceRate', 'Reputation.BounceRate', 0.05],
      ['SesComplaintRate', 'Reputation.ComplaintRate', 0.001],
    ] as const) {
      alarm(
        id,
        new cloudwatch.Metric({
          namespace: 'AWS/SES',
          metricName,
          period: cdk.Duration.hours(1),
          statistic: 'Maximum',
        }),
        { description: `${metricName} is at a level where SES may pause sending`, threshold },
      );
    }

    // ---- worker log signals (platform-jobs.ts): audit chain, outbox, timers
    const workerLogs = compute.logGroups.worker;
    const signal = (
      id: string,
      source: { name: string; pattern: string },
      description: string,
      threshold = 1,
    ): void => {
      const filter = new logs.MetricFilter(this, `${id}Filter`, {
        logGroup: workerLogs,
        metricNamespace: 'LabConnect/Worker',
        metricName: source.name,
        filterPattern: logs.FilterPattern.literal(source.pattern),
        metricValue: '1',
        defaultValue: 0,
      });
      alarm(id, filter.metric({ period: five, statistic: 'Sum' }), { description, threshold });
    };
    signal(
      'AuditChainBroken',
      LOG_SIGNALS.auditChainBroken,
      'CRITICAL: the audit hash chain does not match its audit rows (OBSERVABILITY.md: Audit chain break, any)',
    );
    signal(
      'AuditRowsUnsealed',
      LOG_SIGNALS.auditUnsealed,
      'Audit rows have stayed unsealed for over an hour: the sealer is not keeping up',
    );
    signal(
      'OutboxRelayFailures',
      LOG_SIGNALS.outboxFailures,
      'The outbox relay failed to publish events; rows past 50 attempts stay parked (OQ-66)',
    );
    signal(
      'TimersGaveUp',
      LOG_SIGNALS.timersFailed,
      'A timer used up its attempts and is FAILED (OQ-83)',
    );
    signal(
      'WorkerJobFailed',
      LOG_SIGNALS.jobFailed,
      'A worker job threw (see the worker log group for the job name)',
    );

    // ---- cost guardrail (AWS_ENVIRONMENTS_AND_DEPLOYMENT.md section 6): only when a budget is given
    const budgetEmail = config.alarmEmail;
    if (config.budgetMonthlyUsd !== undefined && budgetEmail !== undefined) {
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: `${config.prefix}-monthly`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: config.budgetMonthlyUsd, unit: 'USD' },
        },
        notificationsWithSubscribers: [80, 100].map((threshold) => ({
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: budgetEmail }],
        })),
      });
    }
  }
}
