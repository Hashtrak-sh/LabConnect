import type { AuditService } from '../platform/audit.js';
import type { Clock } from '../platform/clock.js';
import type { SecretCipher } from './cipher.js';
import type { IdentityHasher } from './hasher.js';

/**
 * Sends the sign-in code by email. It is a port of its own, outside the outbox, because an
 * event payload is stored and queued and an OTP must be neither (OQ-65, CLAUDE.md section 5).
 * Adapter: `EmailOtpMailer` in apps/api, on the `EmailSender` of the notifications module (Mailpit locally, SES when
 * deployed). It lives in the app because identity may not import notifications (MODULE_BOUNDARIES rules 2 and 5).
 */
export interface OtpMailer {
  sendLoginOtp(message: OtpMessage): Promise<void>;
  /**
   * Sends the code of a lab claim (I1-LAB-01) to the lab's NABL-registered address. Same rules as
   * the sign-in code: direct, after the commit, never through the outbox or a template.
   */
  sendLabClaimOtp(message: OtpMessage): Promise<void>;
}

export interface OtpMessage {
  to: string;
  code: string;
  validForMinutes: number;
}

/** Keeps messages in memory, for tests. */
export class InMemoryOtpMailer implements OtpMailer {
  readonly sent: OtpMessage[] = [];
  /** The lab claim codes, kept apart from the sign-in codes. */
  readonly claimSent: OtpMessage[] = [];
  /** Set to make the next sends fail, to test the failure path. */
  failWith: Error | undefined;

  sendLoginOtp(message: OtpMessage): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ ...message });
    return Promise.resolve();
  }

  sendLabClaimOtp(message: OtpMessage): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.claimSent.push({ ...message });
    return Promise.resolve();
  }

  /** The newest lab claim code sent to the address, or `undefined`. */
  lastClaimCodeFor(email: string): string | undefined {
    return this.claimSent.findLast((message) => message.to === email)?.code;
  }

  /** The newest code sent to the address, or `undefined`. */
  lastCodeFor(email: string): string | undefined {
    return this.sent.findLast((message) => message.to === email)?.code;
  }
}

/** What every identity function needs besides the transaction. */
export interface IdentityDeps {
  clock: Clock;
  audit: AuditService;
  hasher: IdentityHasher;
  cipher: SecretCipher;
}
