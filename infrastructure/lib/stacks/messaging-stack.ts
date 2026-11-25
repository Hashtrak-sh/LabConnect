import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ses from 'aws-cdk-lib/aws-ses';
import type { Construct } from 'constructs';
import type { InfraConfig } from '../config.js';
import {
  FILES_QUARANTINE_PREFIX,
  MAX_RECEIVE_COUNT,
  QUEUE_NAMES,
  type QueueKey,
  dlqName,
  namesFor,
} from '../names.js';
import type { DataStack } from './data-stack.js';

export interface MessagingStackProps extends cdk.StackProps {
  config: InfraConfig;
  data: DataStack;
}

/** An EventBridge target that only names the queue: it adds no permissions and transforms nothing. */
class BareQueueTarget implements events.IRuleTarget {
  constructor(private readonly queue: sqs.IQueue) {}

  bind(): events.RuleTargetConfig {
    return { arn: this.queue.queueArn };
  }
}

export interface QueuePair {
  queue: sqs.Queue;
  deadLetterQueue: sqs.Queue;
}

/**
 * Messaging: the five queues and their dead-letter queues (AUDIT_AND_EVENT_ARCHITECTURE.md
 * section 3), the GuardDuty Malware Protection plan for the quarantine prefix with the
 * EventBridge rule that delivers its results to `lc-files` (FILES_AND_REPORTS.md section 6,
 * ADR-010), and the SES configuration set (NOTIFICATIONS.md).
 */
