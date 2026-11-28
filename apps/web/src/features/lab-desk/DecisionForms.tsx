'use client';

import { Alert, Button, Field, fieldProps, Input, Select, Textarea } from '@labconnect/ui';
import Link from 'next/link';
import { useActionState } from 'react';
import type messages from '../../../messages/en.json';
import { acceptAction, counterAction, type DecisionState, rejectAction } from './desk-actions';

export type DeskText = typeof messages.labDesk;

/** A refused decision as a banner (board K9 "Errors and SLA states"). */
function Notice({
  state,
  text,
  reloadHref,
}: {
  state: DecisionState;
  text: DeskText;
  reloadHref: string;
}) {
  switch (state.notice) {
    case undefined:
      return null;
    case 'changed':
    case 'already-decided':
      return (
        <Alert tone="warning">
          <p>{state.notice === 'changed' ? text.noticeChanged : text.noticeDecided}</p>
          <Link href={reloadHref}>{text.reload}</Link>
        </Alert>
      );
    case 'slot-unavailable':
      return <Alert tone="warning">{text.noticeSlot}</Alert>;
    case 'site-not-bookable':
      return (
        <Alert tone="danger" title={text.noticeSiteTitle}>
          {text.noticeSite}
        </Alert>
      );
    case 'counter-field':
      return <Alert tone="danger">{text.noticeCounterField}</Alert>;
    case 'invalid':
      return <Alert tone="danger">{text.noticeInvalid}</Alert>;
    case 'forbidden':
      return <Alert tone="danger">{text.noticeForbidden}</Alert>;
    case 'busy':
      return <Alert tone="warning">{text.noticeBusy}</Alert>;
    case 'not-found':
      return <Alert tone="danger">{text.noticeNotFound}</Alert>;
    case 'rate-limited':
      return <Alert tone="warning">{text.noticeRateLimited}</Alert>;
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

interface Common {
  text: DeskText;
  bookingId: string;
  etag: string;
  initialKey: string;
  cancelHref: string;
}

function Hidden({
  bookingId,
  etag,
  stateKey,
}: {
  bookingId: string;
  etag: string;
  stateKey: string;
}) {
  return (
    <>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="etag" value={etag} />
      <input type="hidden" name="key" value={stateKey} />
    </>
  );
}

function Actions({
  text,
  pending,
  confirm,
  busy,
  cancelHref,
  destructive,
}: {
  text: DeskText;
  pending: boolean;
  confirm: string;
  busy: string;
  cancelHref: string;
  destructive?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="submit"
        loading={pending}
        {...(destructive === true ? { variant: 'destructive' } : {})}
      >
        {pending ? busy : confirm}
      </Button>
      <Button asChild variant="secondary">
        <Link href={cancelHref}>{text.cancel}</Link>
      </Button>
    </div>
  );
}

/** "Accept {booking}?" (K9): what accepting does, right above the button. */
export function AcceptForm({
  title,
  effect,
  ...common
}: Common & { title: string; effect: string }) {
  const { text } = common;
  const [state, action, pending] = useActionState<DecisionState, FormData>(acceptAction, {
    key: common.initialKey,
  });
  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p>{effect}</p>
      <Notice state={state} text={text} reloadHref={common.cancelHref} />
      <Hidden bookingId={common.bookingId} etag={common.etag} stateKey={state.key} />
      <Actions
        text={text}
        pending={pending}
        confirm={text.acceptConfirm}
        busy={text.accepting}
        cancelHref={common.cancelHref}
      />
    </form>
  );
}

/** "Decline this request?" (K9): a reason from master data and a message the customer sees. */
export function RejectForm({
  reasons,
  ...common
}: Common & { reasons: { code: string; name: string }[] }) {
  const { text } = common;
  const [state, action, pending] = useActionState<DecisionState, FormData>(rejectAction, {
    key: common.initialKey,
  });
  const reasonError = state.errors?.includes('reason') === true ? text.reasonRequired : undefined;
  const messageError =
    state.errors?.includes('message') === true ? text.messageRequired : undefined;
  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{text.rejectTitle}</h2>
      <Notice state={state} text={text} reloadHref={common.cancelHref} />
      <Hidden bookingId={common.bookingId} etag={common.etag} stateKey={state.key} />
      <Field
        id="reject-reason"
        label={text.reasonLabel}
        required
        {...(reasonError === undefined ? {} : { error: reasonError })}
      >
        <Select
          {...fieldProps('reject-reason', {
            required: true,
            ...(reasonError === undefined ? {} : { error: reasonError }),
          })}
          name="reason"
          required
          defaultValue={state.values?.reason ?? ''}
        >
          <option value="">{text.reasonChoose}</option>
          {reasons.map((reason) => (
            <option key={reason.code} value={reason.code}>
              {reason.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        id="reject-message"
        label={text.messageLabel}
        help={text.messageHelp}
        required
        {...(messageError === undefined ? {} : { error: messageError })}
      >
        <Textarea
          {...fieldProps('reject-message', {
            help: text.messageHelp,
            required: true,
            ...(messageError === undefined ? {} : { error: messageError }),
          })}
          name="message"
          required
          maxLength={2000}
          defaultValue={state.values?.message ?? ''}
        />
      </Field>
      <Actions
        text={text}
        pending={pending}
        confirm={text.rejectConfirm}
        busy={text.rejecting}
        cancelHref={common.cancelHref}
        destructive
      />
    </form>
  );
}

export interface CounterLineInput {
  lineId: string;
  testName: string;
  unitCode: string;
  unitName: string;
  current: number;
}

/**
 * "Propose a change" (K9): another open slot of the site and/or more sample per line, and a
 * message. No price field: a counter-offer cannot change it (BR-017, CD-08).
 */
export function CounterForm({
  slots,
  lines,
  currentSlotId,
  currentSlotLabel,
  ...common
}: Common & {
  slots: { id: string; label: string }[];
  lines: CounterLineInput[];
  currentSlotId: string | null;
  currentSlotLabel: string | null;
}) {
  const { text } = common;
  const [state, action, pending] = useActionState<DecisionState, FormData>(counterAction, {
    key: common.initialKey,
  });
  const errors = state.errors ?? [];
  const messageError = errors.includes('message') ? text.messageRequired : undefined;
  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{text.counterTitle}</h2>
      <p>{text.counterEffect}</p>
      <Notice state={state} text={text} reloadHref={common.cancelHref} />
      {errors.includes('nothing') && <Alert tone="danger">{text.counterNothing}</Alert>}
      <Hidden bookingId={common.bookingId} etag={common.etag} stateKey={state.key} />
      <input type="hidden" name="currentSlotId" value={currentSlotId ?? ''} />
      {lines.map((line) => (
        <input
          key={line.lineId}
          type="hidden"
          name="line"
          value={`${line.lineId}|${line.unitCode}|${String(line.current)}`}
        />
      ))}
      <Field
        id="counter-slot"
        label={text.slotLabel}
        {...(slots.length === 0 ? { help: text.slotNone } : {})}
      >
        <Select
          {...fieldProps('counter-slot', slots.length === 0 ? { help: text.slotNone } : {})}
          name="slotId"
          defaultValue={state.values?.slotId ?? ''}
        >
          <option value="">
            {currentSlotLabel === null ? text.slotKeep : `${text.slotKeep} · ${currentSlotLabel}`}
          </option>
          {slots
            .filter((slot) => slot.id !== currentSlotId)
            .map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.label}
              </option>
            ))}
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-medium">{text.qtyLabel}</legend>
        <p className="text-sm text-text-muted">{text.qtyHelp}</p>
        {lines.map((line) => {
          const id = `qty-${line.lineId}`;
          const error = errors.includes(`qty:${line.lineId}`) ? text.qtyTooLow : undefined;
          const help = text.qtyNow
            .replace('{qty}', String(line.current))
            .replace('{unit}', line.unitName);
          return (
            <Field
              key={line.lineId}
              id={id}
              label={line.testName}
              help={help}
              {...(error === undefined ? {} : { error })}
            >
              <Input
                {...fieldProps(id, { help, ...(error === undefined ? {} : { error }) })}
                name={`qty:${line.lineId}`}
                inputMode="decimal"
                defaultValue={state.values?.[`qty:${line.lineId}`] ?? ''}
              />
            </Field>
          );
        })}
      </fieldset>
      <Field
        id="counter-message"
        label={text.messageLabel}
        help={text.counterMessageHelp}
        required
        {...(messageError === undefined ? {} : { error: messageError })}
      >
        <Textarea
          {...fieldProps('counter-message', {
            help: text.counterMessageHelp,
            required: true,
            ...(messageError === undefined ? {} : { error: messageError }),
          })}
          name="message"
          required
          maxLength={2000}
          defaultValue={state.values?.message ?? ''}
        />
      </Field>
      <Actions
        text={text}
        pending={pending}
        confirm={text.counterConfirm}
        busy={text.countering}
        cancelHref={common.cancelHref}
      />
    </form>
  );
}
