'use client';

import { Button } from '@labconnect/ui';
import { LocateFixed } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { clearSearchLocation, setSearchLocation } from './search-location';

interface Props {
  /** Whether a location is saved for this browser (read on the server). */
  located: boolean;
  labels: { use: string; set: string; clear: string; denied: string };
}

/**
 * "Use my location" (H1): asks the browser for the device position and saves it, rounded to
 * about 100 m, in a short-lived cookie through a server action. It never goes into a URL or onto
 * the server (CLAUDE.md §5, MAPS_AND_GEOCODING §3). The page re-renders to use it. A refusal shows
 * the H1 "Device location denied" note.
 */
export function LocationPicker({ located, labels }: Props) {
  const router = useRouter();
  const [denied, setDenied] = useState(false);
  const [pending, startTransition] = useTransition();

  const locate = (): void => {
    if (!('geolocation' in navigator)) {
      setDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        startTransition(async () => {
          const saved = await setSearchLocation(
            position.coords.latitude,
            position.coords.longitude,
          );
          setDenied(!saved);
          router.refresh();
        });
      },
      () => {
        setDenied(true);
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {located ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-text">
          <LocateFixed aria-hidden="true" className="size-4 text-brand-primary" />
          {labels.set}
          <Button
            type="button"
            variant="link"
            loading={pending}
            onClick={() => {
              startTransition(async () => {
                await clearSearchLocation();
                router.refresh();
              });
            }}
          >
            {labels.clear}
          </Button>
        </p>
      ) : (
        <Button type="button" variant="secondary" onClick={locate} loading={pending}>
          <LocateFixed aria-hidden="true" className="size-4" />
          {labels.use}
        </Button>
      )}
      {denied && (
        <p role="status" className="text-sm text-text-muted">
          {labels.denied}
        </p>
      )}
    </div>
  );
}
