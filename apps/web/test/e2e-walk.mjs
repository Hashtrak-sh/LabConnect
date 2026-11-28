// End-to-end walk over plain HTTP against the real stack (see README.md). It drives the web app
// the way a browser without JavaScript does: a cookie jar, redirects followed by hand, and every
// server-action form posted from the hidden fields the server rendered. Run by hand, not part of
// the unit tests. Sequential on purpose, except the one deliberate double submit.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const WEB = process.env.WEB_URL ?? 'http://localhost:57300';
const DB_CONTAINER = process.env.DB_CONTAINER ?? 'lc-reads-postgres-1';
const CODE = process.env.DEMO_OTP_CODE ?? '444444';
const CUSTOMER = 'customer.admin.demo1@demo.labconnect.test';
const OPS = 'ops.demo@demo.labconnect.test';
const OTHER_CLAIMANT = 'lab.owner.demo1@demo.labconnect.test'; // no membership
// Optional: the fault proxy (fault-proxy.mjs) in front of the API, to show a 503 on the claim reads.
const FAULT_URL = process.env.FAULT_URL;
const CERT_A = 'DEMO-TC-0005-1'; // approved
const CERT_B = 'DEMO-TC-0006-1'; // stale If-Match, then left open
const CERT_C = 'DEMO-TC-0007-1'; // rejected
const CERT_D = 'DEMO-TC-0008-1'; // over the cap of 3 open claims, later rejected with hostile text
const CERT_E = 'DEMO-TC-0009-1'; // another claimant's own claim

