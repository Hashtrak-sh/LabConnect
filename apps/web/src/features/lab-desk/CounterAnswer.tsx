'use client';

import { Alert, Button } from '@labconnect/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import type messages from '../../../messages/en.json';
import { answerCounterAction, type CounterState } from './counter-actions';

type CounterText = typeof messages.counter;

function Notice({
  state,
  text,
  reloadHref,
}: {
  state: CounterState;
  text: CounterText;
  reloadHref: string;
}) {
  switch (state.notice) {
    case undefined:
      return null;
    case 'forbidden':
      return <Alert tone="danger">{text.noticeForbidden}</Alert>;
    case 'expired':
    case 'not-found':
      return <Alert tone="warning">{text.noticeExpired}</Alert>;
    case 'slot':
      return <Alert tone="warning">{text.noticeSlot}</Alert>;
    case 'changed':
      return (
        <Alert tone="warning">
          <p>{text.noticeChanged}</p>
          <Link href={reloadHref}>{text.reload}</Link>
        </Alert>
      );
    case 'signed-out':
      return (
        <Alert tone="warning">
          <p>{text.noticeSignedOut}</p>
          <Link href="/sign-in">{text.signInAgain}</Link>
        </Alert>
      );
    default:
      return <Alert tone="danger">{text.noticeFailed}</Alert>;
  }
}

/**
 * Board C4's two answers. Both buttons post the same form with `answer` set by the button; the
 * booking's version (`If-Match`) and the idempotency key made at render travel as hidden fields.
 */
export function CounterAnswer({
  text,
  bookingId,
  etag,
  initialKey,
}: {
  text: CounterText;
  bookingId: string;
  etag: string;
  initialKey: string;
}) {
  const [state, action, pending] = useActionState<CounterState, FormData>(answerCounterAction, {
    key: initialKey,
  });
  return (
    <form action={action} className="flex flex-col gap-3">
      <Notice state={state} text={text} reloadHref={`/bookings/${bookingId}/counter`} />
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="etag" value={etag} />
      <input type="hidden" name="key" value={state.key} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="answer" value="decline" variant="secondary" disabled={pending}>
          {pending ? text.declining : text.decline}
        </Button>
        <Button type="submit" name="answer" value="accept" loading={pending}>
          {pending ? text.accepting : text.accept}
        </Button>
      </div>
      <p className="text-sm text-text-muted">{text.declineNote}</p>
    </form>
  );
}
