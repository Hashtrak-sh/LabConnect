/**
 * Liveness of the web server itself, for the load balancer, the container health check
 * (infrastructure/lib/stacks/compute-stack.ts) and the deployment smoke test. It does not call
 * the API: a web task must stay in service while the API restarts, and the API has its own
 * check. No personal data, nothing cached.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
