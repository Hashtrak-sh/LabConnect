// Checks that the demonstration works on a RUNNING single-server deployment, from outside, the
// way a visitor reaches it. Needs only Node 24 (global fetch) and the site's base URL.
//
//   node check/check.mjs https://uat.example.org            safe mode (changes nothing lasting)
//   node check/check.mjs https://uat.example.org --rehearsal   plays the whole story (USES UP DEMO DATA)
//
// Settings come from the environment, never the command line (a command line stays in the
// shell history and in `ps`):
//   DEMO_OTP_CODE   the demo sign-in code (required)
//   GATE_USER, GATE_PASSWORD   the access gate's credentials (required unless EXPECT_GATE=off)
//   EXPECT_GATE     on (the default) or off: what the deployment is configured with
//   HTTP_PORT       the proxy's HTTP port (default 80; 58080 in local verification)
//   NODE_EXTRA_CA_CERTS   a CA file, for local verification (Caddy's own CA) only
//   WALK_SCRIPT     rehearsal: path of apps/web/test/e2e-walk.mjs (default: this repository's)
//   DB_CONTAINER    rehearsal: the Postgres container name, for the walk's one database check
//
// Safe mode makes ONE sign-in as the demo customer (one one-time-code request, which counts
// against the API's limit of 20 per hour per address, DEMO.md "Sign-in limits") and leaves a
// session row that ends at sign-out. It is sequential on purpose: two simultaneous session
// refreshes sign the user out (a known weakness being fixed elsewhere), so nothing here refreshes twice at once.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const baseArg = args.find((a) => !a.startsWith('--'));
const REHEARSAL = args.includes('--rehearsal');
if (baseArg === undefined || args.some((a) => a.startsWith('--') && a !== '--rehearsal')) {
  console.error('usage: node check/check.mjs <https://base-url> [--rehearsal]');
  process.exit(2);
}
const BASE = new URL(baseArg);
if (BASE.protocol !== 'https:') {
  console.error('The base URL must be https://. The demonstration has no plain-HTTP mode.');
  process.exit(2);
}
const ORIGIN = BASE.origin;
const EXPECT_GATE = (process.env.EXPECT_GATE ?? 'on') === 'on';
const GATE_USER = process.env.GATE_USER ?? '';
const GATE_PASSWORD = process.env.GATE_PASSWORD ?? '';
const CODE = process.env.DEMO_OTP_CODE ?? '';
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 80);
if (!/^\d{6}$/.test(CODE)) {
  console.error('Set DEMO_OTP_CODE (six digits) in the environment.');
  process.exit(2);
}
if (EXPECT_GATE && (GATE_USER === '' || GATE_PASSWORD === '')) {
  console.error('Set GATE_USER and GATE_PASSWORD in the environment (or EXPECT_GATE=off).');
  process.exit(2);
}
const AUTH = `Basic ${Buffer.from(`${GATE_USER}:${GATE_PASSWORD}`).toString('base64')}`;
// Test hook: headers added to every request, e.g. a forged X-Forwarded-For (JSON object in the environment).
const EXTRA_HEADERS = JSON.parse(process.env.EXTRA_HEADERS ?? '{}');
const CUSTOMER = 'customer.admin.demo1@demo.labconnect.test';
const TIMEOUT = AbortSignal.timeout;

