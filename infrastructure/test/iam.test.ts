import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  type Statement,
  actionsOf,
  resourcesOf,
  resourcesOfType,
  statementsOfRole,
  synthesise,
} from './helpers.js';

const { templates } = synthesise();
const text = (value: unknown): string => JSON.stringify(value);

/** No `*`, no `service:*`, no `service:Prefix*` of the "Get*"/"Put*" kind that grants whole families. */
function wildcardActions(statements: Statement[]): string[] {
  return statements.flatMap(actionsOf).filter((action) => action.includes('*'));
}
function wildcardResources(statements: Statement[]): Statement[] {
  return statements.filter((statement) => resourcesOf(statement).some((r) => r === '*'));
}

describe('task roles', () => {
  const api = statementsOfRole(templates.compute, 'labconnect-uat-api-task');
  const worker = statementsOfRole(templates.compute, 'labconnect-uat-worker-task');

  it('exist, with statements', () => {
    expect(api.length).toBeGreaterThan(0);
    expect(worker.length).toBeGreaterThan(0);
  });

  it.each([
    ['api', api],
    ['worker', worker],
  ])('gives the %s role no wildcard action and no "*" resource', (_name, statements) => {
    expect(wildcardActions(statements)).toEqual([]);
    expect(wildcardResources(statements)).toEqual([]);
    // Not an admin statement in disguise either.
    for (const statement of statements) {
      expect(statement.Effect).toBe('Allow');
      expect(actionsOf(statement)).not.toContain('iam:PassRole');
      for (const action of actionsOf(statement)) {
        expect(action).not.toMatch(
          /^iam:|^sts:|^organizations:|^kms:(Create|Schedule|Put|Disable)/,
        );
      }
    }
  });

  it('lets the API presign uploads into quarantine/ and downloads from clean/, and nothing else on S3', () => {
    const s3 = api.filter((s) => actionsOf(s).some((a) => a.startsWith('s3:')));
    const grants = s3.map((s) => [actionsOf(s).join(), text(resourcesOf(s))]);
    expect(grants).toHaveLength(2);
    const [put, get] = [
      grants.find(([action]) => action === 's3:PutObject'),
      grants.find(([action]) => action === 's3:GetObject'),
    ];
    expect(put?.[1]).toContain('/quarantine/*');
    expect(put?.[1]).not.toContain('/clean/');
    expect(get?.[1]).toContain('/clean/*');
    expect(get?.[1]).not.toContain('quarantine');
  });

  it('keeps everything that only the worker needs away from the API role', () => {
    const everything = text(api);
    expect(everything).not.toMatch(/sqs:/);
    expect(everything).not.toMatch(/s3:DeleteObject/);
    expect(everything).not.toMatch(/s3:ListBucket/);
    expect(everything).not.toMatch(/secretsmanager:/);
    expect(everything).not.toMatch(/guardduty:/);
    // It cannot read the quarantine prefix, where unscanned uploads sit.
    for (const statement of api) {
      if (actionsOf(statement).includes('s3:GetObject')) {
        expect(text(statement.Resource)).not.toContain('quarantine');
      }
    }
  });

  it('lets the worker publish to all five queues, but consume from three only', () => {
    const send = worker.find((s) => actionsOf(s).includes('sqs:SendMessage'));
    expect(resourcesOf(send as Statement)).toHaveLength(5);
    const receive = worker.find((s) => actionsOf(s).includes('sqs:ReceiveMessage'));
    expect(resourcesOf(receive as Statement)).toHaveLength(3);
    // Dead-letter queues are not listed anywhere: replay is a person's job (RUNBOOK section 3).
    expect(text(worker)).not.toMatch(/Dlq/);
  });

  it('lets the worker read and delete quarantined objects and write clean ones, not the reverse', () => {
    const read = worker.find((s) => actionsOf(s).includes('s3:GetObject'));
    expect(actionsOf(read as Statement).sort()).toEqual(['s3:DeleteObject', 's3:GetObject']);
    expect(text(read?.Resource)).toContain('/quarantine/*');
    const write = worker.find((s) => actionsOf(s).includes('s3:PutObject'));
    expect(actionsOf(write as Statement)).toEqual(['s3:PutObject']);
    expect(text(write?.Resource)).toContain('/clean/*');
    expect(text(write?.Resource)).not.toContain('quarantine');
  });

  it('limits the worker to sending mail from the configured sender and configuration set', () => {
    const mail = worker.find((s) => actionsOf(s).includes('ses:SendEmail'));
    expect(actionsOf(mail as Statement)).toEqual(['ses:SendEmail']);
    const resources = text(mail?.Resource);
    expect(resources).toContain('identity/no-reply@labconnect.invalid');
    expect(resources).toContain('configuration-set/labconnect-uat');
  });

  it("lets the API send mail (the sign-in code) with ses:SendEmail on the worker's three resources, and nothing else of SES", () => {
    const sesActions = api.flatMap(actionsOf).filter((action) => action.startsWith('ses'));
    expect(sesActions).toEqual(['ses:SendEmail']);
    const mail = api.filter((s) => actionsOf(s).some((a) => a.startsWith('ses')));
    expect(mail).toHaveLength(1);
    const resources = resourcesOf(mail[0] as Statement);
    expect(resources).toHaveLength(3);
    expect(text(resources)).toContain('identity/no-reply@labconnect.invalid');
    expect(text(resources)).toContain('identity/labconnect.invalid');
    expect(text(resources)).toContain('configuration-set/labconnect-uat');
    expect(text(resources)).not.toContain('*');
    // The very same resources as the worker's statement: the API gets no wider sender.
    const workerMail = worker.find((s) => actionsOf(s).includes('ses:SendEmail'));
    expect(text(resources)).toBe(text(resourcesOf(workerMail as Statement)));
  });

  const keyStatements = (statements: Statement[]): Statement[] =>
    statements.filter((s) => actionsOf(s).some((a) => a.startsWith('kms:')));
  const viaService = (statement: Statement | undefined): string =>
    text(
      (statement?.Condition as { StringEquals?: Record<string, unknown> } | undefined)
        ?.StringEquals?.['kms:ViaService'],
    );

  it('allows the files key only through S3', () => {
    for (const statements of [api, worker]) {
      const key = keyStatements(statements).find((s) => viaService(s).includes('"s3.'));
      expect(key).toBeDefined();
      expect(text(key?.Resource)).toContain('FilesKey');
      expect(actionsOf(key as Statement).sort()).toEqual(['kms:Decrypt', 'kms:GenerateDataKey']);
    }
  });

  it('lets the worker use the key of the encrypted queues, through SQS only', () => {
    // Every queue is encrypted with the messaging key. A role that may send and receive but
    // may not use that key is refused by SQS on every call.
    const queueKeyId = resourcesOfType(templates.messaging, 'AWS::SQS::Queue')[0]?.[1].Properties
      .KmsMasterKeyId;
    expect(queueKeyId).toBeDefined();
    const key = keyStatements(worker).find((s) => viaService(s).includes('"sqs.'));
    expect(key).toBeDefined();
    expect(actionsOf(key as Statement).sort()).toEqual(['kms:Decrypt', 'kms:GenerateDataKey']);
    expect(text(key?.Resource)).toContain('MessagingKey');
    // Two key statements for the worker (files through S3, queues through SQS), one for the API.
    expect(keyStatements(worker)).toHaveLength(2);
    expect(keyStatements(api)).toHaveLength(1);
    expect(text(api)).not.toContain('MessagingKey');
  });

  it('can be assumed by ECS tasks of this account only', () => {
    templates.compute.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'labconnect-uat-api-task',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'ecs-tasks.amazonaws.com' },
            Condition: { StringEquals: { 'aws:SourceAccount': Match.anyValue() } },
          }),
        ],
      },
    });
  });
});

