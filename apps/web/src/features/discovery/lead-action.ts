'use server';

import { randomUUID } from 'node:crypto';
import { api } from '@/lib/api';

export interface LeadState {
  status: 'idle' | 'invalid' | 'sent' | 'failed' | 'rate-limited' | 'lab-not-found';
  /** Which fields are wrong (H3 "Validation"). */
  errors?: { what?: true; email?: true };
  /** What the user typed, so a failed send keeps the text (H3 "Your text is kept"). */
  values?: { what: string; email: string };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Request this lab" / "Request a lab" (H3, I1-CUS-07), sent from the server. The search that
 * found nothing comes as JSON in a hidden field; the device location is never part of it.
 * The board asks for the test and an email; the API stores them as `query.q` and `contactEmail`.
 */
export async function createLeadAction(_previous: LeadState, form: FormData): Promise<LeadState> {
  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const kind = field('kind');
  const what = field('what').trim();
  const email = field('contactEmail').trim();
  const values = { what, email };

  const errors: LeadState['errors'] = {};
  if (what === '' || what.length > 200) errors.what = true;
  if (!EMAIL.test(email) || email.length > 254) errors.email = true;
  if (errors.what || errors.email) return { status: 'invalid', errors, values };

  let criteria: Record<string, unknown> = {};
  const hidden = field('criteria');
  if (hidden !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(hidden);
    } catch {
      return { status: 'failed', values };
    }
    // Only a plain object is a search; `null`, an array or a string is refused, not posted.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { status: 'failed', values };
    }
    criteria = { ...(parsed as Record<string, unknown>) };
    delete criteria.lat;
    delete criteria.lng;
  }
  const query = { ...criteria, q: what };

  let body;
  if (kind === 'REQUEST_LAB') {
    body = { kind, labSiteId: field('labSiteId'), query, contactEmail: email } as const;
  } else if (kind === 'NO_RESULT') {
    body = { kind, query, contactEmail: email } as const;
  } else {
    return { status: 'failed', values };
  }

  const { response } = await api().POST('/public/leads', {
    params: { header: { 'Idempotency-Key': randomUUID() } },
    // The shape is checked by the API (422 on anything LeadCreate does not allow).
    body: body as never,
  });
  if (response.status === 204) return { status: 'sent' };
  if (response.status === 429) return { status: 'rate-limited', values };
  if (response.status === 422 && kind === 'REQUEST_LAB') return { status: 'lab-not-found', values };
  return { status: 'failed', values };
}