let failures = 0;
let checks = 0;
function check(ok, label, detail = '') {
  checks++;
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} - ${label}${ok || detail === '' ? '' : `\n         ${detail}`}`,
  );
}
function note(text) {
  console.log(`       ${text}`);
}
function step(title) {
  console.log(`\n== ${title}`);
}

// ---- a browser without JavaScript: cookie jar, hand-followed redirects, the gate's header ----------
class Browser {
  constructor({ gate = true } = {}) {
    this.gate = gate;
    this.cookies = new Map();
    this.setCookieLines = [];
    this.referer = null;
  }
  header(pathname) {
    return [...this.cookies]
      .filter(([, c]) => pathname.startsWith(c.path))
      .map(([n, c]) => `${n}=${c.value}`)
      .join('; ');
  }
  store(response) {
    for (const line of response.headers.getSetCookie()) {
      this.setCookieLines.push(line);
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const attr = (key) =>
        attrs
          .map((a) => a.trim())
          .find((a) => a.toLowerCase().startsWith(`${key}=`))
          ?.split('=')[1];
      const maxAge = attr('max-age');
      const expires = attr('expires');
      const gone =
        value === '' ||
        (maxAge !== undefined && Number(maxAge) <= 0) ||
        (expires !== undefined && new Date(expires).getTime() < Date.now() && maxAge === undefined);
      if (gone) this.cookies.delete(name);
      else this.cookies.set(name, { value, path: attr('path') ?? '/' });
    }
  }
  async raw(method, path, { body, headers = {} } = {}) {
    const url = new URL(path, ORIGIN);
    const response = await fetch(url, {
      method,
      body,
      redirect: 'manual',
      signal: TIMEOUT(30_000),
      headers: {
        ...(this.gate && EXPECT_GATE ? { Authorization: AUTH } : {}),
        Cookie: this.header(url.pathname),
        ...(method === 'POST' ? { Origin: ORIGIN } : {}),
        ...(this.referer === null ? {} : { Referer: this.referer }),
        ...EXTRA_HEADERS,
        ...headers,
      },
    });
    this.store(response);
    const redirected = response.status >= 300 && response.status < 400;
    const text = redirected ? '' : await response.text();
    return {
      status: response.status,
      headers: response.headers,
      html: text,
      location: response.headers.get('location'),
      url: url.href,
    };
  }
  async go(method, path, options = {}) {
    let result = await this.raw(method, path, options);
    let hops = 0;
    while (result.location !== null && hops++ < 8) {
      const next = new URL(result.location, result.url);
      if (next.origin !== ORIGIN) return result;
      result = await this.raw('GET', next.pathname + next.search);
    }
    return result;
  }
}

const decode = (text) =>
  text
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&#x2F;', '/')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
const textOf = (html) => decode(html.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' '));
function attrsOf(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:$-]+)(?:="([^"]*)")?/g))
    out[m[1]] = m[2] === undefined ? '' : decode(m[2]);
  return out;
}
function forms(html, pageUrl) {
  const found = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    const attrs = attrsOf(m[1]);
    const fields = [];
    for (const input of m[2].matchAll(/<input\b([^>]*)>/g)) {
      const a = attrsOf(input[1]);
      if (a.name !== undefined && a.type !== 'submit' && a.type !== 'file')
        fields.push([a.name, a.value ?? '']);
    }
    const buttons = [...m[2].matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((b) => ({
      ...attrsOf(b[1]),
      text: textOf(b[2]),
    }));
    found.push({ action: attrs.action ?? '', fields, buttons, text: textOf(m[2]), pageUrl });
  }
  return found;
}
function submit(browser, form, { set = {}, button } = {}) {
  const data = new FormData();
  const used = new Set();
  for (const [name, value] of form.fields) {
    if (name in set) {
      if (!used.has(name)) data.append(name, set[name]);
      used.add(name);
    } else data.append(name, value);
  }
  for (const [name, value] of Object.entries(set)) if (!used.has(name)) data.append(name, value);
  const pressed = form.buttons.find((b) => b.value === button || b.text === button);
  if (pressed?.name) data.append(pressed.name, pressed.value ?? '');
  const target = new URL(form.action === '' ? form.pageUrl : form.action, form.pageUrl);
  return browser.go('POST', target.pathname + target.search, { body: data });
}
const formWith = (html, url, needle) =>
  forms(html, url).find(
    (f) =>
      f.text.includes(needle) ||
      f.buttons.some((b) => b.text.includes(needle) || b.value === needle),
  );

// ---- low-level probes ---------------------------------------------------------------------------------
/** A request over plain HTTP with an arbitrary Host header (fetch forbids setting Host). */
function httpProbe({ port, path = '/', host, headers = {} }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: BASE.hostname,
        port,
        path,
        method: 'GET',
        headers: { Host: host, ...headers },
        timeout: 15_000,
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, body }),
        );
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end();
  });
}
/** Whether a TCP connection to the site's host on `port` succeeds. */
function canConnect(port, ms = 4000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: BASE.hostname, port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(ms, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}
function certificate() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: BASE.hostname, port: Number(BASE.port || 443), servername: BASE.hostname },
      () => {
        const peer = socket.getPeerCertificate();
        const result = { authorized: socket.authorized, error: socket.authorizationError, peer };
        socket.end();
        resolve(result);
      },
    );
    socket.setTimeout(15_000, () => socket.destroy(new Error('timeout')));
    socket.on('error', reject);
  });
}

// ====================================================================================================
console.log(
  `LabConnect one-server demonstration check: ${ORIGIN}   mode: ${REHEARSAL ? 'REHEARSAL' : 'safe'}   gate expected: ${EXPECT_GATE ? 'on' : 'off'}`,
);
if (REHEARSAL) {
  console.log(`
