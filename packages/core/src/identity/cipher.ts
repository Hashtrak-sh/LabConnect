import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypts small secrets (the TOTP secret) before they are stored.
 *
 * The interface is shaped for envelope encryption (SECURITY_AND_PRIVACY.md section 2): it is
 * asynchronous, so an adapter may call a key service, and the stored value is an opaque blob
 * that the adapter owns, so it may hold a wrapped data key next to the ciphertext. `context`
 * is authenticated data: it ties a blob to the row it belongs to, so a blob copied to another
 * row does not decrypt. The KMS adapter arrives with task P3-11.
 */
export interface SecretCipher {
  encrypt(plaintext: Uint8Array, context: string): Promise<Uint8Array<ArrayBuffer>>;
  decrypt(blob: Uint8Array, context: string): Promise<Uint8Array<ArrayBuffer>>;
}

export class SecretCipherError extends Error {
  override name = 'SecretCipherError';
}

const VERSION_AES_GCM_LOCAL = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 2; // version, key id

/**
 * AES-256-GCM under a key from the environment. For local development and tests; deployed
 * environments use the KMS adapter. Blob layout: version (1 byte), key id (1 byte),
 * IV (12), authentication tag (16), ciphertext. The key id lets a later key rotate in.
 */
export class AesGcmSecretCipher implements SecretCipher {
  private readonly key: Uint8Array<ArrayBuffer>;

  constructor(
    key: Uint8Array,
    private readonly keyId: number = 1,
  ) {
    if (key.length !== 32) throw new Error('The encryption key must be exactly 32 bytes.');
    if (!Number.isInteger(keyId) || keyId < 0 || keyId > 255) {
      throw new RangeError('The key id must fit in one byte.');
    }
    this.key = Uint8Array.from(key);
  }

  encrypt(plaintext: Uint8Array, context: string): Promise<Uint8Array<ArrayBuffer>> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const blob = Buffer.concat([
      Buffer.from([VERSION_AES_GCM_LOCAL, this.keyId]),
      iv,
      cipher.getAuthTag(),
      body,
    ]);
    return Promise.resolve(Uint8Array.from(blob));
  }

  decrypt(blob: Uint8Array, context: string): Promise<Uint8Array<ArrayBuffer>> {
    try {
      if (blob.length < HEADER_BYTES + IV_BYTES + TAG_BYTES) {
        throw new SecretCipherError('The encrypted value is too short.');
      }
      if (blob[0] !== VERSION_AES_GCM_LOCAL || blob[1] !== this.keyId) {
        throw new SecretCipherError('The encrypted value was made with another key or format.');
      }
      const buffer = Buffer.from(blob);
      const iv = buffer.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
      const tag = buffer.subarray(HEADER_BYTES + IV_BYTES, HEADER_BYTES + IV_BYTES + TAG_BYTES);
      const body = buffer.subarray(HEADER_BYTES + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);
      return Promise.resolve(
        Uint8Array.from(Buffer.concat([decipher.update(body), decipher.final()])),
      );
    } catch (error) {
      if (error instanceof SecretCipherError) return Promise.reject(error);
      // Node's message names the failed check only; the cause is kept for the server log.
      return Promise.reject(
        new SecretCipherError('The encrypted value could not be decrypted.', { cause: error }),
      );
    }
  }
}