let failures = 0;
let checks = 0;
function check(ok, label, detail = '') {
  checks++;
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} - ${label}${ok || detail === '' ? '' : `\n         ${detail}`}`,
  );
}
function step(title) {
  console.log(`\n== ${title}`);
}

// ---- cookie jar (stores every cookie, Secure or not; honours Path) -----------------------------
class Browser {
  constructor(name) {
    this.name = name;
    this.cookies = new Map(); // name -> { value, path }
    this.redirects = []; // every Location seen
    this.referer = null;
    this.log = []; // every response: { path, status, html }
    this.cookieLines = []; // every Set-Cookie line
  }
  header(pathname) {
    return [...this.cookies]
      .filter(([, c]) => pathname.startsWith(c.path))
      .map(([n, c]) => `${n}=${c.value}`)
      .join('; ');
  }
  store(response) {
    for (const line of response.headers.getSetCookie()) {
      this.cookieLines.push(line);
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
  /** One request, no automatic redirect. */
  async raw(method, path, { body, headers = {} } = {}) {
    const url = new URL(path, WEB);
    const response = await fetch(url, {
      method,
      body,
      redirect: 'manual',
      headers: {
        Cookie: this.header(url.pathname),
        ...(method === 'POST' ? { Origin: WEB } : {}),
        ...(this.referer === null ? {} : { Referer: this.referer }),
        ...headers,
      },
    });
    this.store(response);
    const html = response.status >= 300 && response.status < 400 ? '' : await response.text();
    const location = response.headers.get('location');
    if (location !== null) this.redirects.push(location);
    this.log.push({ path: url.pathname + url.search, status: response.status, html });
    return { status: response.status, headers: response.headers, html, location, url: url.href };
  }
  /** GET or POST, then follow redirects by hand (the referer of each hop is the page before). */
  async go(method, path, options = {}) {
    let result = await this.raw(method, path, options);
    let hops = 0;
    while (result.location !== null && hops++ < 8) {
      const next = new URL(result.location, result.url);
      if (next.origin !== new URL(WEB).origin) return result; // leaves the app (a download link)
      result = await this.raw('GET', next.pathname + next.search);
    }
    return result;
  }
}

// ---- HTML forms ---------------------------------------------------------------------------------
const decode = (text) =>
  text
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&#x2F;', '/')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
/** The page without its inline scripts: the framework's payload repeats every string passed to a client component, so a text check must not read it. */
const stripScripts = (html) => {
  // Repeated until nothing changes, in any letter case and with anything inside the closing tag:
  // one pass can leave a new "<script" behind where two pieces meet.
  let text = html;
  for (;;) {
    const next = text.replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, '');
    if (next === text) return text;
    text = next;
  }
};
const textOf = (html) =>
  decode(
    stripScripts(html)
      .replaceAll(/<[^>]*>/g, ' ')
      .replaceAll(/\s+/g, ' '),
  );

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
    const inner = m[2];
    const fields = [];
    for (const input of inner.matchAll(/<input\b([^>]*)>/g)) {
      const a = attrsOf(input[1]);
      if (a.name !== undefined && a.type !== 'submit' && a.type !== 'file')
        fields.push([a.name, a.value ?? '']);
    }
    for (const t of inner.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
      const a = attrsOf(t[1]);
      if (a.name !== undefined) fields.push([a.name, decode(t[2])]);
    }
    for (const s of inner.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
      const a = attrsOf(s[1]);
      const first = /<option\b[^>]*value="([^"]*)"/.exec(s[2]);
      if (a.name !== undefined && first) fields.push([a.name, decode(first[1])]);
    }
    const buttons = [...inner.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((b) => ({
      ...attrsOf(b[1]),
      text: textOf(b[2]),
    }));
    found.push({ action: attrs.action ?? '', fields, buttons, text: textOf(inner), pageUrl });
  }
  return found;
}

/** Posts a form as a browser without JavaScript would: all fields, the pressed button last. */
function submit(browser, form, { set = {}, button, headers } = {}) {
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
  return browser.go('POST', target.pathname + target.search, { body: data, headers });
}

const formWith = (html, url, needle) =>
  forms(html, url).find(
    (f) =>
      f.text.includes(needle) ||
      f.buttons.some((b) => b.text.includes(needle) || b.value === needle),
  );

// ---- TOTP (RFC 6238: HMAC-SHA1, 30 s, 6 digits) -------------------------------------------------
function base32(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of text.replaceAll(/[\s=]/g, '').toUpperCase())
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, stepOffset = 0, now = Date.now()) {
  const counter = Math.floor(now / 1000 / 30) + stepOffset;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const value =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(value % 1_000_000).padStart(6, '0');
}
// RFC 6238 appendix B, SHA-1, T = 59 s: 94287082 (8 digits) -> last six are 287082.
check(
  totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 0, 59_000) === '287082',
  "the walk's own TOTP matches the RFC 6238 test vector",
);

function psql(sql) {
  try {
    return execFileSync(
      'docker',
      ['exec', DB_CONTAINER, 'psql', '-U', 'labconnect', '-d', 'labconnect', '-At', '-c', sql],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return null;
  }
}

// ---- sign-in through the real forms -------------------------------------------------------------
async function signInUntilCode(browser, email, referer) {
  browser.referer = referer;
  const page = await browser.go('GET', '/sign-in');
  browser.referer = `${WEB}/sign-in`;
  const afterEmail = await submit(browser, forms(page.html, page.url)[0], {
    set: { email },
    button: 'send',
  });
  const codeForm = formWith(afterEmail.html, afterEmail.url, 'Verify');
  if (!codeForm)
    throw new Error(`no code step for ${email}: ${textOf(afterEmail.html).slice(0, 300)}`);
  return submit(browser, codeForm, { set: { code: CODE }, button: 'verify' });
}

async function enrol(browser, label) {
  const why = await browser.go('GET', '/sign-in/authenticator');
  check(
    why.status === 200 && textOf(why.html).includes('Your role needs a second step'),
    `${label}: the enrolment page opens from the sign-in step`,
  );
  check(
    /no-store/.test(why.headers.get('cache-control') ?? ''),
    `${label}: enrolment page is no-store`,
    why.headers.get('cache-control') ?? '',
  );
  await browser.go('GET', '/sign-in/authenticator');
  await browser.go('GET', '/sign-in/authenticator');
  check(!/otpauth|setup-key/.test(why.html), `${label}: opening the page shows no secret`);
  const userRows = psql(
    `select count(*) from mfa_factor f join app_user u on u.id=f.user_id where u.email='${label}'`,
  );
  check(
    userRows === null || userRows === '0',
    `${label}: three page loads made no factor`,
    `rows=${String(userRows)}`,
  );
  const scan = await submit(
    browser,
    forms(why.html, why.url).find((f) => f.buttons.some((b) => b.value === 'start')),
    { button: 'start' },
  );
  const key = /id="setup-key"[^>]*>([^<]+)</.exec(scan.html)?.[1]?.replaceAll(/\s/g, '');
  check(key !== undefined && /^[A-Z2-7]{16,}$/.test(key), `${label}: setup key shown as text`);
  check(
    /<svg[^>]*role="img"[\s\S]*?<path d="M/.test(scan.html),
    `${label}: QR code is an inline SVG`,
  );
  check(
    /no-store/.test(scan.headers.get('cache-control') ?? ''),
    `${label}: the response with the secret is no-store`,
    scan.headers.get('cache-control') ?? '(none)',
  );
  const confirmForm = formWith(scan.html, scan.url, 'Confirm');
  const wrong = await submit(browser, confirmForm, {
    set: { code: totp(key, 0) === '000000' ? '111111' : '000000' },
    button: 'confirm',
  });
  check(
    textOf(wrong.html).includes("That code didn't match"),
    `${label}: a wrong code says so (no count of tries)`,
  );
  check(!/tries left/i.test(wrong.html), `${label}: no "N tries left"`);
  const confirmAgain = formWith(wrong.html, wrong.url, 'Confirm');
  const codes = await submit(browser, confirmAgain, {
    set: { code: totp(key, 0) },
    button: 'confirm',
  });
  const recovery = [...codes.html.matchAll(/<li>([A-Za-z0-9]{5}-[A-Za-z0-9]{5})<\/li>/g)].map(
    (m) => m[1],
  );
  check(
    recovery.length === 10,
    `${label}: ten recovery codes shown once`,
    `found ${recovery.length}`,
  );
  check(
    /no-store/.test(codes.headers.get('cache-control') ?? ''),
    `${label}: the response with the recovery codes is no-store`,
    codes.headers.get('cache-control') ?? '(none)',
  );
  // A reload re-posts the confirm form: the codes must not come back.
  const reload = await submit(browser, confirmAgain, {
    set: { code: totp(key, 0) },
    button: 'confirm',
  });
  check(
    !/[A-Za-z0-9]{5}-[A-Za-z0-9]{5}<\/li>/.test(reload.html) &&
      textOf(reload.html).includes('Nothing to confirm'),
    `${label}: a reload does not show the codes again`,
  );
  const finishForm = formWith(codes.html, codes.url, 'saved my recovery');
  const notSaved = await submit(browser, finishForm, { button: 'finish' });
  check(
    notSaved.status === 200 || notSaved.status === 303,
    `${label}: finishing without the box ticked is handled`,
  );
  const done = await submit(browser, finishForm, { set: { saved: 'on' }, button: 'finish' });
  check(
    done.url.endsWith('/sign-in') && !browser.cookies.has('lc_mfa'),
    `${label}: "I saved them" leads to sign-in and drops the partial session`,
  );
  return key;
}

async function mfaStep(browser, email, key, referer) {
  const afterCode = await signInUntilCode(browser, email, referer);
  const mfaForm = formWith(afterCode.html, afterCode.url, 'Verify and continue');
  if (!mfaForm) throw new Error(`no authenticator step: ${textOf(afterCode.html).slice(0, 300)}`);
  // The code used to confirm the enrolment cannot be used again: take the next step's code (inside the +-1 window).
  const result = await submit(browser, mfaForm, { set: { code: totp(key, 1) }, button: 'mfa' });
  return result;
}

const noPersonalData = (browser, label) => {
  const bad = browser.redirects.filter((l) =>
    /@|demo\.labconnect|\.test\b|\?.*(email|name|phone)/i.test(l),
  );
  check(
    bad.length === 0,
    `${label}: no redirect carries an e-mail address or personal data`,
    bad.join(' | '),
  );
};

// ====================================================================================================
const customer = new Browser('customer');
const ops = new Browser('ops');
const visitor = new Browser('visitor');
const device2 = new Browser('customer, second device');
const other = new Browser('another claimant');

/** The page without its inline scripts (they carry build and render ids that differ per request). */
const pageText = (html) => textOf(stripScripts(html));
const maskedPattern = /\b\w\*\*\*@\*\*\*\.\w+/;
const claimantName = psql(`select full_name from app_user where email='${CUSTOMER}'`);
const customerLocal = CUSTOMER.split('@')[0];

/** The lab's name as a claim page shows it (the card under the heading). */
const labNameOf = (html) =>
  /<p class="break-words font-medium">([^<]*)<\/p>/.exec(html)?.[1] ?? null;
const reasonOf = (html) => /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/.exec(html)?.[1] ?? null;

step('A. signed-out visitor, return page, access denied');
{
  const page = await visitor.go('GET', '/admin/claims');
  check(
    page.status === 200 &&
      textOf(page.html).includes('Sign in to continue') &&
      !/Filter by status/.test(page.html),
    'a signed-out visitor to /admin/claims gets the sign-in panel and nothing of the page',
  );
  check(
    /no-store/.test(page.headers.get('cache-control') ?? ''),
    'the page is no-store',
    page.headers.get('cache-control') ?? '',
  );
  const signIn = page.html.match(/href="(\/sign-in)"/);
  check(signIn !== null, 'the panel links to /sign-in');
  const claimAnon = await visitor.go('GET', '/lab/claim');
  check(
    textOf(claimAnon.html).includes('Sign in to continue') && !/Find my lab/.test(claimAnon.html),
    'a signed-out visitor to /lab/claim gets the sign-in panel and nothing of the page',
  );
  const back = await signInUntilCode(customer, CUSTOMER, `${WEB}/admin/claims`);
  const cookieLine = customer.cookieLines.find((l) => l.startsWith('lc_access='));
  console.log(
    `   (lc_access as set over ${new URL(WEB).protocol}: ${cookieLine === undefined ? '?' : /;\s*secure/i.test(cookieLine) ? 'Secure' : 'not Secure'}, ${/httponly/i.test(cookieLine ?? '') ? 'HttpOnly' : 'not HttpOnly'})`,
  );
  check(
    back.url.endsWith('/admin/claims'),
    'after sign-in the visitor returns to /admin/claims',
    back.url,
  );
  check(
    textOf(back.html).includes("You don't have access to this page") &&
      textOf(back.html).includes('Platform Ops'),
    'a customer opening the Ops list gets access denied, naming the role needed',
  );
  check(!/claim-requests|Review<\/a>/.test(back.html), 'access denied shows nothing of the list');
  check(
    textOf(back.html).includes('Claim your lab'),
    'the header offers "Claim your lab" to the customer',
  );
  noPersonalData(customer, 'customer sign-in');
}

step('B. customer claims labs by certificate number; the old cookie');
let idA;
let idB;
let idC;
let idD;
let pathA;
let labNameA;
let formB1;
let formB2;
{
  // A browser that used the earlier build still holds its claims cookie: the server deletes it.
  customer.cookies.set('lc_claims', {
    value: '%7B%22u%22%3A%22x%22%2C%22c%22%3A%5B%5D%7D',
    path: '/lab',
  });
  const swept = await customer.go('GET', '/lab/claim');
  check(
    customer.redirects.some((l) => l.startsWith('/lab/claim/forget-old-copy')) &&
      swept.url.endsWith('/lab/claim') &&
      !customer.cookies.has('lc_claims'),
    'an old lc_claims cookie is deleted by the server, and the page opens',
    `${swept.url} cookies=${[...customer.cookies.keys()].join(',')}`,
  );
  check(
    customer.cookieLines.some(
      (l) => /^lc_claims=;/.test(l) && /path=\/lab/i.test(l) && /max-age=0/i.test(l),
    ),
    "the deletion carries the cookie's path and an immediate expiry",
    customer.cookieLines.filter((l) => l.startsWith('lc_claims')).join(' | '),
  );
  const hostile = await customer.raw('GET', '/lab/claim/forget-old-copy?to=https://evil.example/');
  check(
    hostile.status === 303 && hostile.location === '/lab/claim',
    'the cookie sweep only ever goes back to a claim page (no open redirect)',
    `${hostile.status} ${String(hostile.location)}`,
  );

  const page = await customer.go('GET', '/lab/claim');
  check(
    textOf(page.html).includes('Claim your lab on LabConnect') &&
      /<h1/.test(page.html) &&
      /<main/.test(page.html),
    'the claim page opens (one h1, a main landmark)',
  );
  check(/no-store/.test(page.headers.get('cache-control') ?? ''), 'the claim page is no-store');
  check(
    textOf(page.html).includes("You haven't started a claim yet"),
    'a claimant with no claim sees "you haven\'t started a claim" (the read answered an empty list)',
  );
  const startForm = formWith(page.html, page.url, 'Find my lab');
  const notFound = await submit(customer, startForm, {
    set: { certificateNo: 'NO-SUCH-CERT-0000' },
    button: 'Find my lab',
  });
  check(
    textOf(notFound.html).includes("couldn't find a lab with this certificate"),
    'unknown certificate: "lab not found" state',
  );
  const again = formWith(notFound.html, notFound.url, 'Find my lab');
  const started = await submit(customer, again, {
    set: { certificateNo: CERT_A },
    button: 'Find my lab',
  });
  pathA = new URL(started.url).pathname;
  idA = pathA.split('/').pop();
  check(
    /^\/lab\/claim\/[0-9a-f-]{36}$/.test(pathA),
    "starting a claim leaves the form for the claim's own page (reload-safe)",
    `${started.url} ${textOf(started.html).slice(0, 600)}`,
  );
  labNameA = labNameOf(started.html);
  const text = textOf(started.html);
  check(
    labNameA !== null && labNameA !== '' && text.includes('Waiting for code'),
    'the claim page names the lab and the state "waiting for code", read from the API',
    String(labNameA),
  );
  check(
    /We sent a 6-digit code to the email NABL has on record for this lab: \S+\*\*\*@\*\*\*\.\S+/.test(
      text,
    ),
    'the code step shows the address exactly as the API masked it',
    text.slice(text.indexOf('We sent'), text.indexOf('We sent') + 120),
  );
  check(
    !text.includes('demo.labconnect.test') && !started.html.includes(CODE),
    'neither the full address nor the demo code appears on the page',
  );
  noPersonalData(customer, 'claim start');

  const codeForm = formWith(started.html, started.url, 'Verify and claim');
  const wrong = await submit(customer, codeForm, { set: { code: '111111' }, button: 'verify' });
  check(textOf(wrong.html).includes("That code didn't match"), 'wrong claim code: its state shows');
  check(!/tries left/i.test(wrong.html), 'no count of tries left');

  // A stale If-Match: the page is read again from the API and says the claim changed.
  const stale = await submit(customer, formWith(wrong.html, wrong.url, 'Verify and claim'), {
    set: { code: CODE, etag: '"999"' },
    button: 'verify',
  });
  check(
    stale.url.includes('?n=changed') &&
      textOf(stale.html).includes('This claim changed') &&
      textOf(stale.html).includes('Waiting for code'),
    'a stale If-Match reloads the claim from the API and says "this claim changed"',
    `${stale.url} ${textOf(stale.html).slice(0, 160)}`,
  );
  check(
    !/<button[^>]*value="reload"/.test(stale.html),
    'there is no "restart the claim" button any more',
  );

  // A new code needs the certificate number again (the claim does not record it, OQ-266).
  const resendForm = formWith(stale.html, stale.url, 'Need a new code');
  const noCert = await submit(customer, resendForm, { button: 'resend' });
  check(
    textOf(noCert.html).includes('Enter the certificate number'),
    'a new code without the certificate number is refused on the field',
  );
  const wrongCert = await submit(customer, formWith(noCert.html, noCert.url, 'Need a new code'), {
    set: { certificateNo: 'NO-SUCH-CERT-0000' },
    button: 'resend',
  });
  check(
    textOf(wrongCert.html).includes("couldn't find a lab with this certificate"),
    'a new code for an unknown certificate says no lab was found',
  );
  const resent = await submit(
    customer,
    formWith(wrongCert.html, wrongCert.url, 'Need a new code'),
    {
      set: { certificateNo: CERT_A },
      button: 'resend',
    },
  );
  check(
    textOf(resent.html).includes('We sent a new code') && new URL(resent.url).pathname === pathA,
    'a new code for the same certificate stays on the same claim',
    textOf(resent.html).slice(0, 200),
  );

  step('B2. the cap of 3 open claims; two tabs; the other states');
  const { html, url } = await customer.go('GET', '/lab/claim');
  const f1 = await submit(customer, formWith(html, url, 'Find my lab'), {
    set: { certificateNo: CERT_B },
    button: 'Find my lab',
  });
  idB = new URL(f1.url).pathname.split('/').pop();
  // Two tabs: both read the claim, both enter the code.
  const tab1 = await customer.go('GET', `/lab/claim/${idB}`);
  const tab2 = await customer.go('GET', `/lab/claim/${idB}`);
  formB1 = formWith(tab1.html, tab1.url, 'Verify and claim');
  formB2 = formWith(tab2.html, tab2.url, 'Verify and claim');
  const first = await submit(customer, formB1, { set: { code: CODE }, button: 'verify' });
  check(
    textOf(first.html).includes('In review'),
    'two tabs: the first code moves the claim to "In review"',
  );
  const second = await submit(customer, formB2, { set: { code: CODE }, button: 'verify' });
  check(
    second.url.includes('?n=moved') &&
      textOf(second.html).includes('This claim moved on') &&
      textOf(second.html).includes('now: In review') &&
      !/Verify and claim/.test(second.html),
    'two tabs: the second code finds the claim in review and says so (no code form, no second claim)',
    `${second.url} ${textOf(second.html).slice(0, 220)}`,
  );
  const p2 = await customer.go('GET', '/lab/claim');
  const f2 = await submit(customer, formWith(p2.html, p2.url, 'Find my lab'), {
    set: { certificateNo: CERT_C },
    button: 'Find my lab',
  });
  idC = new URL(f2.url).pathname.split('/').pop();
  const cPage = await customer.go('GET', `/lab/claim/${idC}`);
  await submit(customer, formWith(cPage.html, cPage.url, 'Verify and claim'), {
    set: { code: CODE },
    button: 'verify',
  });
  // A is still waiting for its code: three open claims now.
  const p3 = await customer.go('GET', '/lab/claim');
  const cap = await submit(customer, formWith(p3.html, p3.url, 'Find my lab'), {
    set: { certificateNo: CERT_D },
    button: 'Find my lab',
  });
  check(
    textOf(cap.html).includes('Limit reached'),
    'the fourth open claim is refused: "limit reached"',
  );

  // Verify the code of the first claim, from the page the new code was sent on: its form carries the
  // version the API gave with that answer (a new code changes the claim), so the code is accepted.
  const ok = await submit(customer, formWith(resent.html, resent.url, 'Verify and claim'), {
    set: { code: CODE },
    button: 'verify',
  });
  check(textOf(ok.html).includes('In review'), 'the right code moves the claim to "In review"');
  const secondStart = await customer.go('GET', '/lab/claim');
  const own = await submit(customer, formWith(secondStart.html, secondStart.url, 'Find my lab'), {
    set: { certificateNo: CERT_A },
    button: 'Find my lab',
  });
  check(
    textOf(own.html).includes('already in review') && own.html.includes(pathA),
    'claiming the same lab again: "already in review", and the claim is in the list',
  );
  const list = await customer.go('GET', '/lab/claim');
  const listText = textOf(list.html);
  check(
    [idA, idB, idC].every((id) => list.html.includes(`/lab/claim/${id}`)) &&
      (listText.match(/In review/g) ?? []).length >= 3,
    "the claimant's list (from listMyLabClaims) shows the three claims, all in review",
  );
}

step('C. Ops: enrolment, sign-in with the authenticator, claims list');
let opsKey;
{
  const afterCode = await signInUntilCode(ops, OPS, `${WEB}/sign-in`);
  check(
    afterCode.html.includes('href="/sign-in/authenticator"'),
    'the sign-in "enrol" step links to the enrolment page',
  );
  check(ops.cookies.has('lc_mfa'), 'the partial session is in lc_mfa');
  opsKey = await enrol(ops, OPS);
  const result = await mfaStep(ops, OPS, opsKey, `${WEB}/sign-in`);
  check(
    ops.cookies.has('lc_access'),
    'the authenticator step gives a full session',
    textOf(result.html).slice(0, 200),
  );
  noPersonalData(ops, 'ops sign-in');

  const list = await ops.go('GET', '/admin/claims');
  const t = textOf(list.html);
  check(
    t.includes('Claim requests') && t.includes(CERT_A) && t.includes('In review'),
    'Ops see the claims list with the claim in review',
  );
  check(
    labNameA !== null && t.includes(labNameA),
    "the Ops list shows the lab's name, not a reference",
    String(labNameA),
  );
  check(
    claimantName === null || t.includes(claimantName),
    "the Ops list shows the claimant's name",
    String(claimantName),
  );
  check(
    maskedPattern.test(t),
    "the Ops list shows the claimant's address masked, as the API gives it",
  );
  check(
    !t.includes(customerLocal) && !list.html.includes(CUSTOMER),
    "the claimant's full address is not in the Ops list",
  );
  check(
    /Also in: Customer/.test(t),
    'the Ops list shows the other organisations of the claimant by type',
  );
  check(/\b[A-Z]{2}\b/.test(t), "the Ops list shows the lab's state code");
  check(!/Reference|requestedByUserId/.test(list.html), 'no reference code stands in for a name');
  check(/IST/.test(t), 'times are shown with IST');
  check(/no-store/.test(list.headers.get('cache-control') ?? ''), 'the Ops list is no-store');
  check(!textOf(list.html).includes('Claim your lab'), 'the header offers Ops no "Claim your lab"');
  const claimLinks = [...list.html.matchAll(/<li><div[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);
  const pick = (cert) =>
    /href="(\/admin\/claims\/[0-9a-f-]{36})"/.exec(
      claimLinks.find((li) => li.includes(cert)) ?? '',
    )?.[1];
  check(
    pick(CERT_A)?.endsWith(idA) === true,
    "the claim in the list is the customer's claim",
    `${String(pick(CERT_A))} vs ${idA}`,
  );

  const filtered = await ops.go('GET', '/admin/claims?status=APPROVED');
  check(
    textOf(filtered.html).includes('No claims to review'),
    'filter by status: APPROVED is empty before the approval',
  );
  const own = await ops.go('GET', '/lab/claim');
  check(
    textOf(own.html).includes("Platform staff can't claim a lab") && !/Find my lab/.test(own.html),
    'an Ops user who opens the claim page is told staff cannot claim',
  );
  const staffRead = await ops.go('GET', pathA);
  check(
    textOf(staffRead.html).includes("Platform staff can't claim a lab") &&
      !(labNameA !== null && textOf(staffRead.html).includes(labNameA)),
    "platform staff opening a claimant's claim page get the staff message and no claim (the claimant read is not called)",
  );

  const detail = await ops.go('GET', `/admin/claims/${idA}`);
  const dt = textOf(detail.html);
  check(
    dt.includes('Email code verified') &&
      dt.includes(CERT_A) &&
      (labNameA === null || dt.includes(labNameA)) &&
      (claimantName === null || dt.includes(claimantName)) &&
      maskedPattern.test(dt) &&
      /IST/.test(dt),
    'the claim detail shows lab, claimant name and masked address, method and time in IST',
    dt.slice(0, 300),
  );
  check(
    /Also belongs to\s*Customer/.test(dt) && !/Approval will be refused/.test(dt),
    'a claimant who only belongs to a customer organisation has no "approval will be refused" note',
  );
  check(
    !/Reference|Claimant \(reference\)/.test(dt),
    'the detail has no reference where the name is',
  );
  check(
    !detail.html.includes(CUSTOMER) && !dt.includes(customerLocal),
    "the claimant's full address is not in the Ops detail",
  );
  check(
    !/downloadUrl|X-Amz|\/labconnect-files\//.test(detail.html),
    'no download link is in the page',
  );
  const confirmPage = await ops.go('GET', `/admin/claims/${idA}?decide=approve`);
  check(
    textOf(confirmPage.html).includes(
      "The claimant becomes this lab's first Checker and the lab becomes claimed",
    ),
    'the approve confirm step states what approval does',
  );
  const unknownOps = await ops.go('GET', '/admin/claims/00000000-0000-7000-8000-000000000000');
  check(
    textOf(unknownOps.html).includes("We can't find this claim"),
    'Ops: an unknown claim id is "we can\'t find this claim"',
  );
  const malformed = await ops.go('GET', '/admin/claims/not-an-id');
  check(
    textOf(malformed.html).includes("We can't find this claim"),
    'Ops: a malformed id is "we can\'t find this claim" and asks the API nothing',
  );

  // Stale If-Match on a rejection (claim B stays in review).
  const rejectPage = await ops.go('GET', `/admin/claims/${idB}?decide=reject`);
  const stale = await submit(ops, formWith(rejectPage.html, rejectPage.url, 'Reject claim'), {
    set: { etag: '"99"', notes: 'x' },
    button: 'Reject claim',
  });
  check(
    textOf(stale.html).includes('This claim changed'),
    'Ops: a stale If-Match shows "this claim changed"',
  );
  const noNotes = await submit(ops, formWith(rejectPage.html, rejectPage.url, 'Reject claim'), {
    set: { notes: '   ' },
    button: 'Reject claim',
  });
  check(
    textOf(noNotes.html).includes('Write the notes the lab will see'),
    'Ops: a rejection without notes is refused on the field',
  );

  // A script on another site: the origin check refuses the post, nothing happens.
  const cross = await submit(ops, formWith(rejectPage.html, rejectPage.url, 'Reject claim'), {
    set: { notes: 'Posted from another site' },
    button: 'Reject claim',
    headers: { Origin: 'http://evil.example' },
  });
  const afterCross = await ops.go('GET', `/admin/claims/${idB}`);
  check(
    cross.status !== 303 &&
      textOf(afterCross.html).includes('In review') &&
      !textOf(afterCross.html).includes('Posted from another site'),
    `a post from another origin is refused and changes nothing (status ${cross.status})`,
  );

  // Reject one with a reason: the claimant reads it.
  const rejectC = await ops.go('GET', `/admin/claims/${idC}?decide=reject`);
  const rejected = await submit(ops, formWith(rejectC.html, rejectC.url, 'Reject claim'), {
    set: { reason: 'signature', notes: 'Please upload a letter signed by the lab director.' },
    button: 'Reject claim',
  });
  const reasonC =
    'Letter not signed by an authorised signatory: Please upload a letter signed by the lab director.';
  check(
    rejected.url.includes('decided=rejected') && textOf(rejected.html).includes(reasonC),
    'Ops: rejecting with a reason writes the reason at the start of the notes',
  );
  check(
    rejected.url.includes('?decided=rejected') && !/@/.test(rejected.url),
    'the redirect after a decision carries no personal data',
  );
  const forgedBanner = await ops.go('GET', `/admin/claims/${idB}?decided=approved`);
  check(
    !textOf(forgedBanner.html).includes('Claim approved'),
    'a "decided" banner typed into the address is not shown for a claim that was not decided that way',
  );

  step('C2. the claimant reads the rejection');
  const cRead = await customer.go('GET', `/lab/claim/${idC}`);
  check(
    textOf(cRead.html).includes('Rejected') &&
      textOf(cRead.html).includes('The reason LabConnect gave') &&
      textOf(cRead.html).includes(reasonC) &&
      textOf(cRead.html).includes('Start a new claim'),
    'the claimant sees "Rejected" with the reason Ops wrote, and the way to start again',
    textOf(cRead.html).slice(0, 300),
  );
  check(
    !/<form/.test(cRead.html.replace(/<nav[\s\S]*?<\/nav>/g, '')) ||
      !/Verify and claim/.test(cRead.html),
    'a rejected claim has no code form',
  );
  check(
    textOf((await customer.go('GET', '/lab/claim')).html).includes('Rejected'),
    "the claimant's list shows the claim as Rejected",
  );

  step('C3. a second device (a fresh cookie jar) sees the same claims');
  const afterDevice = await signInUntilCode(device2, CUSTOMER, `${WEB}/lab/claim`);
  const d2 = await device2.go('GET', '/lab/claim');
  const d2Text = textOf(d2.html);
  check(
    [idA, idB, idC].every((id) => d2.html.includes(`/lab/claim/${id}`)) &&
      (d2Text.match(/In review/g) ?? []).length >= 2 &&
      d2Text.includes('Rejected'),
    'a second device lists the same claims with the same states',
    `${afterDevice.url} ${d2Text.slice(0, 200)}`,
  );
  const d2Claim = await device2.go('GET', `/lab/claim/${idC}`);
  check(
    textOf(d2Claim.html).includes(reasonC),
    'the second device reads the same rejection reason',
  );

  step("C4. a claimant who has no membership; another user's claim id");
  const otherCode = await signInUntilCode(other, OTHER_CLAIMANT, `${WEB}/lab/claim`);
  const o1 = await other.go('GET', '/lab/claim');
  check(
    textOf(o1.html).includes("You haven't started a claim yet") &&
      !o1.html.includes(`/lab/claim/${idA}`),
    "a claimant with no membership sees their own (empty) list, never another user's claims",
    otherCode.url,
  );
  for (const id of [idA, idB, idC]) {
    const foreign = await other.go('GET', `/lab/claim/${id}`);
    check(
      textOf(foreign.html).includes("We can't find this claim") &&
        !(labNameA !== null && textOf(foreign.html).includes(labNameA)),
      'another user\'s claim id typed into the address is "we can\'t find this claim"',
    );
  }
  const unknownClaim = await other.go('GET', '/lab/claim/00000000-0000-7000-8000-000000000000');
  const foreign404 = await other.go('GET', `/lab/claim/${idA}`);
  check(
    stripScripts(unknownClaim.html) === stripScripts(foreign404.html),
    "an id that never existed and another user's id give the same page, word for word",
    `${textOf(stripScripts(unknownClaim.html)).slice(-300)} <> ${textOf(stripScripts(foreign404.html)).slice(-300)}`,
  );
  const notUuid = await other.go('GET', '/lab/claim/not-an-id');
  check(
    textOf(notUuid.html).includes("We can't find this claim"),
    'a malformed claim id is "we can\'t find this claim"',
  );
  // A form of the other claimant's own claim, with the claim id changed to the customer's claim:
  // the API answers 404 (not theirs) and the page is "we can't find this claim".
  const startE = await other.go('GET', '/lab/claim');
  const startedE = await submit(other, formWith(startE.html, startE.url, 'Find my lab'), {
    set: { certificateNo: CERT_E },
    button: 'Find my lab',
  });
  const eCodeForm = formWith(startedE.html, startedE.url, 'Verify and claim');
  const forged = await submit(other, eCodeForm, {
    set: { claimId: idB, code: CODE },
    button: 'verify',
  });
  check(
    textOf(forged.html).includes("We can't find this claim") &&
      !(labNameA !== null && textOf(forged.html).includes(labNameA)),
    "a code posted for another user's claim (forged claim id in the form) shows nothing of that claim",
    `${forged.url} ${textOf(forged.html).slice(0, 160)}`,
  );
  const afterForged = await customer.go('GET', `/lab/claim/${idB}`);
  check(textOf(afterForged.html).includes('In review'), '...and that claim is unchanged');

  step('C5. Ops: a decision made while another Ops user still has the form open');
  const startD = await customer.go('GET', '/lab/claim');
  const fd = await submit(customer, formWith(startD.html, startD.url, 'Find my lab'), {
    set: { certificateNo: CERT_D },
    button: 'Find my lab',
  });
  idD = new URL(fd.url).pathname.split('/').pop();
  const dPage = await customer.go('GET', `/lab/claim/${idD}`);
  await submit(customer, formWith(dPage.html, dPage.url, 'Verify and claim'), {
    set: { code: CODE },
    button: 'verify',
  });
  // "Ops A" opens the approve form; "Ops B" rejects the claim; "Ops A" presses approve.
  const opsAForm = formWith(
    (await ops.go('GET', `/admin/claims/${idD}?decide=approve`)).html,
    `${WEB}/admin/claims/${idD}?decide=approve`,
    'Approve claim',
  );
  const longTail = 'x'.repeat(
    2000 -
      '<b>bold</b> & <img src=x onerror=alert(1)>\nSee https://example.test/a?b=1&c=2\n'.length,
  );
  const hostileNotes = `<b>bold</b> & <img src=x onerror=alert(1)>\nSee https://example.test/a?b=1&c=2\n${longTail}`;
  const rejectD = await ops.go('GET', `/admin/claims/${idD}?decide=reject`);
  const rejectedD = await submit(ops, formWith(rejectD.html, rejectD.url, 'Reject claim'), {
    set: { reason: 'other', notes: hostileNotes },
    button: 'Reject claim',
  });
  check(
    rejectedD.url.includes('decided=rejected'),
    'Ops B rejects the claim with 2,000 characters of HTML-like text',
    `${rejectedD.url} ${textOf(rejectedD.html).slice(0, 500)}`,
  );
  const lateApprove = await submit(ops, opsAForm, { button: 'Approve claim' });
  check(
    /isn't waiting for a decision/.test(textOf(lateApprove.html)) &&
      /Rejected/.test(textOf(lateApprove.html)) &&
      !lateApprove.url.includes('decided=approved'),
    'Ops A presses approve after Ops B rejected: "already decided", nothing approved',
    textOf(lateApprove.html).slice(0, 220),
  );
  const dOps = await ops.go('GET', `/admin/claims/${idD}`);
  check(
    dOps.html.includes('&lt;b&gt;bold&lt;/b&gt;') && !dOps.html.includes('<img src=x'),
    'Ops see the notes as text: the HTML in them is escaped',
  );
  const dRead = await customer.go('GET', `/lab/claim/${idD}`);
  const reasonHtml = reasonOf(dRead.html) ?? '';
  check(
    reasonHtml.includes('&lt;b&gt;bold&lt;/b&gt;') &&
      reasonHtml.includes('&lt;img src=x onerror=alert(1)&gt;') &&
      !dRead.html.includes('<img src=x') &&
      !dRead.html.includes('<b>bold</b>'),
    'the claimant sees a reason with HTML in it as plain text, never as markup',
  );
  check(
    decode(reasonHtml).length >= 1990 && decode(reasonHtml).endsWith('x'.repeat(100)),
    'a 2,000-character reason is shown whole',
    `${decode(reasonHtml).length} characters`,
  );
  check(
    /\n/.test(decode(reasonHtml)) &&
      /whitespace-pre-wrap/.test(dRead.html) &&
      /break-words/.test(dRead.html),
    'the line breaks of the reason are kept and a long line wraps',
  );
  check(
    decode(reasonHtml).includes('https://example.test/a?b=1&c=2') &&
      !/<a [^>]*example\.test/.test(dRead.html),
    'a link in the reason stays text (not a link)',
  );

  step('C6. Ops approve (double click), then the claimant who now holds a lab role');
  const approvePage = await ops.go('GET', `/admin/claims/${idA}?decide=approve`);
  const approveForm = formWith(approvePage.html, approvePage.url, 'Approve claim');
  const [r1, r2] = await Promise.all([
    submit(ops, approveForm, { button: 'Approve claim' }),
    submit(ops, approveForm, { button: 'Approve claim' }),
  ]);
  const approvedCount = [r1, r2].filter((r) => r.url.includes('decided=approved')).length;
  const otherPost = [r1, r2].find((r) => !r.url.includes('decided=approved'));
  check(
    approvedCount === 1,
    'a double click on approve: exactly one approval',
    `${r1.url} / ${r2.url}`,
  );
  check(
    otherPost === undefined || /isn't waiting for a decision/.test(textOf(otherPost.html)),
    'the other post lands on the claim, which is no longer waiting for a decision',
    otherPost === undefined ? '' : textOf(otherPost.html).slice(0, 200),
  );
  const back = await ops.go('GET', `/admin/claims/${idA}?decide=approve`);
  check(
    textOf(back.html).includes("isn't waiting for a decision") &&
      !back.html.includes('Approve claim'),
    'the back button after approval: no approve form any more',
  );
  const approvedList = await ops.go('GET', '/admin/claims?status=APPROVED');
  check(
    textOf(approvedList.html).includes(CERT_A),
    'the approved claim is under the APPROVED filter',
  );
  const letter = await ops.go('GET', `/admin/claims/${idA}`);
  check(!letter.html.includes('Review letter'), 'a code claim has no letterhead button');

  // The claimant now belongs to a lab: another claim of theirs cannot be approved, and Ops are told first.
  const bDetail = await ops.go('GET', `/admin/claims/${idB}`);
  const bText = textOf(bDetail.html);
  check(
    /Approval will be refused/.test(bText) &&
      /already belongs to a lab/.test(bText) &&
      /Also belongs to\s*Customer, Lab/.test(bText),
    'a claimant who now belongs to a lab: the detail says before the confirm step that approval will be refused, and why',
    bText.slice(0, 400),
  );
  const bConfirm = await ops.go('GET', `/admin/claims/${idB}?decide=approve`);
  check(
    /Approval will be refused/.test(textOf(bConfirm.html)),
    'the same warning is on the confirm step',
  );
  const bApprove = await submit(ops, formWith(bConfirm.html, bConfirm.url, 'Approve claim'), {
    button: 'Approve claim',
  });
  check(
    /This claim can't be approved/.test(textOf(bApprove.html)) &&
      !bApprove.url.includes('decided=approved'),
    'pressing approve anyway is refused by the API and the screen says why',
    textOf(bApprove.html).slice(0, 200),
  );
}