################################################################################
# REHEARSAL: this plays the whole story and USES UP THE DEMO DATA.             #
# Afterwards the Platform Ops account is enrolled with an authenticator secret #
# that NOBODY holds, and labs are claimed. You MUST run  ./reset-demo.sh #
# before the real demonstration. The safe check below runs first.              #
################################################################################`);
}

step('1. certificate and port 80');
try {
  const cert = await certificate();
  check(
    cert.authorized === true,
    'HTTPS answers with a certificate the system trusts',
    String(cert.error),
  );
  const days = Math.floor((new Date(cert.peer.valid_to).getTime() - Date.now()) / 86_400_000);
  const issuer = cert.peer.issuer ?? {};
  if (/Caddy Local Authority/.test(`${issuer.O ?? ''}${issuer.CN ?? ''}`)) {
    // Local verification only: Caddy's own CA issues 12-hour certificates and renews them itself.
    note(`LOCAL VERIFICATION certificate (valid ${days} more days, renewed by Caddy itself)`);
  } else {
    check(
      days >= 7,
      `the certificate is valid for ${days} more days (renewal is automatic, through port 80)`,
    );
  }
  note(`issuer: ${issuer.O ?? issuer.CN ?? '?'}; subject: ${cert.peer.subject?.CN ?? '?'}`);
} catch (error) {
  check(false, 'HTTPS answers', String(error));
}
try {
  const plain = await httpProbe({
    port: HTTP_PORT,
    path: '/search?q=TDS',
    host: BASE.host.replace(/:\d+$/, ''),
  });
  check(
    [301, 302, 307, 308].includes(plain.status) &&
      plain.headers.location === `${ORIGIN}/search?q=TDS`,
    'port 80: the application path only redirects to HTTPS on the fixed origin',
    `${String(plain.status)} ${String(plain.headers.location)}`,
  );
  check(
    plain.body === '' || !/<html/i.test(plain.body),
    'port 80: no application content in the answer',
  );
  const forged = await httpProbe({ port: HTTP_PORT, path: '/', host: 'evil.example' });
  check(
    forged.headers.location === undefined || forged.headers.location.startsWith(`${ORIGIN}/`),
    'port 80: a forged Host header is not echoed into the redirect',
    String(forged.headers.location),
  );
  check(!/<html/i.test(forged.body), 'port 80: a forged Host gets no application content');
  const health = await httpProbe({ port: HTTP_PORT, path: '/health', host: BASE.hostname });
  check(
    health.status !== 200 && health.headers['www-authenticate'] === undefined,
    'port 80: /health is a redirect, not the app and not a gate prompt',
    String(health.status),
  );
  const challenge = await httpProbe({
    port: HTTP_PORT,
    path: '/.well-known/acme-challenge/lc-check',
    host: BASE.hostname,
  });
  check(
    challenge.status !== 200 &&
      challenge.headers['www-authenticate'] === undefined &&
      !/<html/i.test(challenge.body),
    'port 80: the certificate-challenge path answers with the challenge handler or a redirect only',
    String(challenge.status),
  );
} catch (error) {
  check(false, `port ${String(HTTP_PORT)} answers`, String(error));
}

step('2. the gate');
if (EXPECT_GATE) {
  const anon = new Browser({ gate: false });
  for (const path of [
    '/',
    '/health',
    '/search?q=TDS',
    '/api/suggest?q=TDS',
    '/v1/health',
    '/mailpit/',
  ]) {
    const r = await anon.raw('GET', path);
    check(
      r.status === 401 &&
        /^basic/i.test(r.headers.get('www-authenticate') ?? '') &&
        !/<html[\s\S]*LabConnect/i.test(r.html),
      `without credentials ${path} is refused (401) before the app`,
      String(r.status),
    );
  }
  const wrong = await fetch(ORIGIN, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${GATE_USER}:wrong-password`).toString('base64')}`,
    },
    signal: TIMEOUT(30_000),
  });
  check(wrong.status === 401, 'a wrong password is refused (401)', String(wrong.status));
} else {
  note(
    'EXPECT_GATE=off: the gate checks are skipped (the site is open to everyone who can reach port 443)',
  );
}

