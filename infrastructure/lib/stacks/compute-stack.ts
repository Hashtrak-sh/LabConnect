import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';
import { type InfraConfig, apiHost, senderParts } from '../config.js';
import {
  API_PORT,
  FILES_CLEAN_PREFIX,
  FILES_QUARANTINE_PREFIX,
  QUEUE_NAMES,
  type QueueKey,
  namesFor,
  queueUrlVariable,
} from '../names.js';
import { logRetention } from '../retention.js';
import type { AppSecrets, DataStack } from './data-stack.js';
import type { DeliveryStack } from './delivery-stack.js';
import type { EdgeStack } from './edge-stack.js';
import type { MessagingStack } from './messaging-stack.js';
import type { NetworkStack } from './network-stack.js';

export interface ComputeStackProps extends cdk.StackProps {
  config: InfraConfig;
  network: NetworkStack;
  data: DataStack;
  messaging: MessagingStack;
  edge: EdgeStack;
  delivery: DeliveryStack;
}

/** Queues the worker takes messages from (it publishes to all five). */
const WORKER_CONSUMES: readonly QueueKey[] = ['files', 'notifications', 'searchSync'];

/**
 * Compute: the ECS cluster, the API behind the load balancer, the worker, and the one-off
 * migration task (`prisma migrate deploy`, the two login users, the reference seed) that CI
 * runs before it rolls the services (CI_CD.md, `deploy-uat.yml`).
 *
 * The web application is not here: `apps/web` is a skeleton with no pages to serve yet.
 */