describe('execution roles (they inject secrets, so each lists exactly its own)', () => {
  const secretsOf = (family: string): string[] => {
    const [, task] = resourcesOfType(templates.compute, 'AWS::ECS::TaskDefinition').find(
      ([, t]) => t.Properties.Family === family,
    ) as [
      string,
      { Properties: { ContainerDefinitions: { Secrets?: { ValueFrom: unknown }[] }[] } },
    ];
    return (task.Properties.ContainerDefinitions[0]?.Secrets ?? []).map((s) => text(s.ValueFrom));
  };
  /** The exported name of the imported secret, which identifies it. */
  const importId = (value: string): string =>
    /LabConnect-uat-data:ExportsOutput[A-Za-z]+/.exec(value)?.[0] ?? value;

  it.each(['api', 'worker', 'migrate'])(
    'reads exactly the secrets of the %s task definition',
    (service) => {
      const wanted = new Set(secretsOf(`labconnect-uat-${service}`).map(importId));
      const granted = statementsOfRole(templates.compute, `labconnect-uat-${service}-exec`)
        .filter((s) => actionsOf(s).includes('secretsmanager:GetSecretValue'))
        .flatMap(resourcesOf)
        .map((resource) => importId(text(resource)));
      expect(new Set(granted)).toEqual(wanted);
      expect(wanted.size).toBeGreaterThan(0);
    },
  );

  it('keeps the database logins apart: API URL for the API, worker URL for the worker', () => {
    const api = secretsOf('labconnect-uat-api').map(importId).join(' ');
    const worker = secretsOf('labconnect-uat-worker').map(importId).join(' ');
    expect(api).toContain('ApiDatabaseUrl');
    expect(api).not.toContain('WorkerDatabaseUrl');
    expect(api).not.toContain('OwnerDatabaseUrl');
    expect(worker).toContain('WorkerDatabaseUrl');
    expect(worker).not.toContain('ApiDatabaseUrl');
    expect(worker).not.toContain('OwnerDatabaseUrl');
    expect(worker).not.toContain('AuthJwtPrivateKey');
    // Only the migration task holds the owner's credentials.
    expect(secretsOf('labconnect-uat-migrate').map(importId).join(' ')).toContain(
      'OwnerDatabaseUrl',
    );
  });

  it.each(['api', 'worker', 'migrate'])(
    'gives the %s execution role no wildcard action',
    (service) => {
      const statements = statementsOfRole(templates.compute, `labconnect-uat-${service}-exec`);
      expect(wildcardActions(statements)).toEqual([]);
      // ecr:GetAuthorizationToken is the one action that cannot be scoped to a resource.
      for (const statement of wildcardResources(statements)) {
        expect(actionsOf(statement)).toEqual(['ecr:GetAuthorizationToken']);
      }
    },
  );
});

