import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { MAX_RECEIVE_COUNT, QUEUE_NAMES, dlqName, queueUrlVariable } from '../lib/names.js';
import { resourcesOfType, single, synthesise } from './helpers.js';

describe('queues', () => {
  const { templates } = synthesise();
  const queues = resourcesOfType(templates.messaging, 'AWS::SQS::Queue');
  const byName = new Map(queues.map(([id, q]) => [q.Properties.QueueName as string, { id, ...q }]));

  it('has exactly the five documented queues and their dead-letter queues', () => {
    expect(Object.values(QUEUE_NAMES).sort()).toEqual([
      'lc-analytics',
      'lc-files',
      'lc-notifications.fifo',
      'lc-search-sync',
      'lc-timers',
    ]);
    expect([...byName.keys()].sort()).toEqual(
      [...Object.values(QUEUE_NAMES), ...Object.values(QUEUE_NAMES).map(dlqName)].sort(),
    );
  });

  it.each(Object.values(QUEUE_NAMES))(
    '%s has a dead-letter queue with max receive count 5',
    (name) => {
      const queue = byName.get(name);
      expect(queue, name).toBeDefined();
      const policy = queue?.Properties.RedrivePolicy as {
        maxReceiveCount: number;
        deadLetterTargetArn: { 'Fn::GetAtt': [string, string] };
      };
      expect(policy.maxReceiveCount).toBe(5);
      expect(MAX_RECEIVE_COUNT).toBe(5);
      const dlq = byName.get(dlqName(name));
      expect(policy.deadLetterTargetArn['Fn::GetAtt'][0]).toBe(dlq?.id);
      // A dead-letter queue has no dead-letter queue of its own.
      expect(dlq?.Properties.RedrivePolicy).toBeUndefined();
    },
  );

  it('makes lc-notifications.fifo (and its dead-letter queue) FIFO and no other queue FIFO', () => {
    for (const [name, queue] of byName) {
      if (name.endsWith('.fifo')) {
        expect(queue.Properties.FifoQueue, name).toBe(true);
        // The relay sets MessageDeduplicationId to the event id.
        expect(queue.Properties.ContentBasedDeduplication).toBeUndefined();
      } else {
        expect(queue.Properties.FifoQueue, name).toBeUndefined();
      }
    }
    expect(dlqName('lc-notifications.fifo')).toBe('lc-notifications-dlq.fifo');
  });

  it('encrypts every queue with the messaging key and refuses plain HTTP', () => {
    for (const [name, queue] of byName) {
      expect(queue.Properties.KmsMasterKeyId, name).toBeDefined();
    }
    const policies = JSON.stringify(
      resourcesOfType(templates.messaging, 'AWS::SQS::QueuePolicy').map(([, p]) => p.Properties),
    );
    expect(policies).toContain('aws:SecureTransport');
  });

  it('names the queue URL variables the worker reads', () => {
    expect(queueUrlVariable('lc-notifications.fifo')).toBe('QUEUE_URL_LC_NOTIFICATIONS_FIFO');
    expect(queueUrlVariable('lc-files')).toBe('QUEUE_URL_LC_FILES');
    expect(queueUrlVariable('lc-search-sync')).toBe('QUEUE_URL_LC_SEARCH_SYNC');
  });
});