step('D. the claimant after approval');
{
  const stale = await customer.go('GET', pathA);
  const staleText = textOf(stale.html);
  check(
    staleText.includes('Approved') &&
      staleText.includes('LabConnect approved your claim') &&
      /Sign in again/.test(staleText) &&
      /authenticator/.test(staleText),
    'the claimant (old session) reads the claim as Approved, with what happens next',
    staleText.slice(0, 300),
  );
  check(
    !/Verify and claim|Send a new code/.test(stale.html),
    'an approved claim offers no code form',
  );
  const staleList = await customer.go('GET', '/lab/claim');
  console.log(
    `   (the old session, before signing in again: ${textOf(staleList.html).includes('Your labs') ? 'shows "Your labs"' : textOf(staleList.html).includes('Sign in to continue') ? 'asks to sign in' : 'shows the claim page without the lab'})`,
  );
  customer.cookies.delete('lc_access');
  customer.cookies.delete('lc_web_refresh');
  const afterCode = await signInUntilCode(customer, CUSTOMER, `${WEB}/lab/claim`);
  check(
    afterCode.html.includes('href="/sign-in/authenticator"'),
    'the new Checker is sent to enrolment at the next sign-in',
  );
  const key = await enrol(customer, CUSTOMER);
  const result = await mfaStep(customer, CUSTOMER, key, `${WEB}/lab/claim`);
  check(
    result.url.endsWith('/lab/claim'),
    'after the authenticator step the claimant returns to the page asked for',
    result.url,
  );
  const page = await customer.go('GET', '/lab/claim');
  const t = textOf(page.html);
  check(
    t.includes('Your labs') &&
      t.includes('Lab Checker') &&
      t.includes((labNameA ?? '?').split(',')[0]),
    'the claim page now shows the approved lab and the Checker role',
  );
  check(
    page.html.includes(`/lab/claim/${idA}`) && /Approved/.test(t) && /Rejected/.test(t),
    'and "Your claims" lists the approved claim, the rejected ones and the one in review',
  );
  const asChecker = await customer.go('GET', pathA);
  check(
    textOf(asChecker.html).includes('Approved') && textOf(asChecker.html).includes(labNameA ?? '?'),
    "the claimant, now the lab's Checker, still reads the old claim as Approved",
  );
  const denied = await customer.go('GET', '/admin/claims');
  check(
    textOf(denied.html).includes("You don't have access to this page") &&
      !denied.html.includes('Filter by status'),
    'a Checker of a lab (active membership: the customer organisation) opening the Ops pages gets access denied',
    textOf(denied.html).slice(0, 250),
  );
  console.log(
    `   (the denied page names: ${/Your role is ([^.]*)\./.exec(textOf(denied.html))?.[1] ?? '?'}; the new Checker role is under "Your labs", the active membership is still the customer one)`,
  );
  const again = await submit(customer, formWith(page.html, page.url, 'Find my lab'), {
    set: { certificateNo: CERT_A },
    button: 'Find my lab',
  });
  check(
    textOf(again.html).includes('already claimed'),
    'claiming the claimed lab again: "already claimed"',
  );
  noPersonalData(customer, 'customer after approval');
}

