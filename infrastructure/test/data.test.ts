import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { WITH_DOMAIN, resourcesOfType, single, synthesise } from './helpers.js';

describe('files bucket', () => {
  const { templates } = synthesise();

  it('blocks all public access, in every way', () => {
    templates.data.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    // No statement grants anything to everyone: a wildcard principal appears in Deny statements only.
    for (const [, policy] of resourcesOfType(templates.data, 'AWS::S3::BucketPolicy')) {
      const document = policy.Properties.PolicyDocument as {
        Statement: { Effect: string; Principal?: unknown }[];
      };
      for (const statement of document.Statement) {
        if (JSON.stringify(statement.Principal) === '{"AWS":"*"}') {
          expect(statement.Effect).toBe('Deny');
        }
      }
    }
  });

  it('is encrypted with a customer-managed key and refuses plain HTTP', () => {
    templates.data.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({
            ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'aws:kms' }),
            BucketKeyEnabled: true,
          }),
        ],
      },
    });
    templates.data.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('is versioned (the scan verdict is bound to ETag and version) and retained on deletion', () => {
    templates.data.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
    });
    templates.data.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('expires the quarantine prefix after 30 days', () => {
    templates.data.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Id: 'quarantine-30-days',
            Prefix: 'quarantine/',
            ExpirationInDays: 30,
            Status: 'Enabled',
          }),
        ]),
      },
    });
  });

  it('restricts browser uploads to the web origin and the PUT method', () => {
    const { templates: withDomain } = synthesise(WITH_DOMAIN);
    const bucket = single(withDomain.data, 'AWS::S3::Bucket');
    const rules = (bucket.Properties.CorsConfiguration as { CorsRules: Record<string, unknown>[] })
      .CorsRules;
    expect(rules).toHaveLength(1);
    expect(rules[0]?.AllowedMethods).toEqual(['PUT']);
    expect(rules[0]?.AllowedOrigins).toEqual(['https://uat.labconnect.example']);
    expect(JSON.stringify(rules)).not.toContain('"*"');
  });
});

describe('database', () => {
  const { templates } = synthesise();

  it('is encrypted, private, protected from deletion and backed up', () => {
    templates.data.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      StorageEncrypted: true,
      KmsKeyId: Match.anyValue(),
      PubliclyAccessible: false,
      DeletionProtection: true,
      BackupRetentionPeriod: Match.anyValue(),
      MultiAZ: false,
      DBName: 'labconnect',
    });
    const instance = single(templates.data, 'AWS::RDS::DBInstance');
    expect(Number(instance.Properties.BackupRetentionPeriod)).toBeGreaterThanOrEqual(1);
    expect(String(instance.Properties.EngineVersion)).toMatch(/^16/);
    templates.data.hasResource('AWS::RDS::DBInstance', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('sits in the isolated subnets, forces TLS and does not log statements', () => {
    templates.data.hasResourceProperties('AWS::RDS::DBSubnetGroup', Match.anyValue());
    templates.data.hasResourceProperties('AWS::RDS::DBParameterGroup', {
      Parameters: { 'rds.force_ssl': '1' },
    });
    const parameters = JSON.stringify(
      resourcesOfType(templates.data, 'AWS::RDS::DBParameterGroup').map(([, p]) => p.Properties),
    );
    expect(parameters).not.toContain('log_statement');
    expect(parameters).not.toContain('log_min_duration_statement');
  });

  it('is the master user named app_owner, with the secret in Secrets Manager', () => {
    templates.data.hasResourceProperties('AWS::RDS::DBInstance', {
      MasterUsername: 'app_owner',
    });
    const instance = single(templates.data, 'AWS::RDS::DBInstance');
    // A dynamic reference: the password is resolved by CloudFormation, it is not in the template.
    expect(JSON.stringify(instance.Properties.MasterUserPassword)).toContain(
      '{{resolve:secretsmanager:',
    );
    templates.data.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'labconnect/uat/db-owner',
      GenerateSecretString: Match.objectLike({
        SecretStringTemplate: '{"username":"app_owner"}',
        ExcludePunctuation: true,
      }),
    });
  });
});

