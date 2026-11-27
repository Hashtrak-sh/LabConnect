# Running the leadership demonstration on this kit

Read `README.md` first: it builds the server (instance, Docker, `make-env.sh`, `docker compose`). This file is
what the **demonstration** adds on top: who may reach the site, the access gate, the fixed sign-in code, the
scripts that load, check, reset and back up the demo, and what is missing compared with the real AWS design.

The product owner decided: the server has **a domain and HTTPS only** (no plain-HTTP mode), the site sits behind
**a shared user name and password**, and the security group admits **known addresses only**. All three are the
default below.

## The security group (the default: both protections, not one)

The product owner supplies the list of addresses for port 443 (the office, the leadership, the developers).

| Direction | Port | Source | Why |
|---|---|---|---|
| Inbound | 443 TCP | the product owner's list | the site |
| Inbound | 80 TCP | **0.0.0.0/0** (everyone) | the certificate authority validates over HTTP, and **renews about every 60 days** the same way: **this rule must stay**. Port 80 serves nothing of the application: a redirect to `https://<domain>` and the certificate challenge only (no gate prompt, no page; a forged `Host` is not echoed). |
| Inbound | 22 TCP | the developers' addresses only | SSH |
| Inbound | everything else | none | |
| Outbound | all | anywhere | image pulls, the certificate authority, package updates |

A visitor whose address is not on the list gets **no answer at all** on 443 (a timeout). Mobile networks change
address: ask leadership for the address they will really be on, and add it before the day. Over port 80 a visitor
from anywhere only ever sees the redirect.

**If the certificate cannot be issued this way** (it should: Let's Encrypt's HTTP-01 challenge needs port 80 only and
Caddy answers it before any other rule; the real issuance could not be run without a public name, so it is not
verified): check the DNS record and the port-80 rule (`docker compose logs caddy`); Let's Encrypt allows five failed
validations per name per hour, so after that wait an hour. **Fallbacks, not the default:** open 443 to everyone for
the minutes issuance takes (Caddy also tries the TLS-ALPN challenge on 443; the gate still protects the site), then
restore the list; or the DNS challenge, which needs a Caddy image built with your DNS provider's plugin and an API
credential for the zone (not in this kit).

IMDS: set the instance to IMDSv2 only with a hop limit of 1 (`HttpTokens=required`, `HttpPutResponseHopLimit=1`) so a
container cannot read the instance role. `preflight.sh` warns if a container can.

## The access gate

The demo accounts and the fixed code are published in a public repository, and the first person to sign in as Platform
Ops enrols its authenticator. So the proxy asks for one shared user name and password (HTTP basic authentication,
stored only as a bcrypt hash) before anything is served: the site, `/health` and Mailpit.

- **On by default.** `make-env.sh` asks for the user name (default `demo`) and the password (typed hidden, or `GATE_PASSWORD`
  in the environment; not on a command line, which stays in the shell history). If you leave the password empty it is
  generated into `deploy/ec2/.gate-password` (owner only, **never printed or logged**): read it once, hand it out,
  delete the file.
- **Off only on purpose:** `ACCESS_GATE=off ./make-env.sh <domain>` (or `ACCESS_GATE=off` in `.env`). It warns. Any other
  value, or a missing snippet, stops the proxy from starting: the gate fails closed.
- **Mailpit sits behind the same gate** (`/mailpit/`): one prompt, and the people who may see the demo may see the
  inbox. With the gate off, Mailpit keeps its own password (`MAILPIT_USER` and the generated password), so the inbox is
  never open: it holds every sign-in code of a non-demo address.
