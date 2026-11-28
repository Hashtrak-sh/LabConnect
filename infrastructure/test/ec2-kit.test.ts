import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
      expect(makeEnv, key).toMatch(new RegExp(key));
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

  it('records the script process id in the lock, so a live script is told apart from a dead one', () => {
    expect(lib).toContain('echo $$ >"$lock/pid"');
    expect(lib).toContain('kill -0 "$owner"');
  });

  it('checks the free disk space before building on update', () => {
    const update = scripts.find((s) => s.name === 'update.sh')?.text ?? '';
    const check = update.indexOf('\nensure_build_space');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(update.indexOf('\ndc build'));
    // Bounded to the function body: `\n}` ends it, so a `die` of a later function does not count.
    const body = /\nensure_build_space\(\) \{\n([\s\S]*?)\n\}/.exec(lib)?.[1] ?? '';
    expect(body).toContain('docker builder prune -af');
    expect(body.indexOf(' die ', body.indexOf('docker builder prune -af'))).toBeGreaterThan(-1);
    // The options are read before anything touches Docker; anything but --fresh is refused.
    expect(update.indexOf('--fresh) build_mode=fresh ;;')).toBeGreaterThan(-1);
    expect(update.indexOf('--fresh) build_mode=fresh ;;')).toBeLessThan(
      update.indexOf('\nneed_docker'),
    );
    expect(update).toContain('ensure_build_space "$build_mode"');
    expect(update).toMatch(/\*\) die "unknown option/);
  });

  // Runs the real function under bash with `docker` and `df` replaced by stubs. CI runs on Linux;
  // on Windows `bash` may be WSL's, which cannot see this path, so it is skipped there.
  describe.skipIf(process.platform === 'win32')('ensure_build_space under bash', () => {
    const functions = ['docker_free_gb', 'ensure_build_space']
      .map((name) => new RegExp(String.raw`\n(${name}\(\) \{\n[\s\S]*?\n\})`).exec(lib)?.[1] ?? '')
      .join('\n');

    /** Free GB that `df` reports on each call, in order; returns what the run printed. */
    function run(freeGb: (number | 'fail')[], mode = '', minBuildGb?: string) {
      const script = [
        'set -euo pipefail',
        // `df` runs in a command substitution (a subshell): the call count lives in a file.
        `seq=(${freeGb.join(' ')}); counter=$(mktemp); echo 0 >"$counter"`,
        // The prune calls send stdout to /dev/null: the stub reports on stderr, merged in order.
        'exec 2>&1',
        'docker() { case "$1" in info) echo /var/lib/docker ;; *) echo "DOCKER $*" >&2 ;; esac; }',
        'df() { local i v; i=$(<"$counter"); v=${seq[$i]}; echo $((i + 1)) >"$counter";',
        '  [[ $v == fail ]] && return 1;',
        "  printf 'F 1 U A C M\\n/dev/root 1 1 %s 1%% /\\n' $((v * 1024 * 1024)); }",
        'step() { :; }; info() { echo "INFO $*"; }; warn() { echo "WARN $*"; }',
        'die() { echo "DIE $*"; exit 1; }',
        functions,
        `ensure_build_space '${mode}' && echo BUILD`,
      ].join('\n');
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf8',
        env: { ...process.env, MIN_BUILD_GB: minBuildGb ?? '' },
      });
      return result.stdout;
    }

    it('builds with the cache when there is room', () => {
      const out = run([25]);
      expect(out).toContain('BUILD');
      expect(out).not.toContain('DOCKER builder prune');
    });

    it('clears and builds when the clean-up frees enough, and warns below 12 GB', () => {
      expect(run([6, 14])).toMatch(/DOCKER builder prune -af[\s\S]*BUILD/);
      expect(run([6, 11])).toMatch(/WARN building from scratch with 11 GB[\s\S]*BUILD/);
    });

    it('stops before building when the clean-up does not free enough', () => {
      const out = run([6, 8]);
      expect(out).toContain('DIE only 8 GB free');
      expect(out).not.toContain('BUILD');
    });

    it('always clears with --fresh, even with room or an unknown free space', () => {
      expect(run([25, 32], 'fresh')).toMatch(/DOCKER builder prune -af[\s\S]*BUILD/);
      expect(run(['fail'], 'fresh')).toMatch(/DOCKER builder prune -af[\s\S]*BUILD/);
    });

    it('refuses a MIN_BUILD_GB that is not a whole number, before deleting anything', () => {
      const out = run([4], '', '10GB');
      expect(out).toContain('DIE MIN_BUILD_GB must be a whole number');
      expect(out).not.toContain('DOCKER');
    });
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
