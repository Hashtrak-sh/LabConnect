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
  it.each(['api', 'worker', 'migrate', 'web'])(
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

  describe('the web target', () => {
    const web = target('web');
    it('is built from the production dependencies of the web app only, in a stage of its own', () => {
      expect(web).toMatch(/COPY --from=web-bundle --chown=node:node \/bundle \/app/);
      expect(target('web-bundle')).toContain(
        'pnpm --filter @labconnect/web deploy --prod --legacy /bundle',
      );
      expect(target('web-build')).toContain('pnpm --filter "@labconnect/web..." run build');
      // The api and worker images do not wait for it.
      expect(target('api')).not.toContain('web-bundle');
      expect(target('worker')).not.toContain('web-bundle');
    });
    it('listens on one port, 3000, on all addresses, and starts Next.js', () => {
      expect(web.match(/^EXPOSE .*$/gm)).toEqual(['EXPOSE 3000']);
      expect(web).toMatch(/PORT=3000/);
      expect(web).toContain('"--hostname", "0.0.0.0"');
      expect(web).toMatch(/^CMD \["node", "node_modules\/next\/dist\/bin\/next", "start"/m);
    });
    it('holds no secret and no API address (both come from the task definition at start)', () => {
      expect(web).not.toMatch(/API_BASE_URL/);
      expect(web).not.toMatch(/\b(ENV|ARG)\s+\w*(SECRET|PASSWORD|PRIVATE_KEY|TOKEN|DATABASE)/i);
      expect(web).not.toContain('rds-global-bundle');
    });
    it('keeps the web source in the build context, and nothing the build writes', () => {
      expect(ignore).not.toContain('apps/web/*');
      expect(ignore).toContain('**/.next');
      expect(ignore).toContain('**/node_modules');
    });
    it('makes no outbound call of its own while building or running (telemetry off)', () => {
      expect(target('web-build')).toContain('NEXT_TELEMETRY_DISABLED=1');
      expect(web).toContain('NEXT_TELEMETRY_DISABLED=1');
    });
  });

  it('runs the migration steps in the order the task definition does', () => {
    expect(target('migrate')).toMatch(
      /prisma migrate deploy && node create-login-users\.mjs && node dist\/seed\/cli\.js reference/,
    );
  });
});
