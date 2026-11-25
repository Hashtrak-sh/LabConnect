import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DeployCheckError } from '../scripts/deploy/errors.mjs';
import {
  healthUrl,
  imageExists,
  judgeHealth,
  judgeMigrationTask,
  judgeRollout,
  judgeRunTask,
  readStackOutputs,
} from '../scripts/deploy/results.mjs';
import {
  READ_ONLY_FIELDS,
  buildRegisterInput,
  replaceImageTag,
  repositoryOf,
} from '../scripts/deploy/task-definition.mjs';

const REGISTRY = '111111111111.dkr.ecr.ap-south-1.amazonaws.com';
const OLD_TAG = 'a'.repeat(40);
const NEW_TAG = 'b'.repeat(40);
const CLI = fileURLToPath(new URL('../scripts/deploy/cli.mjs', import.meta.url));

/** What `aws ecs describe-task-definition` prints (the fields it prints, with invented values). */
function described(): { taskDefinition: Record<string, unknown> } {
  return {
    taskDefinition: {
      taskDefinitionArn: 'arn:aws:ecs:ap-south-1:111111111111:task-definition/labconnect-uat-api:7',
      containerDefinitions: [
        {
          name: 'api',
          image: `${REGISTRY}/labconnect/api:${OLD_TAG}`,
          cpu: 0,
          portMappings: [{ containerPort: 3001, hostPort: 3001, protocol: 'tcp' }],
          essential: true,
          environment: [
            { name: 'APP_ENV', value: 'uat' },
            { name: 'NODE_ENV', value: 'production' },
          ],
          secrets: [
            {
              name: 'API_DATABASE_URL',
              valueFrom: 'arn:aws:secretsmanager:ap-south-1:111111111111:secret:example-AbCdEf',
            },
          ],
          mountPoints: [],
          volumesFrom: [],
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': '/labconnect/uat/api',
              'awslogs-region': 'ap-south-1',
              'awslogs-stream-prefix': 'api',
            },
          },
          healthCheck: { command: ['CMD-SHELL', 'true'], interval: 30, timeout: 5, retries: 3 },
          stopTimeout: 30,
          systemControls: [],
        },
      ],
      family: 'labconnect-uat-api',
      taskRoleArn: 'arn:aws:iam::111111111111:role/labconnect-uat-api-task',
      executionRoleArn: 'arn:aws:iam::111111111111:role/labconnect-uat-api-exec',
      networkMode: 'awsvpc',
      revision: 7,
      volumes: [],
      status: 'ACTIVE',
      requiresAttributes: [{ name: 'ecs.capability.execution-role-awslogs' }],
      placementConstraints: [],
      compatibilities: ['EC2', 'FARGATE'],
      runtimePlatform: { cpuArchitecture: 'X86_64', operatingSystemFamily: 'LINUX' },
      requiresCompatibilities: ['FARGATE'],
      cpu: '512',
      memory: '1024',
      registeredAt: '2026-11-25T10:00:00.000000+05:30',
      registeredBy: 'arn:aws:sts::111111111111:assumed-role/example/session',
    },
  };
}