step('3. pages without signing in');
const visitor = new Browser();
{
  const health = await visitor.raw('GET', '/health');
  check(
    health.status === 200 && /"status"\s*:\s*"ok"/.test(health.html),
    '/health answers {"status":"ok"}',
    `${String(health.status)} ${health.html.slice(0, 80)}`,
  );
  const home = await visitor.raw('GET', '/');
  check(
    home.status === 200 && /text\/html/.test(home.headers.get('content-type') ?? ''),
    'the home page opens',
  );
  check(!/Authorization|Basic /i.test(home.html), 'the page does not echo the gate credentials');
  const search = await visitor.raw('GET', '/search?q=TDS');
  const lab = /href="(\/labs\/[0-9a-f-]{36})"/.exec(search.html);
  check(
    search.status === 200 && lab !== null,
    'a search for TDS lists at least one lab',
    `${String(search.status)}`,
  );
  const priced =
    /(₹|&#8377;|INR|Rs\.?)\s*[\d,]+/.test(search.html) || /[\d,]+\s*(₹|INR)/.test(search.html);
  check(priced, 'the results show a price');
  if (lab !== null) {
    const page = await visitor.raw('GET', lab[1]);
    check(
      page.status === 200 && /(₹|&#8377;|INR|Rs\.?)\s*[\d,]+/.test(page.html),
      'the lab page opens and shows prices',
      `${lab[1]} ${String(page.status)}`,
    );
  }
  const suggest = await visitor.raw('GET', '/api/suggest?q=TDS');
  let count = -1;
  try {
    count = JSON.parse(suggest.html).suggestions.length;
  } catch {
    // reported below
  }
  check(
    suggest.status === 200 && count > 0,
    'the typeahead answers with suggestions',
    `${String(suggest.status)} ${String(count)}`,
  );
  const anonClaim = await visitor.raw('GET', '/lab/claim');
  check(
    /Sign in to continue/.test(textOf(anonClaim.html)),
    'a page that needs a session asks a visitor to sign in',
  );
}

step('4. sign in as the demo customer, session, refresh, sign out');
const customer = new Browser();
{
  const page = await customer.go('GET', '/sign-in');
  customer.referer = `${ORIGIN}/sign-in`;
  const afterEmail = await submit(customer, forms(page.html, page.url)[0], {
    set: { email: CUSTOMER },
    button: 'send',
  });
  const codeForm = formWith(afterEmail.html, afterEmail.url, 'Verify');
  check(
    codeForm !== undefined,
    'the sign-in asks for the code (Origin and Host agree behind the proxy: the server action ran)',
    textOf(afterEmail.html).slice(0, 200),
  );
  if (codeForm !== undefined) {
    const done = await submit(customer, codeForm, { set: { code: CODE }, button: 'verify' });
    check(
      done.status === 200 || done.status === 303,
      'the demo code is accepted',
      `${String(done.status)} ${textOf(done.html).slice(0, 200)}`,
    );
    check(
      customer.cookies.has('lc_access') && customer.cookies.has('lc_web_refresh'),
      'the session cookies are set',
    );
    for (const name of ['lc_access', 'lc_web_refresh']) {
      const line = customer.setCookieLines.find((l) => l.startsWith(`${name}=`)) ?? '';
      check(
        /;\s*secure/i.test(line) && /;\s*httponly/i.test(line),
        `${name} is Secure and HttpOnly`,
        line.replace(/=[^;]*/, '=<value>'),
      );
    }
    const claim = await customer.raw('GET', '/lab/claim');
    check(
      /Claim your lab on LabConnect/.test(textOf(claim.html)),
      'a page that needs the session opens when signed in',
    );

    // Force a refresh without waiting ten minutes: the access cookie is dropped, so the proxy
    // of the web app finds a refresh token and no access token and must rotate the session.
    const before = customer.cookies.get('lc_web_refresh')?.value;
    customer.cookies.delete('lc_access');
    customer.setCookieLines.length = 0;
    const refreshed = await customer.raw('GET', '/lab/claim');
    const after = customer.cookies.get('lc_web_refresh')?.value;
    check(
      /Claim your lab on LabConnect/.test(textOf(refreshed.html)) &&
        customer.cookies.has('lc_access'),
      "a forced refresh (access cookie dropped) keeps the session: the API accepted the web server's Origin",
      textOf(refreshed.html).slice(0, 160),
    );
    check(after !== undefined && after !== before, 'the refresh token was rotated');
    const again = await customer.raw('GET', '/lab/claim');
    check(
      /Claim your lab on LabConnect/.test(textOf(again.html)),
      'the new session works on the next request',
    );

    // Several pages at once right after the access token is gone, as a browser opening a page
    // with parallel requests does: the web server must refresh once and keep every one of them
    // signed in (it used to sign the user out). One refresh, many readers: not a stress test.
    customer.cookies.delete('lc_access');
    const parallel = await Promise.all(
      ['/lab/claim', '/lab/claim', '/', '/lab/claim', '/search?q=TDS'].map((path) =>
        customer.raw('GET', path),
      ),
    );
    const signedOutIn = parallel.filter((r) => /Sign in to continue/.test(textOf(r.html)));
    check(
      signedOutIn.length === 0 && customer.cookies.has('lc_web_refresh'),
      `five parallel requests after dropping the access cookie all stay signed in (${String(parallel.length - signedOutIn.length)} of ${String(parallel.length)})`,
    );
    const afterParallel = await customer.raw('GET', '/lab/claim');
    check(
      /Claim your lab on LabConnect/.test(textOf(afterParallel.html)),
      'the session still works after the parallel refresh',
    );

    const home = await customer.raw('GET', '/');
    const signOut = formWith(home.html, home.url, 'Sign out');
    check(signOut !== undefined, 'the header offers Sign out');
    if (signOut !== undefined) {
      await submit(customer, signOut, { button: 'Sign out' });
      const out = await customer.raw('GET', '/lab/claim');
      check(
        /Sign in to continue/.test(textOf(out.html)) && !customer.cookies.has('lc_access'),
        'after sign-out the session is gone',
      );
    }
  }
}

step('5. what must not be reachable from outside');
{
  // SKIP_PROBE_PORTS (comma separated): ports that something else on the machine you test from
  // legitimately uses (local verification on a developer machine only).
  const skip = (process.env.SKIP_PROBE_PORTS ?? '').split(',').map(Number);
  for (const [port, what] of [
    [3001, 'the API'],
    [3000, 'the web server'],
    [8025, 'the Mailpit inbox'],
    [1025, 'Mailpit SMTP'],
    [6379, 'Redis'],
    [5432, 'PostgreSQL'],
    [2019, "the proxy's admin API"],
  ].filter(([port]) => !skip.includes(port))) {
    check(
      !(await canConnect(port)),
      `${what} (port ${String(port)}) does not accept a connection from outside`,
    );
  }
  const probe = new Browser();
  const api = await probe.raw('GET', '/v1/health');
  check(
    api.status !== 200 || !/"status"/.test(api.html),
    'the API is not served through the proxy (/v1/health)',
    `${String(api.status)}`,
  );
  // Mailpit is served under /mailpit/ on purpose, behind the gate (or its own password): a visitor
  // without a login must not reach it.
  const anon = new Browser({ gate: false });
  const mail = await anon.raw('GET', '/mailpit/');
  check(
    mail.status === 401 && /^basic/i.test(mail.headers.get('www-authenticate') ?? ''),
    'the Mailpit inbox (/mailpit/) asks for a login',
    String(mail.status),
  );
  const mailApi = await anon.raw('GET', '/mailpit/api/v1/messages');
  check(
    mailApi.status === 401,
    'the Mailpit API (/mailpit/api/v1/messages) asks for a login',
    String(mailApi.status),
  );
}

console.log(`\nsafe checks: ${String(checks - failures)} of ${String(checks)} passed`);

// ---- rehearsal ------------------------------------------------------------------------------------
async function rehearsal() {
  step('6. REHEARSAL: the whole story (claim, Ops enrolment with a computed code, approval)');
  const walk =
    process.env.WALK_SCRIPT ??
    fileURLToPath(new URL('../../../apps/web/test/e2e-walk.mjs', import.meta.url));
  if (!existsSync(walk)) {
    check(
      false,
      'the walk script exists',
      `${walk} is not here. It is on the branch feature/web-enrol-claim-ops until that is merged; set WALK_SCRIPT.`,
    );
    return;
  }
  const preload = new URL('./gate-fetch.mjs', import.meta.url).href;
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', preload, walk], {
      stdio: 'inherit',
      env: {
        ...process.env,
        WEB_URL: ORIGIN,
        DEMO_OTP_CODE: CODE,
        GATE_AUTHORIZATION: EXPECT_GATE ? AUTH : '',
      },
    });
    child.on('exit', (c) => resolve(c ?? 1));
  });
  check(code === 0, 'the walk finished without a failed check');
}
if (REHEARSAL && failures === 0) await rehearsal();
else if (REHEARSAL) console.log('\nThe safe checks failed, so the rehearsal was not started.');

if (REHEARSAL) {
  console.log(`
################################################################################
# The demo data is now used up. Run  ./reset-demo.sh --yes-destroy-the-database
# BEFORE the real demonstration (Platform Ops is enrolled with a secret nobody holds).
################################################################################`);
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${String(failures)} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
