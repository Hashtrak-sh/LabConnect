// Preloaded into the end-to-end walk (`node --import gate-fetch.mjs e2e-walk.mjs`) so that every
// request the walk makes to the site carries the access gate's credentials, without changing the
// walk. The header value comes from the environment (GATE_AUTHORIZATION), never the command line.
const authorization = process.env.GATE_AUTHORIZATION ?? '';
const origin = process.env.WEB_URL === undefined ? undefined : new URL(process.env.WEB_URL).origin;
const original = globalThis.fetch;

if (authorization !== '' && origin !== undefined) {
  globalThis.fetch = (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) return original(input, init);
    const headers = new Headers(
      init.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set('Authorization', authorization);
    return original(input, { ...init, headers });
  };
}