describe('replaceImageTag', () => {
  it('changes the tag and nothing before it', () => {
    expect(replaceImageTag(`${REGISTRY}/labconnect/api:${OLD_TAG}`, NEW_TAG)).toBe(
      `${REGISTRY}/labconnect/api:${NEW_TAG}`,
    );
  });

  it('handles a registry with a port', () => {
    expect(replaceImageTag('registry.example:5000/labconnect/api:old', 'new')).toBe(
      'registry.example:5000/labconnect/api:new',
    );
  });

  it.each([
    ['digest-pinned image', `${REGISTRY}/labconnect/api@sha256:${'c'.repeat(64)}`, NEW_TAG],
    ['image without a tag', `${REGISTRY}/labconnect/api`, NEW_TAG],
    ['registry with a port and no tag', 'registry.example:5000/labconnect/api', NEW_TAG],
    ['empty image', '', NEW_TAG],
    ['tag with a slash', `${REGISTRY}/labconnect/api:old`, 'x/y'],
    ['tag with a space', `${REGISTRY}/labconnect/api:old`, 'x y'],
    ['empty tag', `${REGISTRY}/labconnect/api:old`, ''],
    ['tag starting with a dash', `${REGISTRY}/labconnect/api:old`, '-x'],
    ['tag that is too long', `${REGISTRY}/labconnect/api:old`, 'a'.repeat(129)],
  ])('refuses a %s', (_name, image, tag) => {
    expect(() => replaceImageTag(image, tag)).toThrow(DeployCheckError);
  });

  it('reads the repository path of an image', () => {
    expect(repositoryOf(`${REGISTRY}/labconnect/api:${OLD_TAG}`)).toBe('labconnect/api');
    expect(repositoryOf('registry.example:5000/labconnect/api:x')).toBe('labconnect/api');
  });
});

describe('buildRegisterInput', () => {
  const options = { container: 'api', tag: NEW_TAG, repository: 'labconnect/api' };

  it('drops the read-only fields', () => {
    const input = buildRegisterInput(described(), options);
    for (const field of READ_ONLY_FIELDS) expect(input).not.toHaveProperty(field);
    // The members of the API's TaskDefinition type that RegisterTaskDefinition does not take.
    expect([...READ_ONLY_FIELDS].sort()).toEqual([
      'compatibilities',
      'deleteRequestedAt',
      'deregisteredAt',
      'registeredAt',
      'registeredBy',
      'requiresAttributes',
      'revision',
      'status',
      'taskDefinitionArn',
    ]);
    const deleting = described();
    deleting.taskDefinition.deleteRequestedAt = '2026-01-01T00:00:00Z';
    expect(buildRegisterInput(deleting, options)).not.toHaveProperty('deleteRequestedAt');
    expect(Object.keys(input).sort()).toEqual(
      [
        'containerDefinitions',
        'cpu',
        'executionRoleArn',
        'family',
        'memory',
        'networkMode',
        'placementConstraints',
        'requiresCompatibilities',
        'runtimePlatform',
        'taskRoleArn',
        'volumes',
      ].sort(),
    );
  });

  it('changes only the image tag: everything else is byte-identical', () => {
    const before = described().taskDefinition;
    const input = buildRegisterInput(described(), options);
    const expected: Record<string, unknown> = Object.fromEntries(
      Object.entries(structuredClone(before)).filter(([key]) => !READ_ONLY_FIELDS.includes(key)),
    );
    const containers = expected.containerDefinitions as { image: string }[];
    (containers[0] as { image: string }).image = `${REGISTRY}/labconnect/api:${NEW_TAG}`;
    // Same keys, same order, same values: compared as text.
    expect(JSON.stringify(input)).toBe(JSON.stringify(expected));
    // The roles, secrets, environment and logging in particular.
    expect(input.taskRoleArn).toBe(before.taskRoleArn);
    expect(input.executionRoleArn).toBe(before.executionRoleArn);
    const [container] = input.containerDefinitions as Record<string, unknown>[];
    const [original] = before.containerDefinitions as Record<string, unknown>[];
    expect(JSON.stringify(container?.secrets)).toBe(JSON.stringify(original?.secrets));
    expect(JSON.stringify(container?.environment)).toBe(JSON.stringify(original?.environment));
    expect(JSON.stringify(container?.logConfiguration)).toBe(
      JSON.stringify(original?.logConfiguration),
    );
  });

  it('does not change its input', () => {
    const input = described();
    const copy = structuredClone(input);
    buildRegisterInput(input, options);
    expect(input).toEqual(copy);
  });

  it('changes only the named container of several', () => {
    const input = described();
    const containers = input.taskDefinition.containerDefinitions as Record<string, unknown>[];
    containers.push({ name: 'sidecar', image: 'registry.example/other/sidecar:1' });
    const built = buildRegisterInput(input, options);
    const [api, sidecar] = built.containerDefinitions as { image: string }[];
    expect(api?.image).toBe(`${REGISTRY}/labconnect/api:${NEW_TAG}`);
    expect(sidecar?.image).toBe('registry.example/other/sidecar:1');
  });

  it('refuses a task definition without the named container', () => {
    expect(() => buildRegisterInput(described(), { ...options, container: 'worker' })).toThrow(
      /no container named "worker"/,
    );
  });

  it('refuses two containers with the same name', () => {
    const input = described();
    const containers = input.taskDefinition.containerDefinitions as Record<string, unknown>[];
    containers.push({ ...containers[0] });
    expect(() => buildRegisterInput(input, options)).toThrow(/several containers/);
  });

  it('refuses an image from another repository', () => {
    expect(() =>
      buildRegisterInput(described(), { ...options, repository: 'labconnect/worker' }),
    ).toThrow(/not in repository/);
  });

  it.each([[null], [{}], [{ taskDefinition: [] }], [{ taskDefinition: {} }]])(
    'refuses input that is not a task definition (%j)',
    (input) => {
      expect(() => buildRegisterInput(input, options)).toThrow(DeployCheckError);
    },
  );
});

