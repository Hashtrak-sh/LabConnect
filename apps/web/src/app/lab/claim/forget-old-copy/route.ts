import { type NextRequest, NextResponse } from 'next/server';
import { legacyClaimsExpiry } from '@/features/claim/legacy-cookie';
import { isUuid } from '@/features/common/problem';

/**
 * Deletes an old `lc_claims` cookie (the claims record of the earlier build) and goes back to the
 * claim pages. A page cannot set a cookie, so a claim page that sees the old cookie sends the
 * browser here once. The way back is the claim list or one claim by its id, never anything else
 * (no open redirect), and the answer is never cached.
 */
export function GET(request: NextRequest): NextResponse {
  const to = request.nextUrl.searchParams.get('to');
  const location = isUuid(to) ? `/lab/claim/${to}` : '/lab/claim';
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
  response.cookies.set(legacyClaimsExpiry());
  return response;
}