describe('GitHub OIDC deploy role', () => {
  const { templates: dev } = synthesise();
  const deploy = statementsOfRole(dev.delivery, 'uat-deployer');

  it('has an OIDC provider for GitHub Actions and no access keys exist anywhere', () => {
    dev.delivery.hasResourceProperties('AWS::IAM::OIDCProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIdList: ['sts.amazonaws.com'],
    });
    expect(text(synthesise().all)).not.toContain('AWS::IAM::AccessKey');
    expect(text(synthesise().all)).not.toContain('AWS::IAM::User');
  });

  it('can be assumed only by this repository, in the uat environment, through the provider', () => {
    const role = resourcesOfType(dev.delivery, 'AWS::IAM::Role')
      .map(([, r]) => r)
      .find((r) => r.Properties.RoleName === 'uat-deployer');
    const trust = role?.Properties.AssumeRolePolicyDocument as {
      Statement: {
        Action: string;
        Effect: string;
        Principal: unknown;
        Condition: Record<string, Record<string, string>>;
      }[];
    };
    expect(trust.Statement).toHaveLength(1);
    const [statement] = trust.Statement;
    expect(statement?.Effect).toBe('Allow');
    expect(statement?.Action).toBe('sts:AssumeRoleWithWebIdentity');
    expect(text(statement?.Principal)).toContain('Federated');
    // Exact matches only: no StringLike, no wildcard.
    expect(Object.keys(statement?.Condition ?? {})).toEqual(['StringEquals']);
    expect(statement?.Condition.StringEquals).toEqual({
      'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
      'token.actions.githubusercontent.com:sub': 'repo:Hashtrak-sh/LabConnect:environment:uat',
    });
    expect(text(trust)).not.toContain('*');
  });

  it('follows the repository and the stage when they are configured', () => {
    const other = synthesise({ githubRepository: 'example-org/other-repo' }).templates.delivery;
    other.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'uat-deployer',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: {
              StringEquals: Match.objectLike({
                'token.actions.githubusercontent.com:sub':
                  'repo:example-org/other-repo:environment:uat',
              }),
            },
          }),
        ],
      },
    });
  });

  it('can reuse an existing provider instead of creating a second one', () => {
    const reuse = synthesise({
      githubOidcProviderArn:
        'arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com',
    }).templates.delivery;
    reuse.resourceCountIs('AWS::IAM::OIDCProvider', 0);
  });

  it('has no wildcard action, and "*" resources only where AWS allows nothing narrower', () => {
    expect(wildcardActions(deploy)).toEqual([]);
    const allowedOnAnyResource = new Set([
      'ecr:GetAuthorizationToken',
      'ecs:RegisterTaskDefinition',
      'ecs:DescribeTaskDefinition',
    ]);
    for (const statement of wildcardResources(deploy)) {
      for (const action of actionsOf(statement))
        expect(allowedOnAnyResource.has(action), action).toBe(true);
    }
  });

  it('cannot assume any other role (no CDK bootstrap roles, no sts at all) or create IAM users, roles or policies', () => {
    // The workflow changes the application only. Infrastructure is deployed by a person
    // (OQ-179): a role that could hand over to the bootstrap roles would be an administrator.
    for (const action of deploy.flatMap(actionsOf)) {
      expect(action).not.toMatch(/^sts:/);
      expect(action).not.toMatch(/^iam:(Create|Attach|Put|Update|Delete)/);
    }
    expect(text(deploy)).not.toContain('cdk-');
    expect(text(deploy)).not.toContain('sts:AssumeRole');
  });

  it('may read one stack and nothing else of CloudFormation', () => {
    const stackReads = deploy.filter((s) =>
      actionsOf(s).some((a) => a.startsWith('cloudformation:')),
    );
    expect(stackReads).toHaveLength(1);
    const [read] = stackReads;
    expect(actionsOf(read as Statement)).toEqual(['cloudformation:DescribeStacks']);
    expect(resourcesOf(read as Statement)).toHaveLength(1);
    const [resource] = resourcesOf(read as Statement);
    expect(text(resource)).toContain(':stack/LabConnect-uat-compute/*');
    expect(text(resource)).not.toContain('delivery');
    expect(read?.Condition).toBeUndefined();
  });

  it('has exactly these statements, so that a new permission is a deliberate change', () => {
    expect(deploy.map((s) => s.Sid).sort()).toEqual([
      'EcrLogin',
      'EcrPush',
      'EcsRunMigration',
      'EcsServices',
      'EcsTaskDefinitions',
      'EcsWatchTasks',
      'PassTaskRoles',
      'ReadComputeStackOutputs',
    ]);
    // Nothing the workflow does not call: it cannot deregister task definitions, stop or list
    // tasks, or read application logs (they can hold personal data; the workflow log is public).
    const actions = deploy.flatMap(actionsOf);
    for (const unused of ['ecs:DeregisterTaskDefinition', 'ecs:StopTask', 'ecs:ListTasks']) {
      expect(actions).not.toContain(unused);
    }
    expect(actions.filter((action) => action.startsWith('logs:'))).toEqual([]);
  });

  it('may pass only the six task and execution roles, and only to ECS tasks', () => {
    const pass = deploy.find((s) => actionsOf(s).includes('iam:PassRole'));
    expect(resourcesOf(pass as Statement)).toHaveLength(6);
    expect(text(pass?.Resource)).toContain('role/labconnect-uat-api-task');
    expect(text(pass?.Resource)).toContain('role/labconnect-uat-migrate-exec');
    expect(pass?.Condition).toEqual({
      StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' },
    });
  });

  it('pushes only to the three image repositories and cannot run tasks of other definitions', () => {
    const push = deploy.find((s) => actionsOf(s).includes('ecr:PutImage'));
    expect(resourcesOf(push as Statement)).toHaveLength(3);
    const run = deploy.find((s) => actionsOf(s).includes('ecs:RunTask'));
    expect(text(run?.Resource)).toContain('task-definition/labconnect-uat-migrate:*');
    expect(run?.Condition).toBeDefined();
  });

  it('is short-lived', () => {
    dev.delivery.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'uat-deployer',
      MaxSessionDuration: 3600,
    });
  });
});

