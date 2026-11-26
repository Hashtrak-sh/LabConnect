import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  AccessTokens,
  AesGcmSecretCipher,
  type Clock,
  type DemoOtpSettings,
  IdentityHasher,
  parseDemoOtpSettings,
  parseSecretBytes,
  type SecretCipher,
} from '@labconnect/core';
import { CLOCK } from '../platform/platform.providers.js';

/** The environment the identity module reads. Replaced in tests. */
export const IDENTITY_ENV = Symbol('IDENTITY_ENV');
export type IdentityEnv = Record<string, string | undefined>;

function required(env: IdentityEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    // Names the variable, never a value. The exception filter turns this into a bare 500.
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

/** A PEM in an environment variable often has its newlines written as `\n`. */
function pem(value: string): string {
  return value.replaceAll(String.raw`\n`, '\n');
}

/**
 * The secrets of the identity module, read from the environment the first time each is used
 * (never at start-up), so the API boots in tests and in a fresh checkout without them and
 * fails with a clear message, on the request that needs them, if they are missing.
 *
 * - `AUTH_JWT_PRIVATE_KEY`: PKCS#8 PEM of an Ed25519 key, signs the access tokens.
 *   Optional `AUTH_JWT_KEY_ID`, `AUTH_JWT_PREVIOUS_PUBLIC_KEY` (SPKI PEM) and
 *   `AUTH_JWT_PREVIOUS_KEY_ID` while a key rotation settles; `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`.
 * - `AUTH_HASH_SECRET`: at least 32 bytes (base64 or hex), the key of the OTP and recovery code HMACs.
 * - `AUTH_ENCRYPTION_KEY`: 32 bytes (base64 or hex), AES-256-GCM key for TOTP secrets (local
 *   and test; deployed environments use the KMS adapter, task P3-11).
 * - `AUTH_ALLOWED_ORIGINS`: comma separated origins that may call `/auth/refresh`.
 * - `DEMO_OTP_CODE` and `DEMO_OTP_EMAIL_DOMAIN`: demo one-time codes, UAT only. Unlike the secrets
 *   above these are checked when the API starts, and production refuses them.
 */
@Injectable()
export class IdentityRuntime implements OnModuleInit {
  private hasherInstance: IdentityHasher | undefined;
  private cipherInstance: SecretCipher | undefined;
  private tokensInstance: AccessTokens | undefined;
  private readonly logger = new Logger(IdentityRuntime.name);

  constructor(
    @Inject(IDENTITY_ENV) private readonly env: IdentityEnv,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  get hasher(): IdentityHasher {
    this.hasherInstance ??= new IdentityHasher(
      parseSecretBytes(required(this.env, 'AUTH_HASH_SECRET'), 'AUTH_HASH_SECRET'),
    );
    return this.hasherInstance;
  }

  get cipher(): SecretCipher {
    this.cipherInstance ??= new AesGcmSecretCipher(
      parseSecretBytes(required(this.env, 'AUTH_ENCRYPTION_KEY'), 'AUTH_ENCRYPTION_KEY'),
    );
    return this.cipherInstance;
  }

  get tokens(): AccessTokens {
    if (!this.tokensInstance) {
      const previousPem = this.env.AUTH_JWT_PREVIOUS_PUBLIC_KEY;
      this.tokensInstance = new AccessTokens(
        {
          privateKeyPem: pem(required(this.env, 'AUTH_JWT_PRIVATE_KEY')),
          ...(this.env.AUTH_JWT_KEY_ID && { keyId: this.env.AUTH_JWT_KEY_ID }),
          ...(previousPem && {
            previousPublicKeys: [
              { keyId: this.env.AUTH_JWT_PREVIOUS_KEY_ID ?? 'previous', pem: pem(previousPem) },
            ],
          }),
          issuer: this.env.AUTH_JWT_ISSUER ?? 'labconnect-api',
          audience: this.env.AUTH_JWT_AUDIENCE ?? 'labconnect',
        },
        this.clock,
      );
    }
    return this.tokensInstance;
  }

  /**
   * Demo one-time codes (UAT only): `DEMO_OTP_CODE` and `DEMO_OTP_EMAIL_DOMAIN`, see
   * `parseDemoOtpSettings`. `undefined` (the default) means off. Read on every use, so an invalid
   * setting can never be skipped; the API also reads it when it starts (`onModuleInit`) and
   * refuses to start with a bad one, or with one in production.
   */
  get demoOtp(): DemoOtpSettings | undefined {
    return parseDemoOtpSettings(this.env);
  }

  /**
   * Start-up check for the demo codes. Throws (naming the variable, never a value) when the
   * setting is invalid or present in production. When it is active, logs one warning with the
   * domain; the code and the settings object are never logged.
   */
  onModuleInit(): void {
    const settings = this.demoOtp;
    if (settings === undefined) return;
    this.logger.warn(
      `Demo one-time codes are ENABLED for the demo domain ${settings.emailDomain}: ` +
        'sign-in and lab claim codes of those addresses are fixed and not mailed. ' +
        'This is for UAT demonstrations only; remove DEMO_OTP_CODE to turn it off.',
    );
  }

  /** Origins allowed to call `/auth/refresh`. Empty (the default) allows none. */
  get allowedOrigins(): ReadonlySet<string> {
    return new Set(
      (this.env.AUTH_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim().replace(/\/$/, ''))
        .filter((origin) => origin !== ''),
    );
  }
}
