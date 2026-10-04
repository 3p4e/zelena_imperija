import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface Sealed {
  ciphertext: Buffer;
  nonce: Buffer;
}

/** AES-256-GCM; the auth tag is appended to the ciphertext. */
export function seal(key: Buffer, plaintext: Buffer, aad?: Buffer): Sealed {
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key, nonce);
  if (aad) cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce };
}

export function open(key: Buffer, sealed: Sealed, aad?: Buffer): Buffer {
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes');
  const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - TAG_BYTES);
  const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, sealed.nonce);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function parseMasterKey(base64: string): Buffer {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length !== 32)
    throw new Error('MASTER_KEY must decode to exactly 32 bytes (generate with: openssl rand -base64 32)');
  return buf;
}

export function newDataKey(): Buffer {
  return randomBytes(32);
}

/** Opaque token for sessions, invites and resets; only its hash is stored. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
