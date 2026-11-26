'use client';

import { useState } from 'react';

interface Props {
  defaultLat: string;
  defaultLng: string;
  labels: { use: string; set: string; clear: string; denied: string };
}

/**
 * "Use my location": asks the browser for the device position and puts it in hidden form fields.
 * The position is sent with this search only and never stored (MAPS_AND_GEOCODING §3).
 */
export function LocationPicker({ defaultLat, defaultLng, labels }: Props) {
  const [point, setPoint] = useState(
    defaultLat !== '' && defaultLng !== '' ? { lat: defaultLat, lng: defaultLng } : null,
  );
  const [denied, setDenied] = useState(false);

  const locate = (): void => {
    if (!('geolocation' in navigator)) {
      setDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDenied(false);
        setPoint({
          lat: position.coords.latitude.toFixed(5),
          lng: position.coords.longitude.toFixed(5),
        });
      },
      () => {
        setDenied(true);
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  };

  return (
    <div>
      <input type="hidden" name="lat" value={point?.lat ?? ''} />
      <input type="hidden" name="lng" value={point?.lng ?? ''} />
      {point === null ? (
        <button type="button" className="button button-secondary" onClick={locate}>
          {labels.use}
        </button>
      ) : (
        <p>
          {labels.set}{' '}
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setPoint(null);
            }}
          >
            {labels.clear}
          </button>
        </p>
      )}
      {denied && (
        <p className="muted" role="status">
          {labels.denied}
        </p>
      )}
    </div>
  );
}
