import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

const dockerfile = read('Dockerfile');
const ignore = read('.dockerignore').split(/\r?\n/);

/** The text of one build target, from its FROM line to the next. */
function target(name: string): string {
  const parts = dockerfile.split(/^FROM /m).slice(1);
  const found = parts.find((part) =>
    new RegExp(String.raw`\bAS ${name}\s*$`).test(part.split('\n')[0] ?? ''),
  );
  if (found === undefined) throw new Error(`No target ${name}`);
  return found;
}

describe('Dockerfile', () => {
  it.each(['api', 'worker', 'migrate'])(
    'builds the %s image and runs it as the unprivileged user',
    (name) => {
      const text = target(name);
      expect(text).toMatch(/^USER node$/m);
      expect(text).toMatch(/^(CMD|ENTRYPOINT) /m);
    },
  );

  it('keeps secrets out of the images', () => {
    expect(dockerfile).not.toMatch(/^\s*(ENV|ARG)\s+\w*(SECRET|PASSWORD|PRIVATE_KEY|TOKEN)\w*/im);
    expect(dockerfile).not.toMatch(/COPY .*\.env\b(?!\.example)/);
  });

  it('keeps local configuration and keys out of the build context', () => {
    expect(ignore).toContain('.env');
    expect(ignore).toContain('.env.*');
    expect(ignore).toContain('!.env.example');
    expect(ignore).toContain('**/node_modules');
    expect(ignore).toContain('**/*.pem');
  });

  it('verifies the database certificate with the RDS bundle in every image that connects', () => {
    for (const name of ['api', 'worker', 'migrate']) {
      const text = name === 'migrate' ? target('migrate') : dockerfile;
      expect(text).toContain('NODE_EXTRA_CA_CERTS=/etc/ssl/rds-global-bundle.pem');
    }
  });

  it('runs the migration steps in the order the task definition does', () => {
    expect(target('migrate')).toMatch(
      /prisma migrate deploy && node create-login-users\.mjs && node dist\/seed\/cli\.js reference/,
    );
  });
});