step('E. a list longer than one page');
{
  const seeded = psql(
    `insert into lab_claim_request (id, organisation_id, lab_site_id, requested_by_user_id, method, status, reviewed_at, decision_notes, created_at, updated_at, created_by_user_id) select gen_random_uuid(), organisation_id, lab_site_id, requested_by_user_id, method, 'REJECTED', now(), 'seeded for the paging check', now() - (n || ' minutes')::interval, now(), created_by_user_id from lab_claim_request, generate_series(1, 30) n where id = '${idA}' returning 1`,
  );
  if (seeded === null) {
    console.log('   (skipped: no docker, so no way to seed 30 extra claims)');
  } else {
    const first = await customer.go('GET', '/lab/claim');
    const firstIds = [...first.html.matchAll(/href="\/lab\/claim\/([0-9a-f-]{36})"/g)].map(
      (m) => m[1],
    );
    const older = /href="(\/lab\/claim\?cursor=[^"]+)"/.exec(first.html)?.[1];
    check(
      firstIds.length === 25 && older !== undefined,
      'a list of more than 25 claims shows 25 and an "Older claims" link (the API\'s cursor)',
      `${firstIds.length} claims, link ${String(older)}`,
    );
    const nextPage = await customer.go('GET', decode(older ?? '/lab/claim'));
    const nextIds = [...nextPage.html.matchAll(/href="\/lab\/claim\/([0-9a-f-]{36})"/g)].map(
      (m) => m[1],
    );
    check(
      nextIds.length > 0 &&
        nextIds.every((id) => !firstIds.includes(id)) &&
        /Newest claims/.test(textOf(nextPage.html)),
      'the next page has the rest, nothing repeated, and a way back',
      `${nextIds.length} claims`,
    );
    check(
      !/@|name=|email/i.test(String(older)),
      'the cursor in the address carries no personal data',
      String(older),
    );
    const tampered = await customer.go('GET', '/lab/claim?cursor=not-a-cursor');
    check(
      pageText(tampered.html).includes("That page of your claims isn't available") &&
        !pageText(tampered.html).includes("You haven't started a claim yet"),
      'a cursor that cannot be read says so (not "no claims")',
      pageText(tampered.html).slice(-500),
    );
  }
}

