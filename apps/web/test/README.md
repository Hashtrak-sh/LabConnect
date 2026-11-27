# End-to-end walk (plain HTTP)

`e2e-walk.mjs` drives the **web app** with `fetch`, like a browser with JavaScript off: a cookie jar
(it stores `Secure` cookies too and honours their `Path`), redirects followed by hand, and every
server-action form posted from the hidden fields the server rendered. It is run by hand; it is not
part of `pnpm test`. It is sequential on purpose (one deliberate double submit aside).

It covers: a signed-out visitor, the return page after sign-in, access denied for a customer and for a
lab Checker on the Ops pages, a claim by certificate number (not found, wrong code, stale `If-Match`,
reload, the cap of 3 open claims, already in review, review, already claimed), Ops enrolment with a
TOTP computed from the setup key (RFC 6238), sign-in with the authenticator, the claims list and
detail, a stale `If-Match` and a missing note on a rejection, a post from another origin, a double
click on approve, the back button after approval, and the claimant's page after approval. It also
checks `Cache-Control: no-store` on the pages and on the responses that carry the setup key and the
recovery codes, and that no redirect carries an e-mail address.

## Run it

You need your own stack (other ports than the developer stack), a fresh seeded database, the API
started with `DEMO_OTP_CODE=444444`, `NODE_ENV=development`, `APP_ENV=local`, `AUTH_ALLOWED_ORIGINS`
set to the web origin, and the web app built with `NODE_ENV=production` and started with `next start`:

```
docker compose -p lc-screens --env-file <your env file> up -d postgres localstack mailpit --wait
# DATABASE_URL, API_DATABASE_URL and WORKER_DATABASE_URL pointing at your Postgres:
pnpm db:migrate && pnpm db:local-users && pnpm seed:demo
pnpm --filter @labconnect/api run build      # then: node dist/main.js in apps/api
NODE_ENV=production pnpm --filter @labconnect/web run build
# next start -p <port> with API_BASE_URL=http://localhost:<api port>/v1 and WEB_BASE_URL=http://localhost:<port>
node apps/web/test/e2e-walk.mjs
```

Settings (environment): `WEB_URL` (default `http://localhost:56300`), `DB_CONTAINER` (the Postgres
container, used once to show that opening the enrolment page makes no authenticator factor; the check
is skipped if `docker` is not available), `DEMO_OTP_CODE` (default `444444`).

The walk needs a **fresh** database: the Ops demo user must not be enrolled yet and the demo labs
`DEMO-TC-0005-1` to `DEMO-TC-0008-1` must be unclaimed. It exits 1 if any check fails.
