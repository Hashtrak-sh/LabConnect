import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import nodemailer, { type Transporter } from 'nodemailer';

// The outgoing mail port (NOTIFICATIONS.md section 2). Three adapters: in memory (tests), SMTP
// (Mailpit on a developer machine) and Amazon SES (deployed). `createEmailSender` picks one from
// the environment and refuses to start in production without a real one.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** The notification row. Sent as a header so a message can be traced back; not a secret. */
  notificationId: string;
}

export interface EmailSendResult {
  /** The provider's id for the message, when it gives one. */
  providerMessageId: string | null;
}

export interface EmailSender {
  /**
   * Sends one message. Resolves when the provider accepted it. Throws `EmailSendError` on a
   * failure; any other error is treated as a temporary one.
   */
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** A send that failed. `permanent` means retrying cannot help (the provider refused the message or address). */
export class EmailSendError extends Error {
  override name = 'EmailSendError';
  constructor(
    message: string,
    readonly permanent: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export const NOTIFICATION_HEADER = 'X-LabConnect-Notification';

// ---------------------------------------------------------------- in memory

/** Keeps what it was asked to send. For tests and for local runs with no mail server. */
export class InMemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  /** Called before each send; throw from it to simulate a failing provider. */
  onSend: ((message: EmailMessage) => Promise<void> | void) | undefined;
  private counter = 0;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    await this.onSend?.(message);
    this.sent.push(message);
    this.counter += 1;
    return { providerMessageId: `memory-${String(this.counter)}` };
  }
}

// ---------------------------------------------------------------- SMTP

export interface SmtpSettings {
  host: string;
  port: number;
  from: string;
}

/** The part of nodemailer's transporter the adapter uses, so a test can pass a stub. */
export type MailTransport = Pick<Transporter, 'sendMail'>;

/**
 * Sends over SMTP without TLS or login: Mailpit locally. Anything else uses SES
 * (`createEmailSender` refuses SMTP in production). Logs nothing: a message is personal data.
 */
export class SmtpEmailSender implements EmailSender {
  private transport: MailTransport | undefined;

  constructor(
    private readonly settings: SmtpSettings,
    transport?: MailTransport,
  ) {
    this.transport = transport;
  }

  private get transporter(): MailTransport {
    this.transport ??= nodemailer.createTransport({
      host: this.settings.host,
      port: this.settings.port,
      secure: false,
      ignoreTLS: true,
    });
    return this.transport;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const info = (await this.transporter.sendMail({
        from: this.settings.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
        headers: { [NOTIFICATION_HEADER]: message.notificationId },
      })) as { messageId?: string };
      return { providerMessageId: info.messageId?.slice(0, 200) ?? null };
    } catch (error) {
      const code = (error as { responseCode?: unknown }).responseCode;
      const permanent = typeof code === 'number' && code >= 500 && code < 600;
      throw new EmailSendError('The SMTP server did not accept the message.', permanent, {
        cause: error,
      });
    }
  }
}

// ---------------------------------------------------------------- SES

/** The part of `SESv2Client` the adapter uses. */
export interface SesClientLike {
  send(command: SendEmailCommand): Promise<{ MessageId?: string }>;
}

export interface SesSettings {
  /** The verified sender, for example `LabConnect <no-reply@labconnect.example>`. */
  from: string;
  /** SES configuration set (bounce, complaint and delivery events); optional. */
  configurationSet?: string;
}

/** SES errors that retrying cannot fix: the message or an address is refused. */
const SES_PERMANENT = new Set(['MessageRejected', 'BadRequestException', 'InvalidParameterValue']);

/** Sends with the SES v2 `SendEmail` API. Region and credentials come from the SDK's usual sources. */
export class SesEmailSender implements EmailSender {
  constructor(
    private readonly client: SesClientLike,
    private readonly settings: SesSettings,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const command = new SendEmailCommand({
      FromEmailAddress: this.settings.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.text, Charset: 'UTF-8' },
            ...(message.html === undefined
              ? {}
              : { Html: { Data: message.html, Charset: 'UTF-8' } }),
          },
          Headers: [{ Name: NOTIFICATION_HEADER, Value: message.notificationId }],
        },
      },
      ...(this.settings.configurationSet === undefined
        ? {}
        : { ConfigurationSetName: this.settings.configurationSet }),
    });
    try {
      const output = await this.client.send(command);
      return { providerMessageId: output.MessageId?.slice(0, 200) ?? null };
    } catch (error) {
      const name = (error as { name?: unknown }).name;
      throw new EmailSendError(
        `SES did not accept the message (${typeof name === 'string' ? name : 'unknown error'}).`,
        typeof name === 'string' && SES_PERMANENT.has(name),
        { cause: error },
      );
    }
  }
}

// ---------------------------------------------------------------- selection

export type EmailEnv = Readonly<Record<string, string | undefined>>;
export type EmailTransportName = 'ses' | 'smtp' | 'memory';