export class MessagingStack extends cdk.Stack {
  readonly messagingKey: kms.Key;
  readonly queues: Record<QueueKey, QueuePair>;
  readonly guardDutyRule: events.Rule;
  readonly configurationSet: ses.ConfigurationSet;
  readonly malwarePlan: guardduty.CfnMalwareProtectionPlan;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);
    const { config, data } = props;
    const names = namesFor(config);

    this.messagingKey = new kms.Key(this, 'MessagingKey', {
      alias: `alias/${config.prefix}-messaging`,
      description: 'LabConnect queues and alarm notifications',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pendingWindow: cdk.Duration.days(30),
    });
    const stack = cdk.Stack.of(this);
    const ruleArn = stack.formatArn({
      service: 'events',
      resource: 'rule',
      resourceName: names.guardDutyRuleName,
    });
    // EventBridge writes to the encrypted `lc-files` queue; CloudWatch alarms publish to the
    // encrypted alarm topic. Both are limited to this account (and the rule, for EventBridge).
    this.messagingKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'EventBridgeRuleToQueue',
        principals: [new iam.ServicePrincipal('events.amazonaws.com')],
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: ['*'],
        conditions: { ArnEquals: { 'aws:SourceArn': ruleArn } },
      }),
    );
    this.messagingKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchAlarmsToTopic',
        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: ['*'],
        conditions: { StringEquals: { 'aws:SourceAccount': stack.account } },
      }),
    );

    const pair = (key: QueueKey, visibilityTimeout: cdk.Duration): QueuePair => {
      const name = QUEUE_NAMES[key];
      const fifo = name.endsWith('.fifo');
      const common = {
        encryption: sqs.QueueEncryption.KMS,
        encryptionMasterKey: this.messagingKey,
        enforceSSL: true,
        ...(fifo ? { fifo: true } : {}),
      };
      const deadLetterQueue = new sqs.Queue(this, `${key}Dlq`, {
        ...common,
        queueName: dlqName(name),
        // Long enough for a person to find it and replay it (RUNBOOK.md section 3).
        retentionPeriod: cdk.Duration.days(14),
      });
      const queue = new sqs.Queue(this, `${key}Queue`, {
        ...common,
        queueName: name,
        visibilityTimeout,
        retentionPeriod: cdk.Duration.days(4),
        deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: MAX_RECEIVE_COUNT },
        // The relay sets MessageDeduplicationId to the event id: no content-based dedup.
      });
      return { queue, deadLetterQueue };
    };
    this.queues = {
      notifications: pair('notifications', cdk.Duration.seconds(60)),
      searchSync: pair('searchSync', cdk.Duration.seconds(60)),
      // The scan result consumer decodes and re-encodes images before it acknowledges.
      files: pair('files', cdk.Duration.seconds(120)),
      timers: pair('timers', cdk.Duration.seconds(60)),
      analytics: pair('analytics', cdk.Duration.seconds(60)),
    };

    // ---- GuardDuty Malware Protection for S3, results to lc-files (no input transformer:
    // the queue body must be the event itself).
    this.guardDutyRule = new events.Rule(this, 'GuardDutyScanResults', {
      ruleName: names.guardDutyRuleName,
      description: 'GuardDuty Malware Protection scan results for the files bucket to lc-files',
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Malware Protection Object Scan Result'],
        detail: { s3ObjectDetails: { bucketName: [data.filesBucket.bucketName] } },
      },
      // The bare event goes to the queue: no input transformer, no input.
      targets: [new BareQueueTarget(this.queues.files.queue)],
    });
    // The queue policy the documentation asks for: EventBridge may send, and only for this rule.
    // (The library's own SQS target would add the same statement without the rule condition.)
    this.queues.files.queue.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'GuardDutyRuleToQueue',
        principals: [new iam.ServicePrincipal('events.amazonaws.com')],
        actions: ['sqs:SendMessage'],
        resources: [this.queues.files.queue.queueArn],
        conditions: { ArnEquals: { 'aws:SourceArn': this.guardDutyRule.ruleArn } },
      }),
    );

    // The role GuardDuty assumes to scan the bucket. The statements follow the AWS
    // documentation for Malware Protection for S3 ("Prerequisites: creating or updating an
    // IAM PassRole policy"); object tagging is switched off below, so its statement is left out.
    const bucketArn = data.filesBucket.bucketArn;
    const plansRole = new iam.Role(this, 'MalwareProtectionRole', {
      roleName: names.roleName('guardduty-malware-protection'),
      description: 'Assumed by GuardDuty Malware Protection for S3 to scan the quarantine prefix',
      assumedBy: new iam.ServicePrincipal('malware-protection-plan.guardduty.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': stack.account } },
      }),
    });
    const managedRule = stack.formatArn({
      service: 'events',
      resource: 'rule',
      resourceName: 'DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*',
    });
    plansRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ManagedRule',
        actions: [
          'events:PutRule',
          'events:DeleteRule',
          'events:PutTargets',
          'events:RemoveTargets',
        ],
        resources: [managedRule],
        conditions: {
          StringLike: { 'events:ManagedBy': 'malware-protection-plan.guardduty.amazonaws.com' },
        },
      }),
    );
    plansRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'MonitorManagedRule',
        actions: ['events:DescribeRule', 'events:ListTargetsByRule'],
        resources: [managedRule],
      }),
    );
    plansRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EnableBucketEvents',
        actions: ['s3:PutBucketNotification', 's3:GetBucketNotification'],
        resources: [bucketArn],
      }),
    );
    plansRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ValidationObject',
        actions: ['s3:PutObject'],
        resources: [`${bucketArn}/malware-protection-resource-validation-object`],
      }),
    );
    plansRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BucketOwnership',
        actions: ['s3:ListBucket'],
        resources: [bucketArn],
      }),
    );
    plansRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ScanQuarantine',
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: [`${bucketArn}/${FILES_QUARANTINE_PREFIX}/*`],
      }),
    );
    plansRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'DecryptForScan',
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: [data.filesKey.keyArn],
        conditions: {
          StringLike: { 'kms:ViaService': `s3.${stack.region}.amazonaws.com` },
        },
      }),
    );
    this.malwarePlan = new guardduty.CfnMalwareProtectionPlan(this, 'MalwareProtectionPlan', {
      role: plansRole.roleArn,
      protectedResource: {
        s3Bucket: {
          bucketName: data.filesBucket.bucketName,
          // Only the quarantine prefix is scanned: promoted files under clean/ were scanned already.
          objectPrefixes: [`${FILES_QUARANTINE_PREFIX}/`],
        },
      },
      // The optional "scanned" object tag is not used (FILES_AND_REPORTS.md section 6).
      actions: { tagging: { status: 'DISABLED' } },
    });

    // ---- SES (sending identity verification is manual or comes with the domain: README)
    this.configurationSet = new ses.ConfigurationSet(this, 'SesConfigurationSet', {
      configurationSetName: names.sesConfigurationSet,
      tlsPolicy: ses.ConfigurationSetTlsPolicy.REQUIRE,
      reputationMetrics: true,
      sendingEnabled: true,
    });
  }
}