- **The credentials stop at the proxy.** Caddy removes the `Authorization` header before it reaches the web app or
  Mailpit, so the API never sees it either (the web server builds its own API requests). Caddy's access log is off, so
  credentials, cookies and query strings (a visitor's location) are logged nowhere.
- A browser sends the credentials on every same-origin request after the first prompt, so server actions, the session
  refresh and `/api/suggest` work behind it; the map tiles come straight from a public tile server in the visitor's
  browser and do not touch the gate (the visitor's browser needs internet). `check/check.mjs` exercises all of this.
- **No rate limit on gate attempts** (Caddy has none built in): the security group is what limits who can try.

## The demo sign-in code

The compose file now passes `DEMO_OTP_CODE` and `DEMO_OTP_EMAIL_DOMAIN` to the **API only**, as the application already
supports (`APP_ENV=uat` allows them; the API refuses them in production). `make-env.sh` asks for a six-digit code
(`DEMO_OTP_CODE` in the environment; empty means no demo code and the line is left out of `.env`: the API refuses a
variable that is present but empty). With a code, the sign-in and lab-claim codes of the demo accounts
(`…@demo.labconnect.test`) are that code and are not mailed; the authenticator step still applies. Check the API log
for the start-up warning "Demo one-time codes are ENABLED".

## What changed in the first setup

Use `README.md` steps 1 to 3 as they are. Then, from `deploy/ec2`:

```bash
./preflight.sh                              # Docker, memory, disk, ports: ends with "preflight: OK"
./make-env.sh uat.labconnect.example        # asks for the gate password and the demo code
./up.sh                                     # build one image at a time, migrate, start, wait for health
./seed-demo.sh                              # the demo data; safe to run twice
```

`./make-env.sh` no longer has `--ip` (plain HTTP): a domain is required. `--local` exists for **local verification on a
developer machine only** (`uat.localhost`, Caddy's own certificate, ports 58080 and 58443); `up.sh` and the other scripts
refuse that mode for any other name.

## The demonstration

Sign in with the published demo accounts and your code. **Enrol the Platform Ops authenticator yourself, and keep its
recovery codes, before anyone else can reach the site** (until then the first person to sign in as Ops owns it).

1. Without signing in: search for a test with the typeahead (`TDS`), results with the map, filters, a lab page with prices and slots.
2. Sign in as a demo customer (`customer.admin.demo1@demo.labconnect.test`) with the code; sign up a new organisation.
3. The lab owner `lab.owner.demo1@demo.labconnect.test` claims the unclaimed demo lab by certificate number
   `DEMO-TC-0005-1` with the code; Platform Ops `ops.demo@demo.labconnect.test` enrols an authenticator, signs in again,
   opens the claim requests and approves; the lab owner signs in again, enrols, and sees the lab.

## Checking it works

From your laptop (Node 24; the repository checked out; **secrets from the environment, never the command line**):

```bash
read -rs GATE_PASSWORD; export GATE_PASSWORD GATE_USER=demo DEMO_OTP_CODE=<the code>
node deploy/ec2/check/check.mjs https://<domain>
```

**Safe mode (the default)** changes nothing lasting and can run before every demonstration: the certificate is trusted and
has days left; **port 80 only redirects** (also with a forged `Host`, for `/health` and the challenge path); the gate
refuses requests without or with a wrong password (also `/mailpit/`); `/health`; the home page; a search for `TDS` that
lists a lab with a price; a lab page; the typeahead; sign-in as the demo customer with your code; a page that needs the
session; the session cookies are `Secure` and `HttpOnly`; a **forced refresh** (the check drops the access cookie, so the
web server must rotate the session with the API and its `Origin`: no ten-minute wait); sign-out; and that the API, the web
server, Mailpit's own ports, Redis, PostgreSQL and the proxy's admin port are **not reachable** from outside (run it from an
address on the security-group list, or the ports look closed for the wrong reason; also try
`curl http://127.0.0.1:3001/v1/health` on the server, which must fail). It is sequential on purpose: **two simultaneous
session refreshes sign the user out** (a known weakness being fixed elsewhere), so never run two checks, or a check and a
browser on one session, at once. One safe run makes **one** sign-in.

**Rehearsal mode** (`--rehearsal`) runs the safe checks, then plays the whole story with the end-to-end walk
`apps/web/test/e2e-walk.mjs` (claim a lab by certificate number, Platform Ops enrols with a computed authenticator code,
approval). It **uses up demo data**: afterwards Platform Ops is enrolled with a secret nobody holds and labs are claimed, so
**`./reset-demo.sh --yes-destroy-the-database` must run afterwards**, before the real demonstration; the check says so,
loudly, at the start and at the end. The walk file exists once `feature/web-enrol-claim-ops` is merged (the check says
so if it is missing; `WALK_SCRIPT=<path>` points at another copy).

## Day to day (scripts in `deploy/ec2`)

| Command | What it does |
|---|---|
| `./up.sh` | check `.env`, build, migrate, start, wait. Safe to repeat. |
| `./seed-demo.sh` | migrate, load the demo data, refresh the planner's statistics. Safe to repeat. |
| `./status.sh` | services, health, memory, disk |
| `docker compose logs -f api web caddy` | logs |
| `./update.sh` | `git pull --ff-only`, build the new images **while the old containers keep running**, migrate, replace what changed, clean up. A failed build leaves the running demo untouched. |
| `./reset-demo.sh --yes-destroy-the-database` | destroys the database volume and loads a fresh seeded one (between rehearsals). Without the flag it only prints what it would destroy. Certificates are kept. |
| `./backup.sh` | `pg_dump` to `backups/lc-<time>.dump` (owner only). Nothing runs it for you. |
| `./restore-check.sh <file>` | restores a backup into a scratch database, counts, drops it |
| `./preflight.sh` | the server check |

**Mail inbox.** `https://<domain>/mailpit/` with the gate's login (nothing else is published). For the API or the
database use `docker compose exec`; there is no tunnel helper because nothing needs one.

**Restore** over the real database (manual, destructive): `docker compose stop web api`, `docker compose rm -sfv postgres`,
remove the `<project>_postgres-data` volume, `docker compose up -d postgres`, `docker compose run --rm --no-deps migrate`
(the roles come from it), `docker compose exec -T postgres pg_restore -U labconnect -d labconnect --no-owner < backups/<file>`,
then `./up.sh`.

**Take it down.** `docker compose down` stops and removes the containers and keeps the data; `--volumes` also destroys the
database **and the certificates** (re-issuing counts against the certificate authority's rate limits). Then terminate the
instance and delete the DNS record.

## Sizing (measured)

Memory of each container (`docker stats`, after the walk and several sign-ins, no worker and no S3 in this kit):
API about 300 MiB, web about 100, PostgreSQL about 90, Caddy 20, Mailpit 8, Redis 8: **about 0.5 GiB in use**. The
image build is the peak: `pnpm install`, the TypeScript build and `next build` run in Docker stages. On the machine used
for verification (shared with other work, so its numbers are not clean) the build never failed; a clean figure for a
4 GiB instance is **not measured**, which is why this kit recommends 8 GiB (`t3.large`) and, below that, requires memory
plus swap of 5.5 GB in `preflight.sh`. Disk: `docker system df` after a first build showed the images and build cache in
the order of 10 to 15 GB (the `migrate` image is large because it carries the build tools): 30 GB leaves room for the
database, logs and a few updates. Measured how: `preflight.sh` reads `/proc/meminfo` and `df`; `status.sh` prints the
container figures.

## Sign-in limits (OQ-240, OQ-264)

The API refuses a new one-time code when **20 have been requested from one address in an hour** (all purposes: sign-in and
lab-claim codes together) or **5 for one e-mail address and purpose in 15 minutes**. Since the sign-in actions pass the
visitor's address on (`X-Forwarded-For`, `API_TRUST_PROXY_HOPS=1`), the 20 per hour count **per visitor address** for
sign-in; the lab-claim code requests carry no address and count for the web container, which is one address for everybody.
Measured on this kit: **a full rehearsal makes 10 requests** (the safe check's sign-in, plus 9 by the walk: 5 sign-ins and
4 claim codes), a safe check makes 1, so two full rehearsals fit in one hour from one address. **`./reset-demo.sh` empties
the counters** (they live in the database), and a reset is required after a rehearsal anyway. A live demonstration that signs
in with the same account more than 5 times in a quarter of an hour is refused until the window passes: use the
different demo accounts, and do not run the safe check more than a few times just before the event (it signs in as the same
customer each time: 5 in 15 minutes is the limit).

## What the missing worker and S3 cost the demonstration

**None of the three acts needs the worker or object storage.** Confirmed by running the whole story on this stack (no
worker, no S3): the end-to-end walk passed the claim by certificate number, Platform Ops's enrolment with a computed
authenticator code, the claims list, the approval, and the claimant's sign-in after it (the one failing check of the walk
is a stale lab name, see "Known failing check" below). What does not happen without the worker, seen in the database after
that run: the **outbox events are never relayed** (8 rows stayed unpublished), so no **notification or e-mail** is
created (for example, the claimant is not told that the claim was approved; the `notification` table stayed empty); the
**audit log is written but never sealed** (33 rows, no sealing job), and **timers never fire**. File uploads need S3 and
the scanner (the letterhead path of a claim), which are not here either. All of this is invisible in the three acts; it
would matter for the later increments (bookings with deadlines, e-mails, reports).

**Known failing check of the walk.** The walk's check "the claim page now shows the approved lab and the Checker role" looks
for the lab name `DEMO Laboratory 0005`; the demo seed on `main` gives the labs realistic names (there is no lab with that
name), so that one check fails on every stack. The other 82 of the 83 checks pass.

## Operating notes

- **Reboot.** `restart: unless-stopped` plus the Docker service enabled at boot (`setup-ec2.sh`) bring everything back; the
  database and the certificates are on volumes, nothing is seeded again. Docker starts containers in no fixed order, but the
  API connects to the database lazily and each service has a health check: simulated by stopping all six containers and starting the proxy, web and API first, the database 15 seconds later: all
healthy within about 25 seconds of the database starting, no re-seed (the 200 demo labs were still there), and the safe
check passed.
- **Disk.** Container logs are not rotated by this kit's compose file (Docker's default json-file driver keeps them
  without limit): see the review notes; `update.sh` prunes dangling images and build cache older than three days. Watch
  `docker system df` (`./status.sh`).
- **The `.env` file** holds every secret and is owner only (`up.sh` refuses to run if other users can read it). `docker inspect`
  shows container environments, so never paste its output into a chat; do not copy `.env` into backups or tickets.
- **A visitor who uses the bare IP** or another name gets a TLS failure on 443 (no certificate for it; and 443 is closed to
  them by the security group anyway) and a redirect to the real domain on 80; the app never sees that `Host`. A forged
  `X-Forwarded-For` or `-Host` is replaced by the proxy.
- **Clock.** Authenticator codes are time based (30-second steps, one step either side). Keep the server on NTP (Ubuntu does
  by default; `chronyc tracking`/`timedatectl`). A drift of more than a minute makes every code fail.
- **Outbound internet at build time** is needed (npm registry, base images, the Prisma engine and the RDS certificate bundle
  downloaded by the Dockerfile). If the network blocks it the build fails at that step; build elsewhere and
  `docker save`/`docker load` the three images.

## Not verified

The scripts were written for Ubuntu 24.04 (Docker 24+, compose 2.20+) and run only on one Windows machine with Docker Desktop
(Git Bash), under the compose project name `lc-single`. Real certificate issuance and renewal through port 80 were **not**
run (no public name), IMDS behaviour was not tested without an AWS instance, and a reboot was simulated by stopping and
starting the containers, not by rebooting a host.

## What is different from the real AWS design, and what must never be copied to production

- **Mailpit** instead of SES, no KMS (the three QR key ARNs are placeholders; the authenticator and payment keys are plain
  secrets in `.env`), no S3, no OpenSearch (search runs on PostgreSQL), no GuardDuty, **no worker**.
- **File uploads do not work**: there is no object storage and no scanner (the fake one is refused outside development and
  test, as it must be). The lab-claim **letterhead** path cannot work. The demonstration claims by certificate number.
- **The demo code and the demo accounts are published** in a public repository. The API refuses them in production
  (`APP_ENV=production`); here `APP_ENV=uat` allows them. Never set them on a real environment.
- **The gate and the firewall are the only protection**: no WAF, no rate limits, no load balancer. `ACCESS_GATE=off` means
  anyone who reaches 443 can sign in as the demo accounts.
- **One server**: no redundancy, no autoscaling; a reboot or Docker restart interrupts the demo.
- **No backups unless you run `backup.sh`**; the database, the secrets and the certificates are on one disk.
- **The fake payment gateway** with a plain secret.
- The API's per-address limits count visitors by the address Caddy sees (see "Sign-in limits").
- Local verification mode (`make-env.sh --local`, `TLS_MODE=internal`) is for a `*.localhost` name only.
- Never copy to production: this folder, the placeholder ARNs, the `.env` format (plain secrets), the demo code, the gate,
  `ACCESS_GATE=off`, the AWS test-style settings, a stand-in for any managed service.
