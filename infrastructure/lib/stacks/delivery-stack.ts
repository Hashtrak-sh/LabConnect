import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import type { InfraConfig } from '../config.js';
import { namesFor, stackName } from '../names.js';

export interface DeliveryStackProps extends cdk.StackProps {
  config: InfraConfig;
}

/** Services whose images are built (Dockerfile targets of the same names). */
export const IMAGE_SERVICES = ['api', 'worker', 'migrate', 'web'] as const;
export type ImageService = (typeof IMAGE_SERVICES)[number];

/** The container roles' physical names, so this stack can name them in `iam:PassRole` without depending on compute. */
export function taskRoleNames(config: InfraConfig): string[] {
  const names = namesFor(config);
  return IMAGE_SERVICES.flatMap((service) => [
    names.roleName(`${service}-task`),
    names.roleName(`${service}-exec`),
  ]);
}

/**
 * Delivery: the image repositories and the way GitHub Actions gets into the account
 * (CI_CD.md, `deploy-uat.yml`): an OIDC identity provider and a role (`uat-deployer`) that only
 * this repository's workflows, running in the `uat` GitHub environment, can assume. No
 * access keys exist anywhere. The role deploys the application, never the infrastructure.
 */
export class DeliveryStack extends cdk.Stack {
  readonly repositories: Record<ImageService, ecr.Repository>;
  readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: DeliveryStackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config } = props;
    const names = namesFor(config);
    const stack = cdk.Stack.of(this);

    const repositories: Partial<Record<ImageService, ecr.Repository>> = {};
    for (const service of IMAGE_SERVICES) {
      repositories[service] = new ecr.Repository(this, `${service}Repository`, {
        repositoryName: names.ecrRepository(service),
        // Tags never move: the production release promotes the exact digests UAT ran (CI_CD.md).
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        imageScanOnPush: true,
        encryption: ecr.RepositoryEncryption.AES_256,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        lifecycleRules: [{ description: 'Keep the last 100 images', maxImageCount: 100 }],
      });
    }
    this.repositories = repositories as Record<ImageService, ecr.Repository>;

    // ---- GitHub OIDC
    const providerArn =
      config.githubOidcProviderArn ??
      new iam.CfnOIDCProvider(this, 'GithubOidcProvider', {
        url: 'https://token.actions.githubusercontent.com',
        clientIdList: ['sts.amazonaws.com'],
        // AWS validates GitHub's certificate chain itself; no thumbprint is needed.
      }).attrArn;

    this.deployRole = new iam.Role(this, 'DeployRole', {
      roleName: names.deployRoleName,
      description: `GitHub Actions (${config.githubRepository}, environment ${config.stage}) deploys ${config.stage}`,
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          // Exactly this repository and this GitHub environment, nothing else (no wildcard).
          'token.actions.githubusercontent.com:sub': `repo:${config.githubRepository}:environment:${config.stage}`,
        },
      }),
    });

    const arn = (service: string, resource: string, resourceName: string): string =>
      stack.formatArn({
        service,
        resource,
        resourceName,
        arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
      });

    // Not here, on purpose: no `sts:AssumeRole` on the CDK bootstrap roles. The workflow changes
    // the application only (images, task definitions, services); infrastructure is applied by a
    // person with their own credentials, because the bootstrap's CloudFormation role is an
    // administrator by default (OQ-179). What this role can do is exactly what is listed below.

    // Find the targets: the outputs of the compute stack (cluster, migration task family,
    // subnets, security group). One stack, read only. The ARN ends in the stack's id, which
    // is only known once the stack exists, hence the final `*`.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadComputeStackOutputs',
        actions: ['cloudformation:DescribeStacks'],
        resources: [arn('cloudformation', 'stack', `${stackName(config, 'compute')}/*`)],
      }),
    );

    // Images: push to the four repositories.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcrLogin',
        actions: ['ecr:GetAuthorizationToken'],
        // This action does not support resource-level permissions.
        resources: ['*'],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcrPush',
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
          'ecr:CompleteLayerUpload',
          'ecr:DescribeImages',
          'ecr:GetDownloadUrlForLayer',
          'ecr:InitiateLayerUpload',
          'ecr:PutImage',
          'ecr:UploadLayerPart',
        ],
        resources: Object.values(this.repositories).map((repo) => repo.repositoryArn),
      }),
    );

    // Services: register a task definition per image tag, roll the services, run the
    // migration task and see how it ended. Only what `deploy-uat.yml` calls is granted
    // (test/deploy-workflow.test.ts compares the two): the role cannot deregister task
    // definitions, stop or list tasks, or read the log groups. Application logs can hold
    // personal data and the workflow's own log is public, so a person reads them in AWS.
    const cluster = names.clusterName;
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcsTaskDefinitions',
        // These actions do not support resource-level permissions.
        actions: ['ecs:RegisterTaskDefinition', 'ecs:DescribeTaskDefinition'],
        resources: ['*'],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcsServices',
        actions: ['ecs:UpdateService', 'ecs:DescribeServices'],
        resources: ['api', 'worker', 'web'].map((service) =>
          arn('ecs', 'service', `${cluster}/${names.serviceName(service)}`),
        ),
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcsRunMigration',
        actions: ['ecs:RunTask'],
        resources: [arn('ecs', 'task-definition', `${names.serviceName('migrate')}:*`)],
        conditions: { ArnEquals: { 'ecs:cluster': arn('ecs', 'cluster', cluster) } },
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcsWatchTasks',
        actions: ['ecs:DescribeTasks'],
        resources: [arn('ecs', 'task', `${cluster}/*`)],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PassTaskRoles',
        actions: ['iam:PassRole'],
        resources: taskRoleNames(config).map((name) =>
          stack.formatArn({ service: 'iam', region: '', resource: 'role', resourceName: name }),
        ),
        conditions: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } },
      }),
    );
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: this.deployRole.roleArn });
    for (const service of IMAGE_SERVICES) {
      new cdk.CfnOutput(this, `${service}RepositoryUri`, {
        value: this.repositories[service].repositoryUri,
      });
    }
  }
}