const stoppedTask = (
  overrides: Record<string, unknown> = {},
  container: Record<string, unknown> = {},
) => ({
  tasks: [
    {
      lastStatus: 'STOPPED',
      stopCode: 'EssentialContainerExited',
      stoppedReason: 'Essential container in task exited',
      containers: [{ name: 'migrate', lastStatus: 'STOPPED', exitCode: 0, ...container }],
      ...overrides,
    },
  ],
  failures: [],
});

describe('judgeRunTask', () => {
  it('returns the ARN of the one started task', () => {
    expect(judgeRunTask({ tasks: [{ taskArn: 'arn:aws:ecs:x:1:task/c/abc' }], failures: [] })).toBe(
      'arn:aws:ecs:x:1:task/c/abc',
    );
  });
  it.each([
    ['no task', { tasks: [], failures: [] }],
    ['two tasks', { tasks: [{ taskArn: 'a' }, { taskArn: 'b' }], failures: [] }],
    ['a failure', { tasks: [], failures: [{ reason: 'RESOURCE:FARGATE' }] }],
    ['a failure beside a task', { tasks: [{ taskArn: 'a' }], failures: [{ reason: 'MISSING' }] }],
    ['a task without ARN', { tasks: [{}], failures: [] }],
    ['not an object', 'x'],
  ])('refuses %s', (_name, output) => {
    expect(() => judgeRunTask(output)).toThrow(DeployCheckError);
  });
});

describe('judgeMigrationTask', () => {
  it('accepts a stopped task whose only container exited with 0', () => {
    expect(judgeMigrationTask(stoppedTask())).toMatch(/exit code 0/);
  });

  it.each([
    ['a non-zero exit code', stoppedTask({}, { exitCode: 1 }), /exited with code 1/],
    ['exit code 137', stoppedTask({}, { exitCode: 137 }), /code 137/],
    [
      'a missing exit code',
      stoppedTask({}, { exitCode: undefined, reason: 'CannotPullContainerError' }),
      /no exit code/,
    ],
    ['a null exit code', stoppedTask({}, { exitCode: null }), /no exit code/],
    [
      'an exit code that is a string',
      stoppedTask({}, { exitCode: '0' }),
      /exited with code 0|code/,
    ],
    [
      'a task that failed to start',
      stoppedTask(
        { stopCode: 'TaskFailedToStart', stoppedReason: 'ResourceInitializationError' },
        { exitCode: undefined },
      ),
      /stop code TaskFailedToStart/,
    ],
    [
      'a task stopped by a person',
      stoppedTask({ stopCode: 'UserInitiated' }),
      /stop code UserInitiated/,
    ],
    ['a task without a stop code', stoppedTask({ stopCode: undefined }), /stop code/],
    ['a task that is still running', stoppedTask({ lastStatus: 'RUNNING' }), /not stopped/],
    ['a failure entry', { tasks: [], failures: [{ arn: 'x', reason: 'MISSING' }] }, /MISSING/],
    ['no task', { tasks: [], failures: [] }, /exactly one task/],
    [
      'two containers',
      {
        tasks: [
          {
            lastStatus: 'STOPPED',
            stopCode: 'EssentialContainerExited',
            containers: [
              { name: 'migrate', exitCode: 0 },
              { name: 'sidecar', exitCode: 0 },
            ],
          },
        ],
        failures: [],
      },
      /exactly one container/,
    ],
    ['no container', stoppedTask({ containers: [] }), /exactly one container/],
  ])('refuses %s', (_name, output, message) => {
    expect(() => judgeMigrationTask(output)).toThrow(DeployCheckError);
    expect(() => judgeMigrationTask(output)).toThrow(message);
  });
});

