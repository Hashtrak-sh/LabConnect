import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  EmailConfigError,
  EmailSendError,
  InMemoryEmailSender,
  NOTIFICATION_HEADER,
  type SesClientLike,
} from '@labconnect/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_ENV } from './identity.runtime.js';
import { IdentityModule } from './identity.module.js';
import {
  createOtpMailer,
  EmailOtpMailer,
  LAB_CLAIM_OTP_SUBJECT,
  OTP_MAILER,
  OTP_SUBJECT,
  OtpMailError,
} from './otp-mailer.js';

const CODE = '482915';
const ADDRESS = 'someone.private@example.test';
const MESSAGE = { to: ADDRESS, code: CODE, validForMinutes: 10 };

/** Everything written to the console, to stdout/stderr and to Nest's logger while a test runs. */
function captureOutput() {
  const lines: string[] = [];
  const keep = (...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(keep),
    vi.spyOn(console, 'info').mockImplementation(keep),
    vi.spyOn(console, 'warn').mockImplementation(keep),
    vi.spyOn(console, 'error').mockImplementation(keep),
    vi.spyOn(console, 'debug').mockImplementation(keep),
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      keep(chunk);
      return true;
    }),
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      keep(chunk);
      return true;
    }),
    vi.spyOn(Logger.prototype, 'error').mockImplementation(keep),
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(keep),
    vi.spyOn(Logger.prototype, 'log').mockImplementation(keep),
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(keep),
  ];
  return {
    lines,
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

describe('EmailOtpMailer', () => {
  let output: ReturnType<typeof captureOutput>;
  beforeEach(() => {
    output = captureOutput();
  });
  afterEach(() => {
    output.restore();
  });

  it('sends the code to the address with the same subject and text as before, as plain text, with no notification id', async () => {
    const sender = new InMemoryEmailSender();
    await new EmailOtpMailer(sender).sendLoginOtp(MESSAGE);
    expect(sender.sent).toEqual([
      {
        to: ADDRESS,
        subject: 'Your LabConnect sign-in code',
        text:
          'Your sign-in code is 482915. It is valid for 10 minutes. ' +
          'If you did not ask for it, ignore this message.',
      },
    ]);
    expect(OTP_SUBJECT).toBe('Your LabConnect sign-in code');
    expect(sender.sent[0]).not.toHaveProperty('html');
    expect(sender.sent[0]).not.toHaveProperty('notificationId');
  });

  it('sends the lab claim code with its own subject and text, directly, with no notification id', async () => {
    const sender = new InMemoryEmailSender();
    await new EmailOtpMailer(sender).sendLabClaimOtp(MESSAGE);
    expect(sender.sent).toEqual([
      {
        to: ADDRESS,
        subject: LAB_CLAIM_OTP_SUBJECT,
        text:
          'Your lab claim code is 482915. It is valid for 10 minutes. ' +
          'If you did not ask to claim this lab on LabConnect, ignore this message.',
      },
    ]);
    expect(sender.sent[0]).not.toHaveProperty('html');
    expect(sender.sent[0]).not.toHaveProperty('notificationId');
  });

  it('throws an error without the code or the address when the lab claim email fails, and logs nothing', async () => {
    const sender = new InMemoryEmailSender();
    sender.onSend = () => {
      throw new EmailSendError(`refused ${ADDRESS}: lab claim code ${CODE}`, false, {
        cause: new Error(`550 ${ADDRESS} ${CODE}`),
      });
    };
    const error = await new EmailOtpMailer(sender)
      .sendLabClaimOtp(MESSAGE)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OtpMailError);
    const everything = `${(error as OtpMailError).message} ${(error as OtpMailError).stack ?? ''}`;
    expect(everything).not.toContain(CODE);
    expect(everything).not.toContain(ADDRESS);
    expect((error as OtpMailError).cause).toBeUndefined();
    expect(output.lines.join('\n')).not.toContain(CODE);
    expect(output.lines.join('\n')).not.toContain(ADDRESS);
  });

  it('sends no notification header through SES', async () => {
    const commands: Parameters<SesClientLike['send']>[0][] = [];
    const client: SesClientLike = {
      send(command) {
        commands.push(command);
        return Promise.resolve({ MessageId: 'ses-1' });
      },
    };
    const mailer = createOtpMailer(
      { EMAIL_TRANSPORT: 'ses', SES_FROM_ADDRESS: 'LabConnect <no-reply@labconnect.example>' },
      () => Promise.resolve(client),
    );
    await mailer.sendLoginOtp(MESSAGE);
    const simple = commands[0]?.input.Content?.Simple;
    expect(commands[0]?.input.Destination?.ToAddresses).toEqual([ADDRESS]);
    expect(simple?.Subject?.Data).toBe(OTP_SUBJECT);
    expect(simple?.Body?.Text?.Data).toContain(`Your sign-in code is ${CODE}.`);
    expect(simple?.Body).not.toHaveProperty('Html');
    expect(simple).not.toHaveProperty('Headers');
    expect(JSON.stringify(commands[0]?.input)).not.toContain(NOTIFICATION_HEADER);
  });

  it.each([
    ['a refused message', true],
    ['a temporary failure', false],
  ])(
    'throws an error that holds neither the code nor the address after %s, and logs nothing',
    async (_name, permanent) => {
      const sender = new InMemoryEmailSender();
      sender.onSend = () => {
        // What a provider error can contain: the address, and the whole body with the code.
        throw new EmailSendError(
          `SES did not accept ${ADDRESS}: Your sign-in code is ${CODE}.`,
          permanent,
          { cause: new Error(`550 no such user ${ADDRESS}; body: sign-in code ${CODE}`) },
        );
      };
      const error = await new EmailOtpMailer(sender)
        .sendLoginOtp(MESSAGE)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(OtpMailError);
      const failure = error as OtpMailError;
      expect(failure.permanent).toBe(permanent);
      expect(failure.cause).toBeUndefined();
      const everything = `${failure.name} ${failure.message} ${failure.stack ?? ''}`;
      expect(everything).not.toContain(CODE);
      expect(everything).not.toContain(ADDRESS);
      expect(output.lines.join('\n')).not.toContain(CODE);
      expect(output.lines.join('\n')).not.toContain(ADDRESS);
      expect(sender.sent).toHaveLength(0);
    },
  );

  it('treats any other error from the sender as a temporary failure, without keeping it', async () => {
    const sender = new InMemoryEmailSender();
    sender.onSend = () => {
      throw new Error(`socket hang up for ${ADDRESS} ${CODE}`);
    };
    const error = await new EmailOtpMailer(sender)
      .sendLoginOtp(MESSAGE)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OtpMailError);
    expect((error as OtpMailError).permanent).toBe(false);
    expect((error as OtpMailError).message).not.toContain(CODE);
    expect((error as OtpMailError).cause).toBeUndefined();
  });
});