describe('QR signing keys', () => {
  const { templates } = synthesise();

  it('has one HMAC key per QR purpose, which seed:reference needs in every deployed environment', () => {
    const hmac = resourcesOfType(templates.data, 'AWS::KMS::Key').filter(
      ([, key]) => key.Properties.KeySpec === 'HMAC_256',
    );
    expect(hmac).toHaveLength(3);
    for (const [, key] of hmac) {
      expect(key.Properties.KeyUsage).toBe('GENERATE_VERIFY_MAC');
      // AWS does not rotate HMAC keys; asking for it would be refused.
      expect(key.Properties.EnableKeyRotation).toBeUndefined();
    }
  });

  it('gives no task role use of them before the QR feature exists', () => {
    const text = JSON.stringify(synthesise().templates.compute.toJSON());
    expect(text).not.toContain('kms:GenerateMac');
    expect(text).not.toContain('kms:VerifyMac');
  });
});

describe('secrets and keys', () => {
  const { templates, all } = synthesise();

  it('has generated or placeholder values only: no secret text in any template', () => {
    for (const [, secret] of resourcesOfType(templates.data, 'AWS::SecretsManager::Secret')) {
      const properties = secret.Properties;
      const hasGenerator = properties.GenerateSecretString !== undefined;
      const value = properties.SecretString;
      // Either Secrets Manager generates it, or it is a connection URL built from a dynamic reference.
      expect(hasGenerator || JSON.stringify(value).includes('{{resolve:secretsmanager:')).toBe(
        true,
      );
      if (value !== undefined) {
        const text = JSON.stringify(value);
        expect(text).toContain('resolve:secretsmanager');
        expect(text).toContain('postgresql://');
      }
    }
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(text).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it('encrypts every secret with the data key', () => {
    for (const [, secret] of resourcesOfType(templates.data, 'AWS::SecretsManager::Secret')) {
      expect(secret.Properties.KmsKeyId).toBeDefined();
    }
  });

  it('generates the 32-byte keys as 64 hexadecimal characters', () => {
    for (const name of [
      'auth-hash-secret',
      'auth-encryption-key',
      'payment-payload-encryption-key',
    ]) {
      templates.data.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: `labconnect/uat/${name}`,
        GenerateSecretString: Match.objectLike({
          PasswordLength: 64,
          ExcludeUppercase: true,
          ExcludeCharacters: 'ghijklmnopqrstuvwxyz',
        }),
      });
    }
  });

  it('creates the three database URLs from the two login secrets and the owner secret', () => {
    for (const name of ['api-database-url', 'worker-database-url', 'owner-database-url']) {
      templates.data.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: `labconnect/uat/${name}`,
        SecretString: Match.anyValue(),
      });
    }
    const urls = JSON.stringify(
      resourcesOfType(templates.data, 'AWS::SecretsManager::Secret')
        .filter(([, s]) => s.Properties.SecretString !== undefined)
        .map(([, s]) => s.Properties.SecretString),
    );
    expect(urls).toContain('sslmode=require');
    expect(urls).toContain('labconnect_api');
    expect(urls).toContain('labconnect_worker');
    expect(urls).toContain('app_owner');
  });

  it('rotates every symmetric key and retains every key on deletion', () => {
    const keys = resourcesOfType(templates.data, 'AWS::KMS::Key');
    const symmetric = keys.filter(([, key]) => key.Properties.KeySpec === undefined);
    expect(symmetric).toHaveLength(2);
    for (const [, key] of symmetric) expect(key.Properties.EnableKeyRotation).toBe(true);
    const retained = Object.values(templates.data.findResources('AWS::KMS::Key')).filter(
      (key) => key.DeletionPolicy === 'Retain' && key.UpdateReplacePolicy === 'Retain',
    );
    expect(retained).toHaveLength(keys.length);
    expect(keys).toHaveLength(5);
    const messagingKeys = resourcesOfType(synthesise().templates.messaging, 'AWS::KMS::Key');
    expect(messagingKeys).toHaveLength(1);
    expect(messagingKeys[0]?.[1].Properties.EnableKeyRotation).toBe(true);
  });
});