const NEW_ARN = 'arn:aws:ecs:ap-south-1:111111111111:task-definition/labconnect-uat-api:8';
const OLD_ARN = 'arn:aws:ecs:ap-south-1:111111111111:task-definition/labconnect-uat-api:7';
const SERVICE = 'labconnect-uat-api';

const deployment = (overrides: Record<string, unknown> = {}) => ({
  status: 'PRIMARY',
  taskDefinition: NEW_ARN,
  rolloutState: 'COMPLETED',
  desiredCount: 1,
  runningCount: 1,
  pendingCount: 0,
  ...overrides,
});
const service = (deployments: unknown[], overrides: Record<string, unknown> = {}) => ({
  services: [
    {
      serviceName: SERVICE,
      status: 'ACTIVE',
      desiredCount: 1,
      runningCount: 1,
      pendingCount: 0,
      deployments,
      ...overrides,
    },
  ],
  failures: [],
});
const expected = { service: SERVICE, taskDefinition: NEW_ARN };

describe('judgeRollout', () => {
  it('accepts a completed rollout of the new task definition', () => {
    expect(judgeRollout(service([deployment()]), expected)).toMatch(/COMPLETED/);
  });

  it('refuses a service that rolled back to the old task definition (the circuit breaker)', () => {
    // After a rollback ECS makes the old version the primary deployment again, and the
    // failed one is INACTIVE. The service is "stable", and runs the OLD image.
    const rolledBack = service([
      deployment({ taskDefinition: OLD_ARN }),
      deployment({ status: 'INACTIVE', rolloutState: 'FAILED', runningCount: 0 }),
    ]);
    expect(() => judgeRollout(rolledBack, expected)).toThrow(/rolled back/);
    const onlyOld = service([deployment({ taskDefinition: OLD_ARN })]);
    expect(() => judgeRollout(onlyOld, expected)).toThrow(/rolled back/);
  });

  it.each([
    [
      'a rollout in progress',
      service([deployment({ rolloutState: 'IN_PROGRESS' })]),
      /IN_PROGRESS/,
    ],
    [
      'a failed rollout',
      service([deployment({ rolloutState: 'FAILED', rolloutStateReason: 'tasks failed' })]),
      /FAILED.*tasks failed/,
    ],
    [
      'a missing rollout state',
      service([deployment({ rolloutState: undefined })]),
      /not COMPLETED/,
    ],
    [
      'an old deployment that is still active',
      service([deployment(), deployment({ status: 'ACTIVE', taskDefinition: OLD_ARN })]),
      /more than one deployment/,
    ],
    ['two primary deployments', service([deployment(), deployment()]), /exactly one PRIMARY/],
    ['no primary deployment', service([deployment({ status: 'ACTIVE' })]), /exactly one PRIMARY/],
    ['no deployments', service([]), /no deployments/],
    ['fewer running than desired', service([deployment()], { runningCount: 0 }), /0 of 1/],
    ['a task still pending', service([deployment()], { pendingCount: 1 }), /pending/],
    [
      'the new deployment short of tasks',
      service([deployment({ runningCount: 0 })]),
      /does not run all/,
    ],
    [
      'no desired tasks',
      service([deployment({ desiredCount: 0, runningCount: 0 })], {
        desiredCount: 0,
        runningCount: 0,
      }),
      /no desired tasks/,
    ],
    ['a service that is draining', service([deployment()], { status: 'DRAINING' }), /not ACTIVE/],
    [
      'another service',
      service([deployment()], { serviceName: 'labconnect-uat-worker' }),
      /not for/,
    ],
    ['a failure entry', { services: [], failures: [{ reason: 'MISSING' }] }, /MISSING/],
    ['no service', { services: [], failures: [] }, /exactly one service/],
  ])('refuses %s', (_name, output, message) => {
    expect(() => judgeRollout(output, expected)).toThrow(DeployCheckError);
    expect(() => judgeRollout(output, expected)).toThrow(message);
  });
});

