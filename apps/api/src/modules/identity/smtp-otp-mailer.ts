import { Inject, Injectable } from '@nestjs/common';
import type { OtpMailer, OtpMessage } from '@labconnect/core';
import nodemailer, { type Transporter } from 'nodemailer';
import { IDENTITY_ENV, type IdentityEnv } from './identity.runtime.js';

/** Injection token for the `OtpMailer` port. Override it in tests with `InMemoryOtpMailer`. */
export const OTP_MAILER = Symbol('OTP_MAILER');

/**
 * Sends the sign-in code over SMTP: Mailpit on a developer machine (`SMTP_HOST`, `SMTP_PORT`,
 * see docker-compose.yml). Amazon SES replaces it with the notifications task (P3-08). The
 * connection is made on the first send. It logs nothing: the message holds the code.
 */
@Injectable()
export class SmtpOtpMailer implements OtpMailer {
  private transport: Transporter | undefined;

  constructor(@Inject(IDENTITY_ENV) private readonly env: IdentityEnv) {}

  private get transporter(): Transporter {
    if (!this.transport) {
      const host = this.env.SMTP_HOST;
      if (!host) throw new Error('SMTP_HOST is not set. See .env.example.');
      this.transport = nodemailer.createTransport({
        host,
        port: Number(this.env.SMTP_PORT ?? 1025),
        secure: false,
        // Local Mailpit has no TLS and no login; anything else needs the SES adapter.
        ignoreTLS: true,
      });
    }
    return this.transport;
  }

  async sendLoginOtp(message: OtpMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.env.MAIL_FROM ?? 'LabConnect <no-reply@labconnect.local>',
      to: message.to,
      subject: 'Your LabConnect sign-in code',
      text:
        `Your sign-in code is ${message.code}. It is valid for ${String(message.validForMinutes)} minutes. ` +
        'If you did not ask for it, ignore this message.',
    });
  }
}
