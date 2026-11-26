import type { GeoPoint } from '@labconnect/core';

/**
 * Turns a pincode into the point the search measures from (its centroid, `searchLabs`). The
 * search in packages/core takes `lat` and `lng` only, so resolving the pincode is the API's job
 * (OQ-153).
 */
export abstract class PincodeLocator {
  /** The centroid, or `null` when the pincode is not known. */
  abstract locate(pincode: string): Promise<GeoPoint | null>;
}

/**
 * The locator until a pincode dataset exists (OQ-153: no dataset or centroid table, its licence
 * is open under OQ-17). It knows no pincode, so every pincode search is answered with the
 * contract's "the pincode is unknown" (422 `VALIDATION_FAILED`) rather than with a guessed
 * location. Replace the provider when the dataset lands.
 */
export class UnavailablePincodeLocator extends PincodeLocator {
  locate(): Promise<GeoPoint | null> {
    return Promise.resolve(null);
  }
}
