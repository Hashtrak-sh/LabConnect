import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import type { InfraConfig } from '../config.js';
import { namesFor } from '../names.js';

export interface DeliveryStackProps extends cdk.StackProps {
  config: InfraConfig;
}

/** Services whose images are built (the web app is still a skeleton: no image yet). */
export const IMAGE_SERVICES = ['api', 'worker', 'migrate'] as const;
export type ImageService = (typeof IMAGE_SERVICES)[number];

/** The container roles' physical names, so this stack can name them in `iam:PassRole` without depending on compute. */
export function taskRoleNames(config: InfraConfig): string[] {
  const names = namesFor(config);
  return ['api', 'worker', 'migrate'].flatMap((service) => [
    names.roleName(`${service}-task`),
    names.roleName(`${service}-exec`),
  ]);
}

/**
 * Delivery: the image repositories and the way GitHub Actions gets into the account
 * (CI_CD.md, `deploy-uat.yml`): an OIDC identity provider and a role (`uat-deployer`) that only
 * this repository's workflows, running in the `uat` GitHub environment, can assume. No
 * access keys exist anywhere.
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

    // `cdk deploy`: the CDK bootstrap stack's roles do the CloudFormation work. This role can
    // only hand over to them. Their reach is the CloudFormation execution role chosen at
    // bootstrap (infrastructure/README.md).
    const q = config.cdkQualifier;
    const bootstrapRole = (kind: string): string =>
      stack.formatArn({
        service: 'iam',
        region: '',
        resource: 'role',
        resourceName: `cdk-${q}-${kind}-role-${stack.account}-${stack.region}`,
      });
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: ['deploy', 'file-publishing', 'image-publishing', 'lookup'].map(bootstrapRole),
      }),
    );

    // Images: push to the three repositories.
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
    // migration task, read what it logged.
    const cluster = names.clusterName;
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcsTaskDefinitions',
        // These actions do not support resource-level permissions.
        actions: [
          'ecs:RegisterTaskDefinition',
          'ecs:DescribeTaskDefinition',
          'ecs:DeregisterTaskDefinition',
        ],
        resources: ['*'],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcsServices',
        actions: ['ecs:UpdateService', 'ecs:DescribeServices'],
        resources: ['api', 'worker'].map((service) =>
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
        actions: ['ecs:DescribeTasks', 'ecs:StopTask'],
        resources: [arn('ecs', 'task', `${cluster}/*`)],
      }),
    );
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcsListTasks',
        actions: ['ecs:ListTasks'],
        resources: ['*'],
        conditions: { ArnEquals: { 'ecs:cluster': arn('ecs', 'cluster', cluster) } },
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
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadTaskLogs',
        actions: ['logs:GetLogEvents', 'logs:FilterLogEvents', 'logs:DescribeLogStreams'],
        resources: [
          stack.formatArn({
            service: 'logs',
            resource: 'log-group',
            resourceName: `/labconnect/${config.stage}/*`,
            arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
          }),
          stack.formatArn({
            service: 'logs',
            resource: 'log-group',
            resourceName: `/labconnect/${config.stage}/*:log-stream:*`,
            arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
          }),
        ],
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