describe('GuardDuty scan results', () => {
  const { templates } = synthesise();

  it('delivers the documented event pattern to lc-files with no input transformer', () => {
    templates.messaging.hasResourceProperties('AWS::Events::Rule', {
      Name: 'lc-guardduty-scan-results',
      EventPattern: {
        source: ['aws.guardduty'],
        'detail-type': ['GuardDuty Malware Protection Object Scan Result'],
        detail: { s3ObjectDetails: { bucketName: [Match.anyValue()] } },
      },
      Targets: [
        {
          Arn: Match.anyValue(),
          Id: Match.anyValue(),
          // Anything but the bare event would break the consumer (FILES_AND_REPORTS.md section 6).
          InputTransformer: Match.absent(),
          Input: Match.absent(),
          InputPath: Match.absent(),
        },
      ],
    });
    const rule = single(templates.messaging, 'AWS::Events::Rule');
    const target = (rule.Properties.Targets as { Arn: { 'Fn::GetAtt': [string, string] } }[])[0];
    const filesQueue = resourcesOfType(templates.messaging, 'AWS::SQS::Queue').find(
      ([, q]) => q.Properties.QueueName === 'lc-files',
    );
    expect(target?.Arn['Fn::GetAtt'][0]).toBe(filesQueue?.[0]);
  });

  it('lets EventBridge send to the queue, for that rule only', () => {
    const text = JSON.stringify(
      resourcesOfType(templates.messaging, 'AWS::SQS::QueuePolicy').map(([, p]) => p.Properties),
    );
    expect(text).toContain('events.amazonaws.com');
    expect(text).toContain('sqs:SendMessage');
    // The condition names the rule itself, not a pattern.
    const rule = resourcesOfType(templates.messaging, 'AWS::Events::Rule')[0]?.[0] ?? 'missing';
    templates.messaging.hasResourceProperties('AWS::SQS::QueuePolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sqs:SendMessage',
            Principal: { Service: 'events.amazonaws.com' },
            Condition: { ArnEquals: { 'aws:SourceArn': { 'Fn::GetAtt': [rule, 'Arn'] } } },
          }),
        ]),
      },
    });
  });

  it('lets EventBridge use the queue key with the documented statement, which has no condition', () => {
    // The EventBridge User Guide gives this statement without a condition, and AWS says the
    // source conditions are not supported on a key policy for EventBridge to an encrypted
    // topic. A condition that EventBridge does not satisfy would drop every scan result.
    const key = single(templates.messaging, 'AWS::KMS::Key');
    const statements = (key.Properties.KeyPolicy as { Statement: Record<string, unknown>[] })
      .Statement;
    const forEvents = statements.filter((statement) =>
      JSON.stringify(statement.Principal).includes('events.amazonaws.com'),
    );
    expect(forEvents).toHaveLength(1);
    expect(forEvents[0]?.Action).toEqual(['kms:GenerateDataKey', 'kms:Decrypt']);
    expect(forEvents[0]?.Condition).toBeUndefined();
    // CloudWatch alarms (to the alarm topic) stay limited to this account.
    const forAlarms = statements.find((statement) =>
      JSON.stringify(statement.Principal).includes('cloudwatch.amazonaws.com'),
    );
    expect(JSON.stringify(forAlarms?.Condition)).toContain('aws:SourceAccount');
  });

  it('turns on Malware Protection for the quarantine prefix of the files bucket only', () => {
    templates.messaging.hasResourceProperties('AWS::GuardDuty::MalwareProtectionPlan', {
      ProtectedResource: {
        S3Bucket: { BucketName: Match.anyValue(), ObjectPrefixes: ['quarantine/'] },
      },
      Actions: { Tagging: { Status: 'DISABLED' } },
      Role: Match.anyValue(),
    });
  });

  it('gives GuardDuty a role that cannot read outside the quarantine prefix', () => {
    const text = JSON.stringify(
      resourcesOfType(templates.messaging, 'AWS::IAM::Policy').map(([, p]) => p.Properties),
    );
    expect(text).toContain('/quarantine/*');
    expect(text).not.toMatch(/"Action":"s3:\*"|"Action":"\*"/);
    // The trust policy is the documented one: that service principal, no condition.
    templates.messaging.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: { Service: 'malware-protection-plan.guardduty.amazonaws.com' },
          },
        ],
      },
    });
  });

  it('gives GuardDuty the documented statements, minus object tagging', () => {
    const actions = resourcesOfType(templates.messaging, 'AWS::IAM::Policy')
      .flatMap(
        ([, p]) =>
          (p.Properties.PolicyDocument as { Statement: { Action: string | string[] }[] }).Statement,
      )
      .flatMap((statement) => statement.Action)
      .sort();
    expect(actions).toEqual(
      [
        'events:DeleteRule',
        'events:DescribeRule',
        'events:ListTargetsByRule',
        'events:PutRule',
        'events:PutTargets',
        'events:RemoveTargets',
        'kms:Decrypt',
        'kms:GenerateDataKey',
        's3:GetBucketNotification',
        's3:GetObject',
        's3:GetObjectVersion',
        's3:ListBucket',
        's3:PutBucketNotification',
        's3:PutObject',
      ].sort(),
    );
  });
});

describe('mail', () => {
  it('has a configuration set that requires TLS', () => {
    synthesise().templates.messaging.hasResourceProperties('AWS::SES::ConfigurationSet', {
      Name: 'labconnect-uat',
      DeliveryOptions: { TlsPolicy: 'REQUIRE' },
    });
  });
});
