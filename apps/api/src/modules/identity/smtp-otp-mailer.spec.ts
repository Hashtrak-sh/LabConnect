import 'reflect-metadata';
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SmtpOtpMailer } from './smtp-otp-mailer.js';

/** A very small SMTP server: enough of RFC 5321 to accept one message and keep what it was sent. */
function fakeSmtp(): Promise<{ port: number; messages: string[]; close: () => Promise<void> }> {
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let data = false;
    let body = '';
    let buffer = '';
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('latin1');
      for (;;) {
        if (data) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          body = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          messages.push(body);
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

describe('SmtpOtpMailer', () => {
  let closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(closers.map((close) => close()));
    closers = [];
  });

  it('sends the code to the address over SMTP', async () => {
    const smtp = await fakeSmtp();
    closers.push(smtp.close);
    const mailer = new SmtpOtpMailer({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.port),
      MAIL_FROM: 'LabConnect <no-reply@example.test>',
    });
    await mailer.sendLoginOtp({ to: 'user@example.test', code: '482915', validForMinutes: 10 });
    expect(smtp.messages).toHaveLength(1);
    const message = smtp.messages[0] ?? '';
    expect(message).toMatch(/^From: LabConnect <no-reply@example.test>/m);
    expect(message).toMatch(/^To: user@example.test/m);
    expect(message).toMatch(/^Subject: Your LabConnect sign-in code/m);
    expect(message).toContain('Your sign-in code is 482915.');
    expect(message).toContain('valid for 10 minutes');
  });

  it('connects only when it first sends, and says what is missing without a value', async () => {
    const mailer = new SmtpOtpMailer({});
    await expect(
      mailer.sendLoginOtp({ to: 'user@example.test', code: '123456', validForMinutes: 10 }),
    ).rejects.toThrow('SMTP_HOST is not set');
  });

  it('does not put the code into the error when the server is unreachable', async () => {
    const mailer = new SmtpOtpMailer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '1' });
    const error = await mailer
      .sendLoginOtp({ to: 'user@example.test', code: '654321', validForMinutes: 10 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('654321');
  });
});