export class ComputeStack extends cdk.Stack {
  readonly cluster: ecs.Cluster;
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  readonly apiService: ecs.FargateService;
  readonly workerService: ecs.FargateService;
  readonly apiTaskDefinition: ecs.FargateTaskDefinition;
  readonly workerTaskDefinition: ecs.FargateTaskDefinition;
  readonly migrateTaskDefinition: ecs.FargateTaskDefinition;
  readonly apiTaskRole: iam.Role;
  readonly workerTaskRole: iam.Role;
  readonly logGroups: Record<'api' | 'worker' | 'migrate', logs.LogGroup>;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);
    const { config, network, data, messaging, edge, delivery } = props;
    const names = namesFor(config);
    const stack = cdk.Stack.of(this);
    // The secrets are imported by ARN. Granting on the originals would edit the key policy of
    // the data stack (a dependency from data to compute, which is a cycle); the key access the
    // execution roles need is written below instead.
    const imported = (secret: secretsmanager.ISecret, name: string): secretsmanager.ISecret =>
      secretsmanager.Secret.fromSecretCompleteArn(this, `Imported${name}`, secret.secretArn);
    const original = data.secrets;
    const secrets: AppSecrets = {
      apiDatabaseUrl: imported(original.apiDatabaseUrl, 'ApiDatabaseUrl'),
      workerDatabaseUrl: imported(original.workerDatabaseUrl, 'WorkerDatabaseUrl'),
      ownerDatabaseUrl: imported(original.ownerDatabaseUrl, 'OwnerDatabaseUrl'),
      apiLogin: imported(original.apiLogin, 'ApiLogin'),
      workerLogin: imported(original.workerLogin, 'WorkerLogin'),
      authJwtPrivateKey: imported(original.authJwtPrivateKey, 'AuthJwtPrivateKey'),
      authHashSecret: imported(original.authHashSecret, 'AuthHashSecret'),
      authEncryptionKey: imported(original.authEncryptionKey, 'AuthEncryptionKey'),
      paymentPayloadEncryptionKey: imported(
        original.paymentPayloadEncryptionKey,
        'PaymentPayloadEncryptionKey',
      ),
      paymentFakeWebhookSecret: imported(
        original.paymentFakeWebhookSecret,
        'PaymentFakeWebhookSecret',
      ),
      openSearchLogin:
        original.openSearchLogin === undefined
          ? undefined
          : imported(original.openSearchLogin, 'OpenSearchLogin'),
    };

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: names.clusterName,
      vpc: network.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const logGroup = (service: 'api' | 'worker' | 'migrate'): logs.LogGroup =>
      new logs.LogGroup(this, `${service}Logs`, {
        logGroupName: names.logGroup(service),
        retention: logRetention(config),
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });
    this.logGroups = {
      api: logGroup('api'),
      worker: logGroup('worker'),
      migrate: logGroup('migrate'),
    };

    // ---- load balancer (created before the environment so that the web origin is known)
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: network.vpc,
      internetFacing: true,
      securityGroup: network.albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      dropInvalidHeaderFields: true,
      // No access logs: the request line would record query strings (device location, OQ-40).
    });
    const host = apiHost(config);
    const webOrigin =
      config.domainName === undefined
        ? `http://${this.loadBalancer.loadBalancerDnsName}`
        : `https://${config.domainName}`;

    // ---- environment: every variable of .env.example that a deployed process needs. The
    // table is in infrastructure/README.md; test/runtime-env.test.ts keeps it complete.
    const sender = senderParts(config.sesFromAddress);
    const sharedEnvironment: Record<string, string> = {
      NODE_ENV: 'production',
      // UAT is a deployed environment where the fake payment gateway may run (OQ-133).
      APP_ENV: config.stage,
      AWS_REGION: stack.region,
      // Nest's default logger colours its output unless this is set; the log filters match plain text.
      NO_COLOR: '1',
      MAIL_FROM: config.sesFromAddress,
      FILES_BUCKET: data.filesBucket.bucketName,
      FILES_QUARANTINE_PREFIX,
      FILES_CLEAN_PREFIX,
      // The only gateway there is (OQ-01). No real gateway has a variable, a secret or a resource here.
      PAYMENT_GATEWAY: 'fake',
    };
    const sharedSecrets: Record<string, ecs.Secret> = {
      PAYMENT_PAYLOAD_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(
        secrets.paymentPayloadEncryptionKey,
      ),
      PAYMENT_FAKE_WEBHOOK_SECRET: ecs.Secret.fromSecretsManager(secrets.paymentFakeWebhookSecret),
    };
    const searchEnvironment: Record<string, string> =
      data.openSearchUrl === undefined
        ? {}
        : {
            OPENSEARCH_URL: data.openSearchUrl,
            OPENSEARCH_AUTH_MODE: 'basic',
          };
    const searchSecrets: Record<string, ecs.Secret> =
      secrets.openSearchLogin === undefined
        ? {}
        : {
            OPENSEARCH_USERNAME: ecs.Secret.fromSecretsManager(secrets.openSearchLogin, 'username'),
            OPENSEARCH_PASSWORD: ecs.Secret.fromSecretsManager(secrets.openSearchLogin, 'password'),
          };

    // Mail goes through SES from both processes: the worker's notifications and the API's
    // sign-in code (the same sender and configuration set, OQ-172).
    const mailEnvironment: Record<string, string> = {
      EMAIL_TRANSPORT: 'ses',
      SES_FROM_ADDRESS: config.sesFromAddress,
      SES_CONFIGURATION_SET: names.sesConfigurationSet,
    };
    const apiEnvironment: Record<string, string> = {
      ...sharedEnvironment,
      ...mailEnvironment,
      PORT: String(API_PORT),
      // The load balancer is the only proxy in front of the API (OQ-89). Behind CloudFront too: 2.
      API_TRUST_PROXY_HOPS: '1',
      AUTH_ALLOWED_ORIGINS: webOrigin,
      AUTH_JWT_KEY_ID: 'k1',
      ...searchEnvironment,
    };
    const apiSecrets: Record<string, ecs.Secret> = {
      ...sharedSecrets,
      ...searchSecrets,
      API_DATABASE_URL: ecs.Secret.fromSecretsManager(secrets.apiDatabaseUrl),
      AUTH_JWT_PRIVATE_KEY: ecs.Secret.fromSecretsManager(secrets.authJwtPrivateKey),
      AUTH_HASH_SECRET: ecs.Secret.fromSecretsManager(secrets.authHashSecret),
      AUTH_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(secrets.authEncryptionKey),
    };

    const queueUrls: Record<string, string> = {};
    for (const key of Object.keys(QUEUE_NAMES) as QueueKey[]) {
      queueUrls[queueUrlVariable(QUEUE_NAMES[key])] = messaging.queues[key].queue.queueUrl;
    }
    const workerEnvironment: Record<string, string> = {
      ...sharedEnvironment,
      ...queueUrls,
      ...searchEnvironment,
      FILES_KMS_KEY_ID: data.filesKey.keyArn,
      // Scan results come from GuardDuty only; "fake" is refused outside development and test.
      FILES_SCANNER: 'guardduty',
      ...mailEnvironment,
      WEB_BASE_URL: webOrigin,
      NOTIFICATIONS_CONTEXT_SOURCE: 'booking',
      ...(data.openSearchUrl === undefined ? {} : { SEARCH_REINDEX_ON_START: 'true' }),
    };
    const workerSecrets: Record<string, ecs.Secret> = {
      ...sharedSecrets,
      ...searchSecrets,
      WORKER_DATABASE_URL: ecs.Secret.fromSecretsManager(secrets.workerDatabaseUrl),
    };

    // ---- roles. Least privilege, and different for the two services.
    const bucketArn = data.filesBucket.bucketArn;
    const filesKeyViaS3: iam.PolicyStatement = new iam.PolicyStatement({
      sid: 'FilesKey',
      actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
      resources: [data.filesKey.keyArn],
      conditions: { StringEquals: { 'kms:ViaService': `s3.${stack.region}.amazonaws.com` } },
    });
    const role = (service: string, description: string): iam.Role =>
      new iam.Role(this, `${service}TaskRole`, {
        roleName: names.roleName(`${service}-task`),
        description,
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com', {
          conditions: { StringEquals: { 'aws:SourceAccount': stack.account } },
        }),
      });
    const executionRole = (service: string): iam.Role => {
      const created = new iam.Role(this, `${service}ExecutionRole`, {
        roleName: names.roleName(`${service}-exec`),
        description: `ECS agent of ${service}: pulls the image, writes logs, injects secrets`,
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com', {
          conditions: { StringEquals: { 'aws:SourceAccount': stack.account } },
        }),
      });
      // The secrets are encrypted with the data key. Which secrets each role may read is
      // decided by what its task definition lists (the grants are added with the secrets).
      created.addToPolicy(
        new iam.PolicyStatement({
          sid: 'DecryptSecrets',
          actions: ['kms:Decrypt'],
          resources: [data.dataKey.keyArn],
          conditions: {
            StringEquals: { 'kms:ViaService': `secretsmanager.${stack.region}.amazonaws.com` },
          },
        }),
      );
      return created;
    };

    // The one mail permission both roles hold: send from the configured sender address, its
    // domain and the configuration set, and nothing else (no wildcard, no other identity).
    const sendMailResources = [
      stack.formatArn({ service: 'ses', resource: 'identity', resourceName: sender.address }),
      stack.formatArn({ service: 'ses', resource: 'identity', resourceName: sender.domain }),
      stack.formatArn({
        service: 'ses',
        resource: 'configuration-set',
        resourceName: names.sesConfigurationSet,
      }),
    ];

    // API: presigns uploads into quarantine/ and downloads from clean/. It signs; S3 checks
    // the signer's permissions when the URL is used. It never touches a queue or reads
    // quarantined objects. Its only mail is the sign-in code (SES, the worker's resources).
    this.apiTaskRole = role('api', 'LabConnect API container');
    this.apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PresignUpload',
        actions: ['s3:PutObject'],
        resources: [`${bucketArn}/${FILES_QUARANTINE_PREFIX}/*`],
      }),
    );
    this.apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PresignDownload',
        actions: ['s3:GetObject'],
        resources: [`${bucketArn}/${FILES_CLEAN_PREFIX}/*`],
      }),
    );
    this.apiTaskRole.addToPolicy(filesKeyViaS3);
    this.apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SendSignInMail',
        actions: ['ses:SendEmail'],
        resources: sendMailResources,
      }),
    );

    // Worker: outbox relay (sends to every queue), consumers (files, notifications, search),
    // the scan result processor (reads and deletes quarantined objects, writes clean ones),
    // and the e-mail sender.
    this.workerTaskRole = role('worker', 'LabConnect worker container');
    this.workerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PublishEvents',
        actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
        resources: Object.values(messaging.queues).map((pair) => pair.queue.queueArn),
      }),
    );
    this.workerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ConsumeEvents',
        actions: [
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:ChangeMessageVisibility',
          'sqs:GetQueueAttributes',
        ],
        resources: WORKER_CONSUMES.map((key) => messaging.queues[key].queue.queueArn),
      }),
    );
    this.workerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        // The queues are encrypted with the messaging key. SQS uses it on the caller's behalf:
        // a sender needs both actions, a receiver needs Decrypt (SQS Developer Guide, "Key
        // management"). Without this statement every send and receive is refused.
        sid: 'QueueKey',
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: [messaging.messagingKey.keyArn],
        conditions: { StringEquals: { 'kms:ViaService': `sqs.${stack.region}.amazonaws.com` } },
      }),
    );
    this.workerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadAndRemoveQuarantine',
        actions: ['s3:GetObject', 's3:DeleteObject'],
        resources: [`${bucketArn}/${FILES_QUARANTINE_PREFIX}/*`],
      }),
    );
    this.workerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WriteClean',
        actions: ['s3:PutObject'],
        resources: [`${bucketArn}/${FILES_CLEAN_PREFIX}/*`],
      }),
    );
    this.workerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        // Without it, S3 answers 403 instead of 404 for a missing object, and the processor
        // could not tell "already deleted" from "not allowed".
        sid: 'ListBucketForNotFound',
        actions: ['s3:ListBucket'],
        resources: [bucketArn],
      }),
    );
    this.workerTaskRole.addToPolicy(filesKeyViaS3);
    this.workerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SendMail',
        actions: ['ses:SendEmail'],
        resources: sendMailResources,
      }),
    );

    const migrateTaskRole = role(
      'migrate',
      'One-off migration and seed task: no AWS access of its own',
    );

    // ---- task definitions
    const ecrImage = (service: 'api' | 'worker' | 'migrate', tag: string): ecs.ContainerImage =>
      ecs.ContainerImage.fromEcrRepository(delivery.repositories[service], tag);
    const taskDefinition = (
      service: 'api' | 'worker' | 'migrate',
      taskRole: iam.Role,
      cpu: number,
      memoryLimitMiB: number,
    ): ecs.FargateTaskDefinition =>
      new ecs.FargateTaskDefinition(this, `${service}Task`, {
        family: names.serviceName(service),
        cpu,
        memoryLimitMiB,
        taskRole,
        executionRole: executionRole(service),
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
    const logging = (service: 'api' | 'worker' | 'migrate'): ecs.LogDriver =>
      ecs.LogDriver.awsLogs({ logGroup: this.logGroups[service], streamPrefix: service });

    this.apiTaskDefinition = taskDefinition(
      'api',
      this.apiTaskRole,
      config.apiCpu,
      config.apiMemoryMiB,
    );
    this.apiTaskDefinition.addContainer('api', {
      image: ecrImage('api', config.apiImageTag),
      portMappings: [{ containerPort: API_PORT }],
      environment: apiEnvironment,
      secrets: apiSecrets,
      logging: logging('api'),
      healthCheck: {
        // The slim image has no curl; Node 24 has fetch.
        command: [
          'CMD-SHELL',
          `node -e "fetch('http://127.0.0.1:${String(API_PORT)}/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`,
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
      stopTimeout: cdk.Duration.seconds(30),
    });

    this.workerTaskDefinition = taskDefinition(
      'worker',
      this.workerTaskRole,
      config.workerCpu,
      config.workerMemoryMiB,
    );
    // The worker has no port to check. ECS restarts it when the process exits.
    this.workerTaskDefinition.addContainer('worker', {
      image: ecrImage('worker', config.workerImageTag),
      environment: workerEnvironment,
      secrets: workerSecrets,
      logging: logging('worker'),
      stopTimeout: cdk.Duration.seconds(30),
    });

    // Migration, login users, reference data: run as the schema owner (the RDS master user),
    // in this order, stopping at the first failure. Idempotent, so CI can run it on every deploy.
    this.migrateTaskDefinition = taskDefinition('migrate', migrateTaskRole, 512, 1024);
    this.migrateTaskDefinition.addContainer('migrate', {
      image: ecrImage('migrate', config.migrateImageTag),
      command: [
        'sh',
        '-c',
        'set -e; ./node_modules/.bin/prisma migrate deploy; node create-login-users.mjs; node dist/seed/cli.js reference',
      ],
      workingDirectory: '/app/packages/database',
      environment: {
        NODE_ENV: 'production',
        APP_ENV: config.stage,
        NO_COLOR: '1',
        // The reference seed records these in qr_signing_key and refuses to run without them.
        QR_KMS_KEY_ARN_BOOKING: data.qrKeys.BOOKING.keyArn,
        QR_KMS_KEY_ARN_PACKAGE: data.qrKeys.PACKAGE.keyArn,
        QR_KMS_KEY_ARN_REPORT: data.qrKeys.REPORT.keyArn,
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(secrets.ownerDatabaseUrl),
        API_DB_USER: ecs.Secret.fromSecretsManager(secrets.apiLogin, 'username'),
        API_DB_PASSWORD: ecs.Secret.fromSecretsManager(secrets.apiLogin, 'password'),
        WORKER_DB_USER: ecs.Secret.fromSecretsManager(secrets.workerLogin, 'username'),
        WORKER_DB_PASSWORD: ecs.Secret.fromSecretsManager(secrets.workerLogin, 'password'),
      },
      logging: logging('migrate'),
    });

    // ---- services
    const subnets: ec2.SubnetSelection = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };
    this.apiService = new ecs.FargateService(this, 'ApiService', {
      serviceName: names.serviceName('api'),
      cluster: this.cluster,
      taskDefinition: this.apiTaskDefinition,
      desiredCount: config.apiDesiredCount,
      securityGroups: [network.apiSecurityGroup],
      vpcSubnets: subnets,
      assignPublicIp: false,
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      enableExecuteCommand: false,
    });
    this.workerService = new ecs.FargateService(this, 'WorkerService', {
      serviceName: names.serviceName('worker'),
      cluster: this.cluster,
      taskDefinition: this.workerTaskDefinition,
      desiredCount: config.workerDesiredCount,
      securityGroups: [network.workerSecurityGroup],
      vpcSubnets: subnets,
      assignPublicIp: false,
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      enableExecuteCommand: false,
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTargets', {
      vpc: network.vpc,
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [this.apiService],
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        path: '/v1/health',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });
    if (edge.certificate === undefined) {
      // No domain, so no certificate: plain HTTP to the listed client ranges only.
      this.loadBalancer.addListener('Http', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        open: false,
        defaultTargetGroups: [targetGroup],
      });
    } else {
      this.loadBalancer.addListener('Https', {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificates: [edge.certificate],
        // TLS 1.3 with TLS 1.2 fallback only (AWS_ENVIRONMENTS_AND_DEPLOYMENT.md section 4).
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        open: false,
        defaultTargetGroups: [targetGroup],
      });
      this.loadBalancer.addListener('HttpRedirect', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        open: false,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });
    }

    new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
      resourceArn: this.loadBalancer.loadBalancerArn,
      webAclArn: edge.webAcl.attrArn,
    });

    if (host !== undefined && edge.hostedZone !== undefined) {
      new route53.ARecord(this, 'ApiAlias', {
        zone: edge.hostedZone,
        recordName: host,
        target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(this.loadBalancer)),
      });
    }

    // What CI needs to run the migration task by hand (README: "Deploying").
    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, 'MigrateTaskFamily', { value: names.serviceName('migrate') });
    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: network.vpc.selectSubnets(subnets).subnetIds.join(','),
    });
    new cdk.CfnOutput(this, 'MigrateSecurityGroupId', {
      value: network.migrateSecurityGroup.securityGroupId,
    });
    new cdk.CfnOutput(this, 'LoadBalancerDnsName', {
      value: this.loadBalancer.loadBalancerDnsName,
    });
  }
}
