'use server';

import { randomUUID } from 'node:crypto';
import { api } from '@/lib/api';

export interface LeadState {
  status: 'idle' | 'sent' | 'failed';
}

/**
 * Sends a "Request this lab" or "Request a lab" lead (I1-CUS-07) from the server. The search that
 * found nothing comes as JSON in a hidden field; the device location is never part of it.
 */
export async function createLeadAction(_previous: LeadState, form: FormData): Promise<LeadState> {
  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const kind = field('kind');
  const email = field('contactEmail').trim();
  const contactEmail = email === '' ? {} : { contactEmail: email };

  let body;
  if (kind === 'REQUEST_LAB') {
    body = { kind, labSiteId: field('labSiteId'), ...contactEmail } as const;
  } else if (kind === 'NO_RESULT') {
    let query: Record<string, unknown>;
    try {
      query = JSON.parse(field('query') || '{}') as Record<string, unknown>;
    } catch {
      return { status: 'failed' };
    }
    delete query.lat;
    delete query.lng;
    body = { kind, query, ...contactEmail } as const;
  } else {
    return { status: 'failed' };
  }

  const { response } = await api().POST('/public/leads', {
    params: { header: { 'Idempotency-Key': randomUUID() } },
    // The shape is checked by the API (422 on anything LeadCreate does not allow).
    body: body as never,
  });
  return { status: response.status === 204 ? 'sent' : 'failed' };
}
