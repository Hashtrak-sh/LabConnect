'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { clearSearchLocation, setSearchLocation } from './search-location';

interface Props {
  /** Whether a location is saved for this browser (read on the server). */
  located: boolean;
  labels: { use: string; set: string; clear: string; denied: string };
}

/**
 * "Use my location": asks the browser for the device position and saves it, rounded, in a short-
 * lived cookie through a server action. It never goes into the page URL or onto the server
 * (CLAUDE.md §5, MAPS_AND_GEOCODING §3). The page re-renders to use it.
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

  const clear = (): void => {
    startTransition(async () => {
      await clearSearchLocation();
      router.refresh();
    });
  };

  return (
    <div>
      {located ? (
        <p>
          {labels.set}{' '}
          <button
            type="button"
            className="button button-secondary"
            onClick={clear}
            disabled={pending}
          >
            {labels.clear}
          </button>
        </p>
      ) : (
        <button
          type="button"
          className="button button-secondary"
          onClick={locate}
          disabled={pending}
        >
          {labels.use}
        </button>
      )}
      {denied && (
        <p className="muted" role="status">
          {labels.denied}
        </p>
      )}
    </div>
  );
}
