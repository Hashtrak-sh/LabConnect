import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The one-server demonstration kit (deploy/ec2) is plain files, not CDK. These tests keep the
// compose file, the proxy configuration and the scripts consistent. They read text on purpose: no
// YAML parser is a dependency of this package.

const KIT = new URL('../../deploy/ec2/', import.meta.url);
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, KIT)), 'utf8');

const compose = read('docker-compose.yml');
const caddyfile = read('Caddyfile');
const makeEnv = read('make-env.sh');
const lib = read('lib.sh');
const scripts = readdirSync(fileURLToPath(KIT))
  .filter((name) => name.endsWith('.sh'))
  .map((name) => ({ name, text: read(name) }));

/** The text of one service of the compose file, from its header line to the next one. */
function service(name: string): string {
  const match = new RegExp(
    String.raw`^  ${name}:\n([\s\S]*?)(?=^  [a-z-]+:\n|^volumes:)`,
    'm',
  ).exec(compose);
  if (match?.[1] === undefined) throw new Error(`No service ${name}`);
  return match[1];
}

describe('one-server kit: compose file', () => {
  it('publishes ports from the proxy only', () => {
    expect(compose.split('\n').filter((line) => /^ {4}ports:/.test(line))).toHaveLength(1);
    expect(service('caddy')).toContain('ports:');
    for (const name of ['postgres', 'redis', 'mailpit', 'migrate', 'api', 'web']) {
      expect(service(name), name).not.toMatch(/^ {4}ports:/m);
    }
  });

  it('gives the demo code to the API only, left out when .env does not set it', () => {
    expect(service('api')).toMatch(/^ {6}DEMO_OTP_CODE:\s*$/m);
    expect(service('api')).toMatch(/^ {6}DEMO_OTP_EMAIL_DOMAIN:\s*$/m);
    for (const name of ['web', 'migrate', 'caddy', 'postgres']) {
      expect(service(name), name).not.toContain('DEMO_OTP');
    }
    // A value (even an empty one) would make the API refuse to start when no code is wanted.
    expect(compose).not.toMatch(/DEMO_OTP_\w+: \$\{/);
  });

  it('keeps the web origin in one variable for the web server and the API', () => {
    expect(service('web')).toContain('WEB_BASE_URL: ${WEB_ORIGIN}');
    expect(service('api')).toContain('AUTH_ALLOWED_ORIGINS: ${WEB_ORIGIN}');
    expect(service('caddy')).toContain('WEB_ORIGIN: ${WEB_ORIGIN}');
  });

  it('gives the proxy the gate settings and no application secret', () => {
    const block = service('caddy');
    for (const key of [
      'ACCESS_GATE',
      'GATE_USER',
      'GATE_PASSWORD_HASH',
      'TLS_MODE',
      'SITE_ADDRESS',
    ]) {
      expect(block, key).toContain(`${key}:`);
    }
    expect(block).toMatch(/ACCESS_GATE: \$\{ACCESS_GATE:-on\}/);
    for (const secret of ['AUTH_', 'POSTGRES_PASSWORD', 'API_DB_PASSWORD', 'PAYMENT_']) {
      expect(block, secret).not.toContain(secret);
    }
  });

  it('does not weaken any start-up refusal', () => {
    expect(compose).not.toMatch(/FILES_DEV_AUTO_SCAN/);
    expect(compose).not.toMatch(/FILES_SCANNER:\s*fake/);
    expect(compose).not.toMatch(/EMAIL_TRANSPORT:\s*memory/);
    expect(compose).toMatch(/NODE_ENV: production/);
    expect(compose).toMatch(/APP_ENV: uat/);
  });
});

describe('one-server kit: proxy', () => {
  it('serves nothing of the application on port 80: a redirect to the fixed origin only', () => {
    const http = /^http:\/\/ \{\n([\s\S]*?)^\}/m.exec(caddyfile)?.[1] ?? '';
    expect(http.trim()).toBe('redir {$WEB_ORIGIN}{uri} 308');
    expect(caddyfile).toContain('auto_https disable_redirects');
    expect(caddyfile).toContain('strict_sni_host on');
  });

  it('has no plain-HTTP site address mode', () => {
    expect(caddyfile).not.toMatch(/or `:80` \(plain HTTP/);
    expect(makeEnv).not.toMatch(/^\s*--ip\)/m);
    expect(makeEnv).not.toContain('site_address=":80"');
    expect(lib).toContain("Plain HTTP (':80') no longer exists");
  });

  it('imports the gate, the Mailpit rule and the TLS mode from files that exist', () => {
    expect(caddyfile).toContain('import /etc/caddy/snippets/gate/{$ACCESS_GATE}.caddy');
    expect(caddyfile).toContain('import /etc/caddy/snippets/mailpit/{$ACCESS_GATE}.caddy');
    expect(caddyfile).toContain('import /etc/caddy/snippets/tls/{$TLS_MODE}.caddy');
    const names = (dir: string): string[] =>
      readdirSync(fileURLToPath(new URL(`caddy/${dir}/`, KIT))).sort();
    expect(names('gate')).toEqual(['off.caddy', 'on.caddy']);
    expect(names('mailpit')).toEqual(['off.caddy', 'on.caddy']);
    expect(names('tls')).toEqual(['auto.caddy', 'internal.caddy']);
    expect(read('caddy/gate/on.caddy')).toContain('basic_auth bcrypt');
    // With the gate off Mailpit keeps its own password.
    expect(read('caddy/mailpit/off.caddy')).toContain('basic_auth');
    expect(read('caddy/mailpit/on.caddy')).not.toContain('basic_auth');
  });

  it('strips the gate credentials before the web app and Mailpit', () => {
    expect(caddyfile.match(/header_up -Authorization/g)).toHaveLength(2);
    expect([...caddyfile.matchAll(/reverse_proxy (\S+)/g)].map((m) => m[1]).sort()).toEqual([
      'mailpit:8025',
      'web:3000',
    ]);
  });

  it('mounts the snippets into the proxy', () => {
    expect(service('caddy')).toContain('./caddy:/etc/caddy/snippets:ro');
  });
});

describe('one-server kit: settings and scripts', () => {
  it('has make-env.sh ask for the gate and the demo code without printing a secret', () => {
    expect(makeEnv).toContain('ACCESS_GATE');
    expect(makeEnv).toContain('GATE_PASSWORD_HASH');
    expect(makeEnv).toContain('DEMO_OTP_CODE');
    expect(makeEnv).toContain('read -rsp');
    expect(makeEnv).toContain('.gate-password');
    expect(makeEnv).toContain('umask 077');
    expect(makeEnv).not.toMatch(/echo .*\$gate_password/);
    expect(makeEnv).not.toMatch(/--plaintext/);
  });

  it('has every variable the compose file requires in make-env.sh', () => {
    const required = [...compose.matchAll(/\$\{([A-Z0-9_]+)(?:[}:])/g)].map((m) => m[1] ?? '');
    for (const key of new Set(required)) {
      if (['PLATFORM_ADMIN_EMAIL', 'PLATFORM_ADMIN_NAME'].includes(key)) continue;
      expect(makeEnv, key).toMatch(new RegExp(`${key}`));
    }
  });

  it('keeps the real .env and the backups out of git', () => {
    const ignore = read('.gitignore').split('\n');
    for (const entry of ['.env', '.gate-password', 'backups/']) expect(ignore).toContain(entry);
  });

  it('stop on the first error and say what failed', () => {
    expect(lib).toContain('set -euo pipefail');
    expect(lib).toContain('trap on_exit EXIT');
    for (const { name, text } of scripts) {
      if (['lib.sh', 'make-env.sh', 'setup-ec2.sh'].includes(name)) continue;
      expect(text, name).toContain('. "$(dirname "$0")/lib.sh"');
    }
  });

  it('makes reset-demo ask for an explicit flag, say what it destroys, and keep the certificates', () => {
    const reset = scripts.find((s) => s.name === 'reset-demo.sh')?.text ?? '';
    expect(reset).toContain('--yes-destroy-the-database');
    expect(reset).toContain('This will DESTROY');
    expect(reset).not.toMatch(/volume rm .*caddy/);
    expect(reset).not.toMatch(/down .*(-v|--volumes)/);
  });

  it('refuses the local certificate mode for a real domain', () => {
    expect(lib).toMatch(/TLS_MODE=internal[\s\S]*needs a \*\.localhost name/);
    expect(makeEnv).toContain('A .localhost name is for --local only');
    expect(makeEnv).toContain('LOCAL VERIFICATION MODE');
  });

  it('uses the proxy image the gate password is hashed with', () => {
    const image = /image: (caddy:\S+)/.exec(service('caddy'))?.[1];
    expect(image).toBeDefined();
    expect(makeEnv).toContain(image ?? '');
  });
});
