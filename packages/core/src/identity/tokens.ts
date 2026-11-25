import { createPrivateKey, createPublicKey, randomUUID, type KeyObject } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { Clock } from '../platform/clock.js';
import { IdentityError } from './errors.js';
import { IDENTITY_POLICY } from './policy.js';

/** JWT header `typ` of an access token (RFC 9068). */
const TOKEN_TYPE = 'at+jwt';

export interface AccessTokenConfig {
  /** PKCS#8 PEM of the Ed25519 signing key. */
  privateKeyPem: string;
  /** `kid` of the signing key. Default `k1`. */
  keyId?: string;
  /** Older public keys (SPKI PEM) that still verify tokens while a rotation settles. */
  previousPublicKeys?: readonly { keyId: string; pem: string }[];
  issuer: string;
  audience: string;
  ttlSeconds?: number;
}

export interface AccessTokenInput {
  userId: string;
  /** The session id: `user_session.token_family_id`, the same for every refresh of one sign-in. */
  sessionId: string;
  /** Authentication methods: `otp`, then `totp` once MFA is done. */
  amr: readonly string[];
  /** When MFA last succeeded in this session. */
  mfaAt?: Date | null;
  /** A session that still owes MFA. Only `/auth/mfa/*` and `/auth/logout` accept it. */
  partial: boolean;
}

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  amr: string[];
  /** Seconds since the epoch, or `null` if MFA has not been done in this session. */
  mfaAt: number | null;
  partial: boolean;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Signs and verifies access tokens: JWTs signed with EdDSA (Ed25519), 10 minutes, claims
 * `sub`, `sid`, `amr`, `mfa_at` and the standard `iat`, `exp`, `iss`, `aud`, `jti`. A partial
 * session carries `pre_mfa: true`. Time comes from the clock, so tests can expire a token
 * without waiting. Whether the session behind a valid token is still alive is a database
 * question, asked by `authenticateSession`.
 */
export class AccessTokens {
  private readonly signingKey: KeyObject;
  private readonly keyId: string;
  private readonly verificationKeys = new Map<string, KeyObject>();
  private readonly ttlSeconds: number;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    config: AccessTokenConfig,
    private readonly clock: Clock,
  ) {
    this.signingKey = createPrivateKey(config.privateKeyPem);
    if (this.signingKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('The access token signing key must be an Ed25519 key.');
    }
    this.keyId = config.keyId ?? 'k1';
    this.verificationKeys.set(this.keyId, createPublicKey(this.signingKey));
    for (const previous of config.previousPublicKeys ?? []) {
      this.verificationKeys.set(previous.keyId, createPublicKey(previous.pem));
    }
    this.ttlSeconds = config.ttlSeconds ?? IDENTITY_POLICY.accessTokenTtlSeconds;
    this.issuer = config.issuer;
    this.audience = config.audience;
  }

  get expiresInSeconds(): number {
    return this.ttlSeconds;
  }

  async sign(input: AccessTokenInput): Promise<{ token: string; expiresIn: number }> {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    const payload: Record<string, unknown> = {
      sid: input.sessionId,
      amr: [...input.amr],
      ...(input.mfaAt ? { mfa_at: Math.floor(input.mfaAt.getTime() / 1000) } : {}),
      ...(input.partial ? { pre_mfa: true } : {}),
    };
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'EdDSA', typ: TOKEN_TYPE, kid: this.keyId })
      .setSubject(input.userId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.ttlSeconds)
      .setJti(randomUUID())
      .sign(this.signingKey);
    return { token, expiresIn: this.ttlSeconds };
  }

  /** Throws `IdentityError('UNAUTHENTICATED')` for a token that is expired, forged, for another audience or malformed. */
  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(
        token,
        (header) => {
          const key = this.verificationKeys.get(header.kid ?? this.keyId);
          if (!key) throw new Error('unknown key id');
          return key;
        },
        {
          algorithms: ['EdDSA'],
          typ: TOKEN_TYPE,
          issuer: this.issuer,
          audience: this.audience,
          currentDate: this.clock.now(),
          requiredClaims: ['sub', 'sid', 'amr', 'iat', 'exp'],
        },
      );
      const { sub, sid, amr, mfa_at: mfaAt, pre_mfa: preMfa, iat, exp } = payload;
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        !Array.isArray(amr) ||
        !amr.every((value): value is string => typeof value === 'string') ||
        typeof iat !== 'number' ||
        typeof exp !== 'number' ||
        (mfaAt !== undefined && typeof mfaAt !== 'number') ||
        (preMfa !== undefined && preMfa !== true)
      ) {
        throw new Error('malformed claims');
      }
      return {
        userId: sub,
        sessionId: sid,
        amr,
        mfaAt: mfaAt ?? null,
        partial: preMfa === true,
        issuedAt: iat,
        expiresAt: exp,
      };
    } catch (error) {
      throw new IdentityError('UNAUTHENTICATED', { cause: error });
    }
  }
}
