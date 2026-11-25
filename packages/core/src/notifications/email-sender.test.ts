import { createServer, type Server, type Socket } from 'node:net';
import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEmailSender,
  EmailConfigError,
  type EmailMessage,
  EmailSendError,
  InMemoryEmailSender,
  NOTIFICATION_HEADER,
  selectEmailTransport,
  SesEmailSender,
  type SesClientLike,
  SmtpEmailSender,
} from './email-sender.js';

const MESSAGE: EmailMessage = {
  to: 'user@example.test',
  subject: 'Booking LC-1 accepted',
  text: 'Plain text body',
  html: '<p>Html body</p>',
  notificationId: '0190b1f2-0000-7000-8000-000000000001',
};

/** A very small SMTP server: enough of RFC 5321 to accept one message and keep what it was sent. */
function fakeSmtp(
  reject?: string,
): Promise<{ port: number; messages: string[]; close: () => Promise<void> }> {
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let data = false;
    let buffer = '';
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('latin1');
      for (;;) {
        if (data) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          messages.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          data = false;
          socket.write('250 queued\r\n');
          continue;
        }
        const eol = buffer.indexOf('\r\n');
        if (eol < 0) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250 fake\r\n');
        else if (verb === 'RCPT' && reject) socket.write(`${reject}\r\n`);
        else if (verb === 'DATA') {
          data = true;
          socket.write('354 go ahead\r\n');
        } else if (verb === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : 0,
        messages,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

describe('InMemoryEmailSender', () => {
  it('keeps what it sends and numbers the messages', async () => {
    const sender = new InMemoryEmailSender();
    expect(await sender.send(MESSAGE)).toEqual({ providerMessageId: 'memory-1' });
    expect(sender.sent).toEqual([MESSAGE]);
  });

  it('fails when told to, and keeps nothing', async () => {
    const sender = new InMemoryEmailSender();
    sender.onSend = () => {
      throw new EmailSendError('down', false);
    };
    await expect(sender.send(MESSAGE)).rejects.toThrow('down');
    expect(sender.sent).toEqual([]);
  });
});

describe('SmtpEmailSender', () => {
  let closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(closers.map((close) => close()));
    closers = [];
  });

  it('sends the message to the server with both parts and the notification header', async () => {
    const smtp = await fakeSmtp();
    closers.push(smtp.close);
    const sender = new SmtpEmailSender({
      host: '127.0.0.1',
      port: smtp.port,
      from: 'LabConnect <no-reply@example.test>',
    });
    const result = await sender.send(MESSAGE);
    expect(result.providerMessageId).toMatch(/^<.+>$/);
    expect(smtp.messages).toHaveLength(1);
    const raw = smtp.messages[0] ?? '';
    expect(raw).toContain('To: user@example.test');
    expect(raw).toContain('From: LabConnect <no-reply@example.test>');
    expect(raw).toContain('Subject: Booking LC-1 accepted');
    expect(raw.toLowerCase()).toContain(
      `${NOTIFICATION_HEADER}: ${MESSAGE.notificationId}`.toLowerCase(),
    );
    expect(raw).toContain('Plain text body');
    expect(raw).toContain('<p>Html body</p>');
  });

  it('treats a 5xx answer as permanent and a refused connection as temporary', async () => {
    const smtp = await fakeSmtp('550 no such user');
    closers.push(smtp.close);
    const refusing = new SmtpEmailSender({ host: '127.0.0.1', port: smtp.port, from: 'a@b.test' });
    await expect(refusing.send(MESSAGE)).rejects.toMatchObject({ permanent: true });

    const unreachable = new SmtpEmailSender({ host: '127.0.0.1', port: 1, from: 'a@b.test' });
    await expect(unreachable.send(MESSAGE)).rejects.toMatchObject({ permanent: false });
  });
});

describe('SesEmailSender', () => {
  function stub(outcome: { id?: string; error?: Error }): {
    client: SesClientLike;
    commands: SendEmailCommand[];
  } {
    const commands: SendEmailCommand[] = [];
    return {
      commands,
      client: {
        send(command) {
          commands.push(command);
          return outcome.error
            ? Promise.reject(outcome.error)
            : Promise.resolve({ MessageId: outcome.id ?? 'ses-1' });
        },
      },
    };
  }

  it('builds a SendEmail request with the sender, the configuration set and both bodies', async () => {
    const { client, commands } = stub({ id: 'ses-message-1' });
    const sender = new SesEmailSender(client, {
      from: 'LabConnect <no-reply@labconnect.example>',
      configurationSet: 'labconnect-prod',
    });
    expect(await sender.send(MESSAGE)).toEqual({ providerMessageId: 'ses-message-1' });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.input).toEqual({
      FromEmailAddress: 'LabConnect <no-reply@labconnect.example>',
      Destination: { ToAddresses: ['user@example.test'] },
      ConfigurationSetName: 'labconnect-prod',
      Content: {
        Simple: {
          Subject: { Data: 'Booking LC-1 accepted', Charset: 'UTF-8' },
          Body: {
            Text: { Data: 'Plain text body', Charset: 'UTF-8' },
            Html: { Data: '<p>Html body</p>', Charset: 'UTF-8' },
          },
          Headers: [{ Name: NOTIFICATION_HEADER, Value: MESSAGE.notificationId }],
        },
      },
    });
  });

  it('leaves the configuration set out when none is configured', async () => {
    const { client, commands } = stub({});
    await new SesEmailSender(client, { from: 'a@b.test' }).send(MESSAGE);
    expect(commands[0]?.input).not.toHaveProperty('ConfigurationSetName');
  });

  it('marks a refused message as permanent and a throttle as temporary, keeping no message text', async () => {
    const rejected = Object.assign(new Error('Email address is not verified: user@example.test'), {
      name: 'MessageRejected',
    });
    const throttled = Object.assign(new Error('slow down'), { name: 'TooManyRequestsException' });
    const permanent = await new SesEmailSender(stub({ error: rejected }).client, {
      from: 'a@b.test',
    })
      .send(MESSAGE)
      .catch((error: unknown) => error);
    expect(permanent).toBeInstanceOf(EmailSendError);
    expect((permanent as EmailSendError).permanent).toBe(true);
    expect((permanent as EmailSendError).message).not.toContain('user@example.test');
    await expect(
      new SesEmailSender(stub({ error: throttled }).client, { from: 'a@b.test' }).send(MESSAGE),
    ).rejects.toMatchObject({ permanent: false });
  });
});