describe('imageExists', () => {
  it('is true when ECR returned the image', () => {
    expect(imageExists({ images: [{ imageTag: 'x' }], failures: [] })).toBe(true);
  });
  it('is false only for ImageNotFound', () => {
    expect(imageExists({ images: [], failures: [{ failureCode: 'ImageNotFound' }] })).toBe(false);
  });
  it.each([
    ['another failure code', { images: [], failures: [{ failureCode: 'MissingDigestAndTag' }] }],
    ['an empty answer', { images: [], failures: [] }],
    ['an image and a failure', { images: [{}], failures: [{ failureCode: 'ImageNotFound' }] }],
    ['not an object', null],
  ])('refuses %s instead of guessing', (_name, output) => {
    expect(() => imageExists(output)).toThrow(DeployCheckError);
  });
});

describe('readStackOutputs', () => {
  const stack = (outputs: unknown) => ({ Stacks: [{ Outputs: outputs }] });
  const outputs = [
    { OutputKey: 'ClusterName', OutputValue: 'labconnect-uat' },
    {
      OutputKey: 'PrivateSubnetIds',
      OutputValue: 'subnet-0123456789abcdef0,subnet-0fedcba9876543210',
    },
  ];
  it('returns the named outputs', () => {
    expect(readStackOutputs(stack(outputs), ['ClusterName', 'PrivateSubnetIds'])).toEqual({
      ClusterName: 'labconnect-uat',
      PrivateSubnetIds: 'subnet-0123456789abcdef0,subnet-0fedcba9876543210',
    });
  });
  it('refuses a missing output, a duplicate, and values a shell or env file could misread', () => {
    expect(() => readStackOutputs(stack(outputs), ['Nope'])).toThrow(/no single output/);
    expect(() => readStackOutputs(stack([...outputs, outputs[0]]), ['ClusterName'])).toThrow(
      /no single/,
    );
    for (const bad of ['a b', 'a\nB=c', 'a$(x)', 'a;b', '"a"', '']) {
      expect(() =>
        readStackOutputs(stack([{ OutputKey: 'ClusterName', OutputValue: bad }]), ['ClusterName']),
      ).toThrow(/unexpected characters/);
    }
    expect(() => readStackOutputs({ Stacks: [] }, ['ClusterName'])).toThrow(/exactly one stack/);
    expect(() => readStackOutputs({ Stacks: [{}] }, ['ClusterName'])).toThrow(/no outputs/);
  });
});