step('F. no claims cookie of this build; no full address anywhere');
{
  const setNow = [customer, ops, device2, other, visitor].flatMap((b) =>
    b.cookieLines.filter((l) => l.startsWith('lc_claims=') && !/^lc_claims=;/.test(l)),
  );
  check(
    setNow.length === 0,
    'no response of the whole walk set an lc_claims cookie',
    setNow.join(' | '),
  );
  const leaks = [];
  for (const b of [ops, customer, device2, other]) {
    for (const entry of b.log) {
      const onClaimPages = entry.path.startsWith('/admin') || entry.path.startsWith('/lab');
      if (!onClaimPages) continue;
      if (entry.html.includes(CUSTOMER) || entry.html.includes(encodeURIComponent(CUSTOMER)))
        leaks.push(`${b.name} ${entry.path}`);
    }
  }
  check(
    leaks.length === 0,
    "the claimant's full address is in no page of the Ops screens or of the claim screens",
    leaks.slice(0, 5).join(' | '),
  );
  const emails = new Set();
  for (const b of [ops, customer, device2, other])
    for (const entry of b.log)
      if (entry.path.startsWith('/admin') || entry.path.startsWith('/lab'))
        for (const m of decode(entry.html).matchAll(/[A-Za-z0-9._*+-]+@[A-Za-z0-9.*-]+/g))
          emails.add(m[0]);
  const full = [...emails].filter((address) => !address.includes('***'));
  check(
    full.length === 0,
    'every e-mail address on an Ops or claim page is masked (none in full)',
    `seen: ${[...emails].join(', ')}`,
  );
}

