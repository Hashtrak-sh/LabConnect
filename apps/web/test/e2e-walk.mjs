// End-to-end walk over plain HTTP against the real stack (see README.md). It drives the web app
// the way a browser without JavaScript does: a cookie jar, redirects followed by hand, and every
// server-action form posted from the hidden fields the server rendered. Run by hand, not part of
// the unit tests. Sequential on purpose, except the one deliberate double submit.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const WEB = process.env.WEB_URL ?? 'http://localhost:56300';
const DB_CONTAINER = process.env.DB_CONTAINER ?? 'lc-screens-postgres-1';
const CODE = process.env.DEMO_OTP_CODE ?? '444444';
const CUSTOMER = 'customer.admin.demo1@demo.labconnect.test';
const OPS = 'ops.demo@demo.labconnect.test';
const CERT_A = 'DEMO-TC-0005-1'; // approved
const CERT_B = 'DEMO-TC-0006-1'; // stale If-Match, then left open
const CERT_C = 'DEMO-TC-0007-1'; // rejected
const CERT_D = 'DEMO-TC-0008-1'; // over the cap of 3 open claims

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
  }
  header(pathname) {
    return [...this.cookies]
      .filter(([, c]) => pathname.startsWith(c.path))
      .map(([n, c]) => `${n}=${c.value}`)
      .join('; ');
  }
  store(response) {
    for (const line of response.headers.getSetCookie()) {
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
  const back = await signInUntilCode(customer, CUSTOMER, `${WEB}/admin/claims`);
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

step('B. customer claims a lab by certificate number');
let claimId;
let claimPath;
{
  const page = await customer.go('GET', '/lab/claim');
  check(
    textOf(page.html).includes('Claim your lab on LabConnect') &&
      /<h1/.test(page.html) &&
      /<main/.test(page.html),
    'the claim page opens (one h1, a main landmark)',
  );
  check(/no-store/.test(page.headers.get('cache-control') ?? ''), 'the claim page is no-store');
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
  claimPath = new URL(started.url).pathname;
  claimId = claimPath.split('/').pop();
  check(
    /^\/lab\/claim\/[0-9a-f-]{36}$/.test(claimPath),
    "starting a claim leaves the form for the claim's own page (reload-safe)",
    started.url,
  );
  const text = textOf(started.html);
  check(
    /We sent a 6-digit code to the email NABL has on record for this certificate: \S+\*\*\*@\*\*\*\.\S+/.test(
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

  const stale = await submit(customer, formWith(wrong.html, wrong.url, 'Verify and claim'), {
    set: { code: CODE, etag: '"999"' },
    button: 'verify',
  });
  check(
    textOf(stale.html).includes('This claim changed') &&
      textOf(stale.html).includes('Reload this claim'),
    'a stale If-Match shows "this claim changed" with a reload',
  );
  const reloaded = await submit(customer, formWith(stale.html, stale.url, 'Reload this claim'), {
    button: 'reload',
  });
  check(textOf(reloaded.html).includes('reloaded'), 'reloading the claim works and says so');

  step('B2. the cap of 3 open claims, then the other states');
  const { html, url } = await customer.go('GET', '/lab/claim');
  const f1 = await submit(customer, formWith(html, url, 'Find my lab'), {
    set: { certificateNo: CERT_B },
    button: 'Find my lab',
  });
  const bPage = await customer.go('GET', new URL(f1.url).pathname);
  await submit(customer, formWith(bPage.html, bPage.url, 'Verify and claim'), {
    set: { code: CODE },
    button: 'verify',
  });
  const p2 = await customer.go('GET', '/lab/claim');
  const f2 = await submit(customer, formWith(p2.html, p2.url, 'Find my lab'), {
    set: { certificateNo: CERT_C },
    button: 'Find my lab',
  });
  const cPage = await customer.go('GET', new URL(f2.url).pathname);
  await submit(customer, formWith(cPage.html, cPage.url, 'Verify and claim'), {
    set: { code: CODE },
    button: 'verify',
  });
  const p3 = await customer.go('GET', '/lab/claim');
  const cap = await submit(customer, formWith(p3.html, p3.url, 'Find my lab'), {
    set: { certificateNo: CERT_D },
    button: 'Find my lab',
  });
  check(
    textOf(cap.html).includes('Limit reached'),
    'the fourth open claim is refused: "limit reached"',
  );

  // Verify the code of the first claim.
  const pageA = await customer.go('GET', claimPath);
  const ok = await submit(customer, formWith(pageA.html, pageA.url, 'Verify and claim'), {
    set: { code: CODE },
    button: 'verify',
  });
  check(textOf(ok.html).includes('In review'), 'the right code moves the claim to "In review"');
  const second = await customer.go('GET', '/lab/claim');
  const own = await submit(customer, formWith(second.html, second.url, 'Find my lab'), {
    set: { certificateNo: CERT_A },
    button: 'Find my lab',
  });
  check(
    textOf(own.html).includes('already in review') && own.html.includes(claimPath),
    'claiming the same lab again: "already in review", with a link to the claim',
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
  check(/IST/.test(t), 'times are shown with IST');
  check(/no-store/.test(list.headers.get('cache-control') ?? ''), 'the Ops list is no-store');
  check(!textOf(list.html).includes('Claim your lab'), 'the header offers Ops no "Claim your lab"');
  const claimLinks = [...list.html.matchAll(/<li><div[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);
  const pick = (cert) =>
    /href="(\/admin\/claims\/[0-9a-f-]{36})"/.exec(
      claimLinks.find((li) => li.includes(cert)) ?? '',
    )?.[1];
  const pathA = pick(CERT_A);
  const pathB = pick(CERT_B);
  const pathC = pick(CERT_C);
  check(
    pathA?.endsWith(claimId) === true,
    "the claim in the list is the customer's claim",
    `${String(pathA)} vs ${claimId}`,
  );

  const filtered = await ops.go('GET', '/admin/claims?status=APPROVED');
  check(
    textOf(filtered.html).includes('No claims to review'),
    'filter by status: APPROVED is empty before the approval',
  );
  const own = await ops.go('GET', '/lab/claim');
  check(
    textOf(own.html).includes("Platform staff can't claim a lab"),
    'an Ops user who opens the claim page is told staff cannot claim',
  );
  const foreign = await ops.go('GET', claimPath);
  check(
    textOf(foreign.html).includes("We can't find this claim") &&
      !textOf(foreign.html).includes(CERT_A),
    'another user\'s claim id in the address is "we can\'t find this claim"',
  );
  const random = await ops.go('GET', '/lab/claim/00000000-0000-7000-8000-000000000000');
  check(
    textOf(random.html).includes("We can't find this claim"),
    'an unknown claim id gives the same panel',
  );

  const detail = await ops.go('GET', pathA);
  const dt = textOf(detail.html);
  check(
    dt.includes('Claimant (reference)') &&
      dt.includes('Email code verified') &&
      dt.includes(CERT_A) &&
      /IST/.test(dt),
    'the claim detail shows lab, claimant reference, method and time in IST',
  );
  check(
    !/downloadUrl|X-Amz|\/labconnect-files\//.test(detail.html),
    'no download link is in the page',
  );
  const confirmPage = await ops.go('GET', `${pathA}?decide=approve`);
  check(
    textOf(confirmPage.html).includes(
      "The claimant becomes this lab's first Checker and the lab becomes claimed",
    ),
    'the approve confirm step states what approval does',
  );

  // Stale If-Match on a rejection.
  const rejectPage = await ops.go('GET', `${pathB}?decide=reject`);
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
  const afterCross = await ops.go('GET', pathB);
  check(
    cross.status !== 303 &&
      textOf(afterCross.html).includes('In review') &&
      !textOf(afterCross.html).includes('Posted from another site'),
    `a post from another origin is refused and changes nothing (status ${cross.status})`,
  );

  // Reject one with a reason.
  const rejectC = await ops.go('GET', `${pathC}?decide=reject`);
  const rejected = await submit(ops, formWith(rejectC.html, rejectC.url, 'Reject claim'), {
    set: { reason: 'signature', notes: 'Please upload a letter signed by the lab director.' },
    button: 'Reject claim',
  });
  check(
    rejected.url.includes('decided=rejected') &&
      textOf(rejected.html).includes(
        'Letter not signed by an authorised signatory: Please upload a letter signed by the lab director.',
      ),
    'Ops: rejecting with a reason writes the reason at the start of the notes',
  );
  check(
    rejected.url.includes('?decided=rejected') && !/@/.test(rejected.url),
    'the redirect after a decision carries no personal data',
  );

  // Double click on approve: two posts of the same form at once; exactly one acts.
  const approvePage = await ops.go('GET', `${pathA}?decide=approve`);
  const approveForm = formWith(approvePage.html, approvePage.url, 'Approve claim');
  const [r1, r2] = await Promise.all([
    submit(ops, approveForm, { button: 'Approve claim' }),
    submit(ops, approveForm, { button: 'Approve claim' }),
  ]);
  const approvedCount = [r1, r2].filter((r) => r.url.includes('decided=approved')).length;
  const other = [r1, r2].find((r) => !r.url.includes('decided=approved'));
  check(
    approvedCount === 1,
    'a double click on approve: exactly one approval',
    `${r1.url} / ${r2.url}`,
  );
  check(
    other === undefined || /isn't waiting for a decision/.test(textOf(other.html)),
    'the other post lands on the claim, which is no longer waiting for a decision',
    other === undefined ? '' : textOf(other.html).slice(0, 200),
  );
  const back = await ops.go('GET', `${pathA}?decide=approve`);
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
  const letter = await ops.go('GET', pathA);
  check(!letter.html.includes('Review letter'), 'a code claim has no letterhead button');
}

step('D. the claimant after approval');
{
  const stale = await customer.go('GET', '/lab/claim');
  const staleText = textOf(stale.html);
  console.log(
    `   (the old session, before signing in again: ${staleText.includes('Your labs') ? 'shows "Your labs"' : staleText.includes('Sign in to continue') ? 'asks to sign in' : 'shows the claim page without the lab'})`,
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
    t.includes('Your labs') && t.includes('Lab Checker') && t.includes('DEMO Laboratory 0005'),
    'the claim page now shows the approved lab and the Checker role',
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

console.log(
  `\n${checks - failures}/${checks} checks passed${failures > 0 ? `, ${failures} FAILED` : ''}`,
);
process.exit(failures > 0 ? 1 : 0);
