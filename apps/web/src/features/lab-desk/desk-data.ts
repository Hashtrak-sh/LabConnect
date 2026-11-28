import type { components } from '@labconnect/api-contract';
import { cleanEtag, etagOf } from '@/features/common/problem';
import { api } from '@/lib/api';
import { istDate } from '@/lib/format';
import type { BookingStatus, InboxItem } from './desk-model';

export type BookingView = components['schemas']['BookingView'];
export type PublicSlot = components['schemas']['PublicSlot'];
export type ReasonNode = components['schemas']['PublicTaxonomyNode'];

export const INBOX_PAGE_SIZE = 50;

/**
 * One page of `getLabInbox`, most urgent first; `null` when the API refuses or cannot be reached.
 * `status` goes as one comma-separated value (`style: form, explode: false` in the contract).
 */
export async function loadInbox(
  token: string,
  options: { statuses?: readonly BookingStatus[]; cursor?: string | null; limit?: number } = {},
): Promise<{ data: InboxItem[]; nextCursor: string | null } | null> {
  try {
    const { data } = await api(token).GET('/lab/inbox', {
      params: {
        query: {
          ...(options.statuses === undefined ? {} : { status: [...options.statuses] }),
          ...(options.cursor === null || options.cursor === undefined
            ? {}
            : { cursor: options.cursor }),
          limit: options.limit ?? INBOX_PAGE_SIZE,
        },
      },
      querySerializer: { array: { style: 'form', explode: false } },
    });
    if (data === undefined) return null;
    return { data: data.data, nextCursor: data.page.nextCursor };
  } catch {
    return null;
  }
}

export type BookingRead =
  | { kind: 'ok'; booking: BookingView; etag: string }
  | { kind: 'not-found' | 'forbidden' | 'signed-out' | 'unavailable' };

/** `getBooking`: the caller's party's view and its `ETag` (what the decisions send as `If-Match`). */
export async function loadBooking(token: string, id: string): Promise<BookingRead> {
  try {
    const { data, response } = await api(token).GET('/bookings/{id}', {
      params: { path: { id } },
    });
    if (data !== undefined) {
      return {
        kind: 'ok',
        booking: data,
        etag: cleanEtag(response.headers.get('etag')) ?? etagOf(data.lockVersion),
      };
    }
    if (response.status === 404 || response.status === 422) return { kind: 'not-found' };
    if (response.status === 403) return { kind: 'forbidden' };
    if (response.status === 401) return { kind: 'signed-out' };
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** The active REJECTION_REASON codes (board K9's list comes from master data). */
export async function loadRejectionReasons(): Promise<ReasonNode[]> {
  try {
    const { data } = await api().GET('/public/taxonomies/{code}/nodes', {
      params: { path: { code: 'REJECTION_REASON' } },
    });
    return data?.data ?? [];
  } catch {
    return [];
  }
}

/** The site's open slots of the next two weeks, for a counter-offer (board K9). */
export async function loadOpenSlots(siteId: string, now: Date): Promise<PublicSlot[]> {
  try {
    const { data } = await api().GET('/public/lab-sites/{siteId}/slots', {
      params: { path: { siteId }, query: { from: istDate(now), to: istDate(now, 14), limit: 50 } },
    });
    return data?.data ?? [];
  } catch {
    return [];
  }
}
