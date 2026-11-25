import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { logRetention } from '../retention.js';
import type { InfraConfig } from '../config.js';
import {
  DATABASE_API_USER,
  DATABASE_NAME,
  DATABASE_OWNER_USER,
  DATABASE_WORKER_USER,
  FILES_QUARANTINE_PREFIX,
  namesFor,
} from '../names.js';
import type { NetworkStack } from './network-stack.js';

export interface DataStackProps extends cdk.StackProps {
  config: InfraConfig;
  network: NetworkStack;
}

/** Secrets the tasks receive as environment variables. The names are the variables' names. */
export interface AppSecrets {
  apiDatabaseUrl: secretsmanager.ISecret;
  workerDatabaseUrl: secretsmanager.ISecret;
  ownerDatabaseUrl: secretsmanager.ISecret;
  /** `{ username, password }` of the two login users, for the migration task that creates them. */
  apiLogin: secretsmanager.ISecret;
  workerLogin: secretsmanager.ISecret;
  authJwtPrivateKey: secretsmanager.ISecret;
  authHashSecret: secretsmanager.ISecret;
  authEncryptionKey: secretsmanager.ISecret;
  paymentPayloadEncryptionKey: secretsmanager.ISecret;
  paymentFakeWebhookSecret: secretsmanager.ISecret;
  /** `{ username, password }`; only when OpenSearch is enabled. */
  openSearchLogin: secretsmanager.ISecret | undefined;
}

/**
 * Data: KMS keys, the PostgreSQL database, the files bucket, the application's secrets and,
 * only when asked for, OpenSearch. Termination protection is on: this stack holds the data.
 */