describe('healthUrl and judgeHealth', () => {
  it('appends /v1/health to an origin', () => {
    expect(healthUrl('https://api.uat.example')).toBe('https://api.uat.example/v1/health');
    expect(healthUrl('http://labconnect-uat-123.ap-south-1.elb.amazonaws.com/')).toBe(
      'http://labconnect-uat-123.ap-south-1.elb.amazonaws.com/v1/health',
    );
    expect(healthUrl('http://localhost:3001')).toBe('http://localhost:3001/v1/health');
  });
  it.each([
    'api.uat.example',
    'ftp://api.uat.example',
    'https://user:pass@api.uat.example',
    'https://api.uat.example/path',
    'https://api.uat.example?x=1',
    'https://api.uat.example\nX: y',
    'https://api.uat.example --output /etc/passwd',
    '',
  ])('refuses the base URL %j', (base) => {
    expect(() => healthUrl(base)).toThrow(DeployCheckError);
  });
  it('accepts 200 with {"status":"ok"} only', () => {
    expect(judgeHealth(200, '{"status":"ok"}')).toMatch(/200/);
    expect(judgeHealth(200, ' {"status":"ok"}\n')).toMatch(/200/);
    for (const [status, body] of [
      [503, '{"status":"ok"}'],
      [0, ''],
      [200, ''],
      [200, 'ok'],
      [200, '{"status":"degraded"}'],
      [200, '{"status":"ok","extra":1}'],
      [200, '[]'],
      [200, 'null'],
    ] as [number, string][]) {
      expect(() => judgeHealth(status, body)).toThrow(DeployCheckError);
    }
  });
});

function cli(
  args: string[],
  input: unknown,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('command line', () => {
  it('prints the register input as JSON', () => {
    const result = cli(
      [
        'task-definition-input',
        '--container',
        'api',
        '--tag',
        NEW_TAG,
        '--repository',
        'labconnect/api',
      ],
      described(),
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { containerDefinitions: { image: string }[] };
    expect(parsed.containerDefinitions[0]?.image).toBe(`${REGISTRY}/labconnect/api:${NEW_TAG}`);
  });

  it('exits 1 with the reason on stderr when a check fails, 0 when it passes', () => {
    const bad = cli(['migration-result'], stoppedTask({}, { exitCode: 2 }));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/^FAILED: .*code 2/);
    expect(cli(['migration-result'], stoppedTask()).status).toBe(0);
    const rolledBack = cli(
      ['rollout-result', '--service', SERVICE, '--task-definition', NEW_ARN],
      service([deployment({ taskDefinition: OLD_ARN })]),
    );
    expect(rolledBack.status).toBe(1);
    const fine = cli(
      ['rollout-result', '--service', SERVICE, '--task-definition', NEW_ARN],
      service([deployment()]),
    );
    expect(fine.status).toBe(0);
  });

  it('prints the stack outputs as environment lines', () => {
    const outputs = [
      ['ClusterName', 'labconnect-uat'],
      ['MigrateTaskFamily', 'labconnect-uat-migrate'],
      ['PrivateSubnetIds', 'subnet-1,subnet-2'],
      ['MigrateSecurityGroupId', 'sg-123'],
    ].map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue }));
    const result = cli(['stack-outputs'], { Stacks: [{ Outputs: outputs }] });
    expect(result.stdout.trim().split('\n')).toEqual([
      'CLUSTER_NAME=labconnect-uat',
      'MIGRATE_FAMILY=labconnect-uat-migrate',
      'PRIVATE_SUBNET_IDS=subnet-1,subnet-2',
      'MIGRATE_SECURITY_GROUP_ID=sg-123',
    ]);
  });

  it('answers image-exists, health-url and health-check', () => {
    expect(
      cli(['image-exists'], {
        images: [],
        failures: [{ failureCode: 'ImageNotFound' }],
      }).stdout.trim(),
    ).toBe('false');
    expect(cli(['health-url', '--base', 'https://api.uat.example'], '').stdout.trim()).toBe(
      'https://api.uat.example/v1/health',
    );
    expect(cli(['health-check', '--status', '200'], '{"status":"ok"}').status).toBe(0);
    expect(cli(['health-check', '--status', '502'], '').status).toBe(1);
  });

  it('exits 2 on unusable input or arguments', () => {
    expect(cli(['migration-result'], 'not json').status).toBe(2);
    expect(cli(['nope'], '').status).toBe(2);
    expect(cli(['rollout-result', '--service', SERVICE], service([])).status).toBe(2);
    expect(cli(['migration-result', '--bogus'], stoppedTask()).status).toBe(2);
  });
});