export class EmailConfigError extends Error {
  override name = 'EmailConfigError';
}

/** `NODE_ENV=production`, or `APP_ENV` of `production` or `uat`: a deployed environment that must send real mail. */
export function isDeployedEnvironment(env: EmailEnv): boolean {
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  return (
    env.NODE_ENV?.trim().toLowerCase() === 'production' ||
    appEnv === 'production' ||
    appEnv === 'uat'
  );
}

/**
 * Which transport `EMAIL_TRANSPORT` selects.
 * - `ses`, `smtp` or `memory` as written;
 * - unset on a developer machine: `smtp` when `SMTP_HOST` is set (Mailpit), else `memory`;
 * - unset in a deployed environment: an error. A deployment must not run without mail by
 *   forgetting a variable;
 * - `memory` in a deployed environment: an error (mail would be dropped silently);
 * - `smtp` in production (`APP_ENV=production`, or `NODE_ENV=production` without `APP_ENV=uat`):
 *   an error, since the SMTP adapter has no TLS or login.
 */
export function selectEmailTransport(env: EmailEnv): EmailTransportName {
  const raw = env.EMAIL_TRANSPORT?.trim().toLowerCase();
  const deployed = isDeployedEnvironment(env);
  if (raw === undefined || raw === '') {
    if (deployed) {
      throw new EmailConfigError(
        'EMAIL_TRANSPORT is not set. A deployed environment must set it to "ses".',
      );
    }
    return env.SMTP_HOST ? 'smtp' : 'memory';
  }
  if (raw !== 'ses' && raw !== 'smtp' && raw !== 'memory') {
    throw new EmailConfigError('EMAIL_TRANSPORT must be "ses", "smtp" or "memory".');
  }
  if (raw === 'memory' && deployed) {
    throw new EmailConfigError(
      'EMAIL_TRANSPORT=memory is not allowed in a deployed environment: mail would be dropped.',
    );
  }
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  const production =
    appEnv === 'production' ||
    (env.NODE_ENV?.trim().toLowerCase() === 'production' && appEnv !== 'uat');
  if (raw === 'smtp' && production) {
    throw new EmailConfigError('EMAIL_TRANSPORT=smtp is not allowed in production: use "ses".');
  }
  return raw;
}

export const DEFAULT_MAIL_FROM = 'LabConnect <no-reply@labconnect.local>';

export interface CreateEmailSenderOptions {
  env: EmailEnv;
  /** Builds the SES client; defaults to `new SESv2Client({})` (loaded when first needed). */
  sesClient?: () => Promise<SesClientLike>;
}

/**
 * The configured sender. Reads `EMAIL_TRANSPORT`, then for SMTP `SMTP_HOST`, `SMTP_PORT` (1025)
 * and `MAIL_FROM`; for SES `SES_FROM_ADDRESS` (else `MAIL_FROM`, required) and optionally
 * `SES_CONFIGURATION_SET`, with region and credentials from the AWS SDK's environment.
 */
export function createEmailSender(options: CreateEmailSenderOptions): {
  transport: EmailTransportName;
  sender: EmailSender;
  memory?: InMemoryEmailSender;
} {
  const { env } = options;
  const transport = selectEmailTransport(env);
  if (transport === 'memory') {
    const memory = new InMemoryEmailSender();
    return { transport, sender: memory, memory };
  }
  if (transport === 'smtp') {
    const host = env.SMTP_HOST;
    if (!host) throw new EmailConfigError('SMTP_HOST is not set. See .env.example.');
    const port = Number(env.SMTP_PORT ?? 1025);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new EmailConfigError('SMTP_PORT must be a port number.');
    }
    return {
      transport,
      sender: new SmtpEmailSender({ host, port, from: env.MAIL_FROM ?? DEFAULT_MAIL_FROM }),
    };
  }
  const from = env.SES_FROM_ADDRESS ?? env.MAIL_FROM;
  if (!from) {
    throw new EmailConfigError('SES_FROM_ADDRESS (or MAIL_FROM) is not set. See .env.example.');
  }
  const configurationSet = env.SES_CONFIGURATION_SET;
  return {
    transport,
    sender: new LazySesEmailSender(options.sesClient ?? defaultSesClient, {
      from,
      ...(configurationSet ? { configurationSet } : {}),
    }),
  };
}

async function defaultSesClient(): Promise<SesClientLike> {
  const { SESv2Client } = await import('@aws-sdk/client-sesv2');
  return new SESv2Client({});
}

/** Creates the SES client on the first send, so a process that never sends never builds one. */
class LazySesEmailSender implements EmailSender {
  private delegate: Promise<SesEmailSender> | undefined;

  constructor(
    private readonly build: () => Promise<SesClientLike>,
    private readonly settings: SesSettings,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.delegate ??= this.build().then((client) => new SesEmailSender(client, this.settings));
    return (await this.delegate).send(message);
  }
}
