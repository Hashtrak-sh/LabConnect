import {
  createEmailSender,
  EmailSendError,
  type EmailEnv,
  type EmailSender,
  type OtpMailer,
  type OtpMessage,
  type SesClientLike,
} from '@labconnect/core';

/** Injection token for the `OtpMailer` port. Override it in tests with `InMemoryOtpMailer`. */
export const OTP_MAILER = Symbol('OTP_MAILER');

export const OTP_SUBJECT = 'Your LabConnect sign-in code';

/**
 * A sign-in e-mail that was not sent. The message is fixed and there is no `cause`: the error of
 * a mail provider can repeat the recipient address, and the code travels in the message body, so
 * nothing of the original error is kept. `permanent` is the only detail that survives.
 */
export class OtpMailError extends Error {
  override name = 'OtpMailError';
  constructor(readonly permanent: boolean) {
    super('The sign-in email could not be sent.');
  }
}

/**
 * Sends the sign-in code through the `EmailSender` the notifications worker uses (SES when
 * deployed, Mailpit on a developer machine). The message is sent directly and at once: it never
 * goes through the outbox, the `notification` table or the notification templates, because the
 * code must be neither stored nor queued (OQ-65). It has no notification id, so no trace header.
 * It logs nothing, and a failure is rethrown without the sender's error (see `OtpMailError`).
 */
export class EmailOtpMailer implements OtpMailer {
  constructor(private readonly sender: EmailSender) {}

  async sendLoginOtp(message: OtpMessage): Promise<void> {
    try {
      await this.sender.send({
        to: message.to,
        subject: OTP_SUBJECT,
        text:
          `Your sign-in code is ${message.code}. It is valid for ${String(message.validForMinutes)} minutes. ` +
          'If you did not ask for it, ignore this message.',
      });
    } catch (error) {
      throw new OtpMailError(error instanceof EmailSendError && error.permanent);
    }
  }
}

/**
 * The mailer for the API, chosen by the same variables as the worker's (`EMAIL_TRANSPORT`,
 * `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `SES_FROM_ADDRESS`, `SES_CONFIGURATION_SET`,
 * `AWS_REGION`). Called when the module is built, so a deployed environment without a real
 * sender stops the API from starting (`EmailConfigError`, which names a variable, never a value).
 */
export function createOtpMailer(
  env: EmailEnv,
  sesClient?: () => Promise<SesClientLike>,
): OtpMailer {
  const { sender } = createEmailSender({ env, ...(sesClient && { sesClient }) });
  return new EmailOtpMailer(sender);
}
