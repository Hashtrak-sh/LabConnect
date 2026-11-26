'use client';

import { useActionState, useId } from 'react';
import { createLeadAction, type LeadState } from './lead-action';

interface Props {
  kind: 'REQUEST_LAB' | 'NO_RESULT';
  labSiteId?: string;
  /** For `NO_RESULT`: the search that found nothing, as API criteria (no location). */
  query?: Record<string, unknown>;
  text: {
    title: string;
    body: string;
    email: string;
    emailHint: string;
    submit: string;
    sent: string;
    failed: string;
  };
}

/** "Request this lab" / "Ask us to find a lab" (FR-DIS-07, AC-DIS-04). */
export function LeadForm({ kind, labSiteId, query, text }: Props) {
  const id = useId();
  const [state, action, pending] = useActionState<LeadState, FormData>(createLeadAction, {
    status: 'idle',
  });

  if (state.status === 'sent') {
    return (
      <section className="card" aria-live="polite">
        <p className="notice-success">{text.sent}</p>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{text.title}</h2>
      <p>{text.body}</p>
      <form action={action} className="form-grid">
        <input type="hidden" name="kind" value={kind} />
        {labSiteId !== undefined && <input type="hidden" name="labSiteId" value={labSiteId} />}
        {query !== undefined && <input type="hidden" name="query" value={JSON.stringify(query)} />}
        <div>
          <label htmlFor={`${id}-email`}>{text.email}</label>
          <input id={`${id}-email`} name="contactEmail" type="email" autoComplete="email" />
          <p className="muted">{text.emailHint}</p>
        </div>
        <div>
          <button type="submit" disabled={pending}>
            {text.submit}
          </button>
        </div>
      </form>
      {state.status === 'failed' && (
        <p className="notice-error" role="alert">
          {text.failed}
        </p>
      )}
    </section>
  );
}
