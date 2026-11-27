// A pass-through proxy for the e2e walk: it forwards every request to the real API and, while
// switched on, answers `503` to the claim reads (GET /v1/lab/claims, GET /v1/lab/claims/{id},
// GET /v1/admin/claims/{id}) and to nothing else, so `/me` still works and the pages meet a
// service that is up for everything but the read being tested. Run by hand next to the walk:
//   TARGET=http://localhost:57301 PORT=57302 node apps/web/test/fault-proxy.mjs
// and start the web app with API_BASE_URL=http://localhost:57302/v1. Switch it with
// `GET /__fail?on=1` and `GET /__fail?on=0` (the walk does this when FAULT_URL is set).
import { createServer } from 'node:http';

const TARGET = process.env.TARGET ?? 'http://localhost:57301';
const PORT = Number(process.env.PORT ?? 57302);
const READS = /^\/v1\/(lab\/claims(\/[0-9a-f-]{36})?|admin\/claims\/[0-9a-f-]{36})(\?.*)?$/i;
let failing = false;

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://proxy');
  if (url.pathname === '/__fail') {
    failing = url.searchParams.get('on') === '1';
    res.end(failing ? 'failing' : 'passing');
    return;
  }
  if (failing && req.method === 'GET' && READS.test(url.pathname + url.search)) {
    res.writeHead(503, { 'Content-Type': 'application/problem+json', 'Retry-After': '5' });
    res.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', status: 503 }));
    return;
  }
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const upstream = await fetch(new URL(req.url ?? '/', TARGET), {
    method: req.method,
    headers,
    redirect: 'manual',
    ...(hasBody ? { body: req, duplex: 'half' } : {}),
  }).catch(() => null);
  if (upstream === null) {
    res.writeHead(502).end();
    return;
  }
  const out = {};
  for (const [name, value] of upstream.headers) {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie'].includes(name))
      out[name] = value;
  }
  const cookies = upstream.headers.getSetCookie();
  if (cookies.length > 0) out['set-cookie'] = cookies;
  res.writeHead(upstream.status, out);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}).listen(PORT, () => console.log(`fault proxy on ${PORT} -> ${TARGET}`));