describe('selecting the transport', () => {
  it('uses SMTP for Mailpit when a host is set and memory otherwise, on a developer machine', () => {
    expect(selectEmailTransport({})).toBe('memory');
    expect(selectEmailTransport({ SMTP_HOST: 'localhost' })).toBe('smtp');
    expect(selectEmailTransport({ NODE_ENV: 'development', SMTP_HOST: 'localhost' })).toBe('smtp');
    expect(selectEmailTransport({ NODE_ENV: 'test' })).toBe('memory');
  });

  it('follows EMAIL_TRANSPORT when it is set', () => {
    expect(selectEmailTransport({ EMAIL_TRANSPORT: 'SES' })).toBe('ses');
    expect(selectEmailTransport({ EMAIL_TRANSPORT: 'smtp' })).toBe('smtp');
    expect(selectEmailTransport({ EMAIL_TRANSPORT: 'memory' })).toBe('memory');
    expect(() => selectEmailTransport({ EMAIL_TRANSPORT: 'sendgrid' })).toThrow(EmailConfigError);
  });

  it('refuses to run in production without a real sender, and never falls back to memory', () => {
    expect(() => selectEmailTransport({ NODE_ENV: 'production' })).toThrow(
      /EMAIL_TRANSPORT is not set/,
    );
    expect(() => selectEmailTransport({ APP_ENV: 'production' })).toThrow(
      /EMAIL_TRANSPORT is not set/,
    );
    expect(() => selectEmailTransport({ APP_ENV: 'uat' })).toThrow(/EMAIL_TRANSPORT is not set/);
    expect(() => selectEmailTransport({ NODE_ENV: 'production', SMTP_HOST: 'localhost' })).toThrow(
      /EMAIL_TRANSPORT is not set/,
    );
    expect(() =>
      selectEmailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'memory' }),
    ).toThrow(/not allowed in a deployed environment/);
    expect(() => selectEmailTransport({ APP_ENV: 'uat', EMAIL_TRANSPORT: 'memory' })).toThrow(
      EmailConfigError,
    );
    expect(() => selectEmailTransport({ APP_ENV: 'production', EMAIL_TRANSPORT: 'smtp' })).toThrow(
      /not allowed in production/,
    );
    expect(() => selectEmailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'smtp' })).toThrow(
      /not allowed in production/,
    );
    expect(selectEmailTransport({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'ses' })).toBe('ses');
    // UAT runs the production build and may use Mailpit.
    expect(
      selectEmailTransport({ NODE_ENV: 'production', APP_ENV: 'uat', EMAIL_TRANSPORT: 'smtp' }),
    ).toBe('smtp');
  });

  it('builds the sender and checks its settings', async () => {
    expect(createEmailSender({ env: {} }).sender).toBeInstanceOf(InMemoryEmailSender);
    expect(
      createEmailSender({ env: { SMTP_HOST: 'localhost', SMTP_PORT: '1025' } }).sender,
    ).toBeInstanceOf(SmtpEmailSender);
    expect(() => createEmailSender({ env: { EMAIL_TRANSPORT: 'smtp' } })).toThrow(/SMTP_HOST/);
    expect(() =>
      createEmailSender({ env: { EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'h', SMTP_PORT: 'x' } }),
    ).toThrow(/SMTP_PORT/);
    expect(() => createEmailSender({ env: { EMAIL_TRANSPORT: 'ses' } })).toThrow(
      /SES_FROM_ADDRESS/,
    );

    // SES: the client is built on the first send, from the injected factory, never from the network.
    const commands: SendEmailCommand[] = [];
    let built = 0;
    const { sender, transport } = createEmailSender({
      env: {
        EMAIL_TRANSPORT: 'ses',
        SES_FROM_ADDRESS: 'LabConnect <no-reply@labconnect.example>',
        SES_CONFIGURATION_SET: 'set-1',
      },
      sesClient: () => {
        built += 1;
        return Promise.resolve({
          send(command) {
            commands.push(command);
            return Promise.resolve({ MessageId: 'x' });
          },
        });
      },
    });
    expect(transport).toBe('ses');
    expect(built).toBe(0);
    await sender.send(MESSAGE);
    await sender.send(MESSAGE);
    expect(built).toBe(1);
    expect(commands[0]?.input.ConfigurationSetName).toBe('set-1');
  });
});