describe('the OTP_MAILER provider at start-up', () => {
  async function build(env: Record<string, string | undefined>) {
    return Test.createTestingModule({ imports: [IdentityModule] })
      .overrideProvider(IDENTITY_ENV)
      .useValue(env)
      .compile();
  }

  it('fails at start-up in production without a real sender, never falling back to memory', async () => {
    await expect(build({ NODE_ENV: 'production' })).rejects.toThrow(EmailConfigError);
    await expect(build({ NODE_ENV: 'production' })).rejects.toThrow(/EMAIL_TRANSPORT is not set/);
    await expect(build({ APP_ENV: 'uat' })).rejects.toThrow(/EMAIL_TRANSPORT is not set/);
    await expect(build({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'memory' })).rejects.toThrow(
      /not allowed in a deployed environment/,
    );
    await expect(build({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'smtp' })).rejects.toThrow(
      /not allowed in production/,
    );
    await expect(build({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'ses' })).rejects.toThrow(
      /SES_FROM_ADDRESS/,
    );
  });

  it('builds in production with EMAIL_TRANSPORT=ses and a from address, without any network call', async () => {
    const moduleRef = await build({
      NODE_ENV: 'production',
      APP_ENV: 'uat',
      EMAIL_TRANSPORT: 'ses',
      SES_FROM_ADDRESS: 'LabConnect <no-reply@labconnect.example>',
      SES_CONFIGURATION_SET: 'labconnect-uat',
      AWS_REGION: 'ap-south-1',
    });
    expect(moduleRef.get(OTP_MAILER)).toBeInstanceOf(EmailOtpMailer);
    await moduleRef.close();
  });

  it('keeps working on a developer machine: Mailpit with SMTP_HOST and SMTP_PORT, nothing else set', async () => {
    const moduleRef = await build({ SMTP_HOST: 'localhost', SMTP_PORT: '1025' });
    expect(moduleRef.get(OTP_MAILER)).toBeInstanceOf(EmailOtpMailer);
    await moduleRef.close();
  });
});