describe('image repositories', () => {
  it('are immutable, scanned on push and retained', () => {
    const repositories = resourcesOfType(templates.delivery, 'AWS::ECR::Repository');
    expect(repositories.map(([, r]) => r.Properties.RepositoryName).sort()).toEqual([
      'labconnect/api',
      'labconnect/migrate',
      'labconnect/worker',
    ]);
    for (const [, repository] of repositories) {
      expect(repository.Properties.ImageTagMutability).toBe('IMMUTABLE');
      expect(repository.Properties.ImageScanningConfiguration).toEqual({ ScanOnPush: true });
    }
    templates.delivery.hasResource('AWS::ECR::Repository', { DeletionPolicy: 'Retain' });
  });
});

describe('nothing is a wildcard administrator anywhere', () => {
  it('has no IAM statement that allows * or service:* on * in any stack', () => {
    for (const template of Object.values(templates)) {
      const json = template.toJSON() as {
        Resources: Record<string, { Type: string; Properties: Record<string, unknown> }>;
      };
      for (const resource of Object.values(json.Resources)) {
        const documents: { Statement: Statement[] }[] = [];
        if (resource.Type === 'AWS::IAM::Policy' || resource.Type === 'AWS::IAM::ManagedPolicy') {
          documents.push(resource.Properties.PolicyDocument as { Statement: Statement[] });
        }
        if (resource.Type === 'AWS::IAM::Role') {
          for (const inline of (resource.Properties.Policies as
            { PolicyDocument: { Statement: Statement[] } }[] | undefined) ?? []) {
            documents.push(inline.PolicyDocument);
          }
          // Only the CDK custom-resource Lambdas carry a managed policy: the basic logging one.
          for (const arn of (resource.Properties.ManagedPolicyArns as unknown[] | undefined) ??
            []) {
            expect(text(arn)).toContain('AWSLambdaBasicExecutionRole');
          }
        }
        for (const document of documents) {
          for (const statement of document.Statement) {
            if (statement.Effect !== 'Allow') continue;
            const wildcardAction = actionsOf(statement).some((a) => a === '*' || a.endsWith(':*'));
            const wildcardResource = resourcesOf(statement).some((r) => r === '*');
            expect(wildcardAction && wildcardResource, text(statement)).toBe(false);
          }
        }
      }
    }
  });
});
