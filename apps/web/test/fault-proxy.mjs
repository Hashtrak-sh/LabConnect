// A pass-through proxy for the e2e walk: it forwards every request to the real API and, while
// switched on, answers `503` to the claim reads (GET /v1/lab/claims, GET /v1/lab/claims/{id},
// GET /v1/admin/claims/{id}) and to nothing else, so `/me` still works and the pages meet a
// service that is up for everything but the read being tested. Run by hand next to the walk:
//   TARGET=http://localhost:57301 PORT=57302 node apps/web/test/fault-proxy.mjs
// and start the web app with API_BASE_URL=http://localhost:57302/v1. Switch it with
// `GET /__fail?on=1` and `GET /__fail?on=0` (the walk does this when FAULT_URL is set).
//
// It listens on 127.0.0.1 only, and it can reach one place only: the host and port of TARGET are
// fixed when it starts, and a request contributes nothing but its path and query. A request line
// that names another host (`//other.example/x`, an absolute URL) is forwarded to TARGET like any
// other path.
import { createServer, request } from 'node:http';

const TARGET = process.env.TARGET ?? 'http://localhost:57301';
const target = new URL(TARGET);
if (target.protocol !== 'http:') throw new Error('TARGET must be an http:// address.');
const PORT = Number(process.env.PORT ?? 57302);
const READS = /^\/v1\/(lab\/claims(\/[0-9a-f-]{36})?|admin\/claims\/[0-9a-f-]{36})(\?.*)?$/i;
let failing = false;

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://proxy');
  const pathAndQuery = url.pathname + url.search;
  if (url.pathname === '/__fail') {
    failing = url.searchParams.get('on') === '1';
    res.end(failing ? 'failing' : 'passing');
    return;
  }
  if (failing && req.method === 'GET' && READS.test(pathAndQuery)) {
    res.writeHead(503, { 'Content-Type': 'application/problem+json', 'Retry-After': '5' });
    res.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', status: 503 }));
    return;
  }
  // The body and the headers pass through as they are; only `Host` and `Connection` are the
  // proxy's own.
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  const upstream = request(
    {
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: pathAndQuery,
      headers,
    },
    (answer) => {
      const status = answer.statusCode ?? 502;
      if ((process.env.LOG === '1' && status >= 400) || process.env.LOG === 'all')
        console.log(`${String(req.method)} ${url.pathname} -> ${String(status)}`);
      res.writeHead(status, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    console.log(`upstream failed: ${String(req.method)} ${url.pathname} ${String(error)}`);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`fault proxy on 127.0.0.1:${String(PORT)} -> ${target.origin}`);
});
