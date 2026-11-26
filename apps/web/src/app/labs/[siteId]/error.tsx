'use client';

import { Button, StatePanel } from '@labconnect/ui';
import messages from '../../../../messages/en.json';

/** The lab page failed for a reason other than "not found" (the API is down, a 5xx). */
export default function LabError({ reset }: { reset: () => void }) {
  return (
    <StatePanel
      kind="error"
      title={messages.lab.errorTitle}
      action={
        <Button type="button" variant="secondary" onClick={reset}>
          {messages.search.tryAgain}
        </Button>
      }
    >
      {messages.lab.errorText}
    </StatePanel>
  );
}