export class DataStack extends cdk.Stack {
  readonly dataKey: kms.Key;
  readonly filesKey: kms.Key;
  readonly filesBucket: s3.Bucket;
  /** HMAC keys of the verification QR codes, one per purpose (RUNBOOK.md section 6). */
  readonly qrKeys: Record<'BOOKING' | 'PACKAGE' | 'REPORT', kms.Key>;
  readonly database: rds.DatabaseInstance;
  readonly secrets: AppSecrets;
  readonly searchDomain: opensearch.Domain | undefined;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config, network } = props;
    const names = namesFor(config);

    // ---- keys: one per data class that has its own access list (SECURITY_AND_PRIVACY.md section 1)
    this.dataKey = new kms.Key(this, 'DataKey', {
      alias: `alias/${config.prefix}-data`,
      description: 'LabConnect database storage, secrets and search at rest',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pendingWindow: cdk.Duration.days(30),
    });
    this.filesKey = new kms.Key(this, 'FilesKey', {
      alias: `alias/${config.prefix}-files`,
      description: 'LabConnect uploaded and generated files',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pendingWindow: cdk.Duration.days(30),
    });

    // ---- QR signing keys. `seed:reference` records each key's ARN in `qr_signing_key` and fails
    // in a deployed environment without them (MIGRATION_AND_SEED_STRATEGY.md section 1). They
    // are HMAC keys: AWS cannot rotate those automatically, so rotation is the quarterly
    // procedure of RUNBOOK.md section 6 (a new key, a new `qr_signing_key` row). No task role
    // may use them yet: the QR code feature is not built, and its role statements arrive with it.
    const qrKey = (purpose: 'BOOKING' | 'PACKAGE' | 'REPORT'): kms.Key =>
      new kms.Key(this, `QrKey${purpose}`, {
        alias: `alias/${config.prefix}-qr-${purpose.toLowerCase()}-1`,
        description: `HMAC key of ${purpose} verification QR codes`,
        keySpec: kms.KeySpec.HMAC_256,
        keyUsage: kms.KeyUsage.GENERATE_VERIFY_MAC,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        pendingWindow: cdk.Duration.days(30),
      });
    this.qrKeys = { BOOKING: qrKey('BOOKING'), PACKAGE: qrKey('PACKAGE'), REPORT: qrKey('REPORT') };

    // ---- files bucket (FILES_AND_REPORTS.md): uploads land under quarantine/, validated files under clean/
    const webOrigin = config.domainName === undefined ? undefined : `https://${config.domainName}`;
    this.filesBucket = new s3.Bucket(this, 'Files', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.filesKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Versioning binds a scan verdict to the object it scanned (ETag and version id).
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      lifecycleRules: [
        {
          id: 'quarantine-30-days',
          prefix: `${FILES_QUARANTINE_PREFIX}/`,
          expiration: cdk.Duration.days(30),
          noncurrentVersionExpiration: cdk.Duration.days(7),
        },
        {
          id: 'quarantine-delete-markers',
          prefix: `${FILES_QUARANTINE_PREFIX}/`,
          expiredObjectDeleteMarker: true,
        },
        { id: 'abort-multipart', abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
      ],
      // Browser uploads go straight to S3 with a presigned PUT. Without a web origin (no
      // domain yet) there is no browser to allow, so no rule is written.
      cors:
        webOrigin === undefined
          ? []
          : [
              {
                allowedOrigins: [webOrigin],
                allowedMethods: [s3.HttpMethods.PUT],
                allowedHeaders: ['content-type', 'content-length'],
                exposedHeaders: ['ETag'],
                maxAge: 3000,
              },
            ],
    });

    // ---- database
    const ownerLogin = new secretsmanager.Secret(this, 'DbOwnerSecret', {
      secretName: names.secret('db-owner'),
      description: 'RDS master user. Also the schema owner (migrations and seeds only).',
      encryptionKey: this.dataKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: DATABASE_OWNER_USER }),
        generateStringKey: 'password',
        // URL-safe on purpose: the connection URLs below embed it.
        excludePunctuation: true,
        passwordLength: 40,
      },
    });
    const parameterGroup = new rds.ParameterGroup(this, 'DbParameters', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      description: 'LabConnect PostgreSQL 16',
      parameters: {
        // TLS only. Statement logging stays off on purpose: statements carry personal data.
        'rds.force_ssl': '1',
      },
    });
    this.database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      // PostGIS (and pg_trgm, ltree, citext, pgcrypto, btree_gist) are created by the first
      // migration; RDS for PostgreSQL 16 ships them and the master user may create them.
      instanceType: new ec2.InstanceType(config.dbInstanceClass.replace(/^db\./, '')),
      vpc: network.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [network.databaseSecurityGroup],
      credentials: rds.Credentials.fromSecret(ownerLogin, DATABASE_OWNER_USER),
      databaseName: DATABASE_NAME,
      parameterGroup,
      allocatedStorage: config.dbAllocatedStorageGiB,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      storageEncryptionKey: this.dataKey,
      multiAz: false,
      publiclyAccessible: false,
      deletionProtection: true,
      backupRetention: cdk.Duration.days(7),
      copyTagsToSnapshot: true,
      autoMinorVersionUpgrade: true,
      enablePerformanceInsights: true,
      performanceInsightEncryptionKey: this.dataKey,
      cloudwatchLogsExports: ['postgresql', 'upgrade'],
      cloudwatchLogsRetention: logRetention(config),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const login = (id: string, user: string): secretsmanager.Secret =>
      new secretsmanager.Secret(this, id, {
        secretName: names.secret(`db-login-${user.replace(/^labconnect_/, '')}`),
        description: `Password of the ${user} database login (created by the migration task)`,
        encryptionKey: this.dataKey,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: user }),
          generateStringKey: 'password',
          excludePunctuation: true,
          passwordLength: 40,
        },
      });
    const apiLogin = login('DbApiLogin', DATABASE_API_USER);
    const workerLogin = login('DbWorkerLogin', DATABASE_WORKER_USER);

    // A connection URL holds the password, so it is a secret of its own. The password reaches
    // it through a CloudFormation dynamic reference: it is never in the template.
    // sslmode=require verifies the certificate: the images trust the RDS CA bundle.
    const host = this.database.dbInstanceEndpointAddress;
    const port = this.database.dbInstanceEndpointPort;
    const urlSecret = (id: string, name: string, source: secretsmanager.ISecret, user: string) =>
      new secretsmanager.Secret(this, id, {
        secretName: names.secret(name),
        description: 'PostgreSQL connection URL',
        encryptionKey: this.dataKey,
        secretStringValue: cdk.SecretValue.unsafePlainText(
          cdk.Fn.join('', [
            'postgresql://',
            user,
            ':',
            source.secretValueFromJson('password').unsafeUnwrap(),
            '@',
            host,
            ':',
            port,
            `/${DATABASE_NAME}?sslmode=require`,
          ]),
        ),
      });

    // ---- application secrets
    const generated = (
      id: string,
      name: string,
      description: string,
      options: Partial<secretsmanager.SecretStringGenerator>,
    ): secretsmanager.Secret =>
      new secretsmanager.Secret(this, id, {
        secretName: names.secret(name),
        description,
        encryptionKey: this.dataKey,
        generateSecretString: { excludePunctuation: true, ...options },
      });
    // 64 hexadecimal characters are 32 random bytes, which is what the application's
    // parseSecretBytes accepts (hex or base64).
    const hex32: Partial<secretsmanager.SecretStringGenerator> = {
      passwordLength: 64,
      excludeUppercase: true,
      excludeCharacters: 'ghijklmnopqrstuvwxyz',
    };

    let openSearchLogin: secretsmanager.Secret | undefined;
    if (config.enableOpenSearch) {
      openSearchLogin = new secretsmanager.Secret(this, 'OpenSearchLogin', {
        secretName: names.secret('opensearch-login'),
        description: 'OpenSearch master user (basic authentication, OQ-156)',
        encryptionKey: this.dataKey,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: 'labconnect_search' }),
          generateStringKey: 'password',
          excludePunctuation: true,
          passwordLength: 32,
        },
      });
      const domainName = `${config.prefix}-search`;
      this.searchDomain = new opensearch.Domain(this, 'Search', {
        domainName,
        version: opensearch.EngineVersion.OPENSEARCH_3_7,
        vpc: network.vpc,
        vpcSubnets: [
          {
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            availabilityZones: [network.vpc.availabilityZones[0] ?? ''],
          },
        ],
        securityGroups: [network.searchSecurityGroup],
        capacity: {
          dataNodes: 1,
          dataNodeInstanceType: 't3.small.search',
          multiAzWithStandbyEnabled: false,
        },
        ebs: { volumeSize: 20, volumeType: ec2.EbsDeviceVolumeType.GP3 },
        zoneAwareness: { enabled: false },
        encryptionAtRest: { enabled: true, kmsKey: this.dataKey },
        nodeToNodeEncryption: true,
        enforceHttps: true,
        tlsSecurityPolicy: opensearch.TLSSecurityPolicy.TLS_1_2,
        fineGrainedAccessControl: {
          masterUserName: 'labconnect_search',
          masterUserPassword: openSearchLogin.secretValueFromJson('password'),
        },
        // Fine-grained access control needs the domain policy open; the domain is in an
        // isolated subnet and only the task security groups reach it (and must sign in).
        accessPolicies: [
          new iam.PolicyStatement({
            actions: ['es:ESHttp*'],
            principals: [new iam.AnyPrincipal()],
            resources: [
              cdk.Stack.of(this).formatArn({
                service: 'es',
                resource: 'domain',
                resourceName: `${domainName}/*`,
              }),
            ],
          }),
        ],
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });
    }

    this.secrets = {
      apiDatabaseUrl: urlSecret('ApiDatabaseUrl', 'api-database-url', apiLogin, DATABASE_API_USER),
      workerDatabaseUrl: urlSecret(
        'WorkerDatabaseUrl',
        'worker-database-url',
        workerLogin,
        DATABASE_WORKER_USER,
      ),
      ownerDatabaseUrl: urlSecret(
        'OwnerDatabaseUrl',
        'owner-database-url',
        ownerLogin,
        DATABASE_OWNER_USER,
      ),
      apiLogin,
      workerLogin,
      // Not generated here: an Ed25519 key cannot be made by Secrets Manager. The placeholder
      // is random text, not a key; the API refuses it at the first sign-in until the real key
      // is put in (infrastructure/README.md, "One-time setup").
      authJwtPrivateKey: generated(
        'AuthJwtPrivateKey',
        'auth-jwt-private-key',
        'Ed25519 PKCS#8 PEM. REPLACE after the first deploy; see infrastructure/README.md.',
        { passwordLength: 64 },
      ),
      authHashSecret: generated(
        'AuthHashSecret',
        'auth-hash-secret',
        'HMAC key of OTP and recovery-code hashes (32 bytes, hex)',
        hex32,
      ),
      // Until the KMS adapter exists (OQ-94) the TOTP secrets are encrypted with this key.
      authEncryptionKey: generated(
        'AuthEncryptionKey',
        'auth-encryption-key',
        'AES-256-GCM key of TOTP secrets (32 bytes, hex); replaced by KMS later (OQ-94)',
        hex32,
      ),
      paymentPayloadEncryptionKey: generated(
        'PaymentPayloadEncryptionKey',
        'payment-payload-encryption-key',
        'AES-256-GCM key of stored gateway notifications (32 bytes, hex)',
        hex32,
      ),
      paymentFakeWebhookSecret: generated(
        'PaymentFakeWebhookSecret',
        'payment-fake-webhook-secret',
        'HMAC key of the fake payment gateway. Protects nothing real.',
        { passwordLength: 32 },
      ),
      openSearchLogin,
    };
  }

  /** The OpenSearch URL the application gets, or undefined when search runs on PostgreSQL. */
  get openSearchUrl(): string | undefined {
    return this.searchDomain === undefined
      ? undefined
      : `https://${this.searchDomain.domainEndpoint}`;
  }
}