if (FAULT_URL !== undefined) {
  step(
    'G. the API answers 503 on the claim reads: the pages say so (not "no claims", not "not found")',
  );
  const toggle = (on) => fetch(`${FAULT_URL}/__fail?on=${on ? '1' : '0'}`).then((r) => r.text());
  await toggle(true);
  try {
    const list = await customer.go('GET', '/lab/claim');
    const lt = pageText(list.html);
    check(
      lt.includes("We can't show your claims right now") &&
        !lt.includes("You haven't started a claim yet"),
      'the claim list says the service did not answer, and not "no claims"',
      lt.slice(-500),
    );
    check(
      list.html.includes('Find my lab'),
      'the form to find a lab is still there while the list is unavailable',
    );
    const claim = await customer.go('GET', pathA);
    const ct = textOf(claim.html);
    check(
      ct.includes("We can't show this claim right now") && !ct.includes("We can't find this claim"),
      'one claim: "we can\'t show this claim right now", not "we can\'t find this claim"',
      ct.slice(0, 240),
    );
    const opsClaim = await ops.go('GET', `/admin/claims/${idA}`);
    const ot = textOf(opsClaim.html);
    check(
      ot.includes("We can't show this claim right now") && !ot.includes("We can't find this claim"),
      'Ops: one claim says the service did not answer, not "we can\'t find this claim"',
      ot.slice(0, 240),
    );
    check(
      !/Approve…|Reject…/.test(opsClaim.html),
      'Ops: no decision buttons while the claim cannot be read',
    );
  } finally {
    await toggle(false);
  }
  const back = await customer.go('GET', '/lab/claim');
  check(
    pageText(back.html).includes('Your claims') &&
      !pageText(back.html).includes("We can't show your claims"),
    'the list is back when the service answers again',
    pageText(back.html).slice(-500),
  );
}

console.log(
  `\n${checks - failures}/${checks} checks passed${failures > 0 ? `, ${failures} FAILED` : ''}`,
);
process.exit(failures > 0 ? 1 : 0);
