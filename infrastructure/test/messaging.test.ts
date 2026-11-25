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
    expect(text).toContain('aws:SourceArn');
    // And the key policy allows the same rule to use the key.
    const keys = JSON.stringify(
      resourcesOfType(templates.messaging, 'AWS::KMS::Key').map(([, k]) => k.Properties),
    );
    expect(keys).toContain('rule/lc-guardduty-scan-results');
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
    templates.messaging.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'malware-protection-plan.guardduty.amazonaws.com' },
          }),
        ],
      },
    });
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
