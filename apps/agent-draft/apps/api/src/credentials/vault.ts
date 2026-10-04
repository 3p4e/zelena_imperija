import { createHmac, hkdfSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { userDeks } from '../db/schema/index.js';
import { newDataKey, open, parseMasterKey, seal, type Sealed } from '../lib/crypto.js';

export interface SealedSecret extends Sealed {
  keyVersion: number;
}

/**
 * Envelope encryption. Each user has a random data-encryption key (DEK),
 * wrapped by the master key from the environment. Secrets are sealed with the
 * DEK and bound to (userId, purpose) through AES-GCM associated data, so a
 * ciphertext copied to another user's row fails to decrypt.
 *
 * Plaintext secrets exist only in memory for the duration of a provider call.
 */
export class KeyVault {
  private readonly master: Buffer;
  private readonly masterVersion: number;
  private readonly dekCache = new Map<string, Buffer>();
  private readonly previewKey: Buffer;

  constructor(
    private readonly db: Db,
    masterKeyBase64: string,
    masterVersion: number,
  ) {
    this.master = parseMasterKey(masterKeyBase64);
    this.masterVersion = masterVersion;
    this.previewKey = Buffer.from(hkdfSync('sha256', this.master, Buffer.alloc(0), 'preview-token-v1', 32));
  }

  private async dekFor(userId: string): Promise<Buffer> {
    const cached = this.dekCache.get(userId);
    if (cached) return cached;
    const row = await this.db.query.userDeks.findFirst({ where: eq(userDeks.userId, userId) });
    if (row) {
      const dek = open(this.master, { ciphertext: row.wrappedDek, nonce: row.nonce }, Buffer.from(`dek:${userId}`));
      this.dekCache.set(userId, dek);
      return dek;
    }
    const dek = newDataKey();
    const wrapped = seal(this.master, dek, Buffer.from(`dek:${userId}`));
    await this.db
      .insert(userDeks)
      .values({ userId, wrappedDek: wrapped.ciphertext, nonce: wrapped.nonce, masterKeyVersion: this.masterVersion })
      .onConflictDoNothing();
    // Re-read in case a concurrent request won the insert race.
    const winner = await this.db.query.userDeks.findFirst({ where: eq(userDeks.userId, userId) });
    if (!winner) throw new Error('failed to persist data key');
    const final = open(this.master, { ciphertext: winner.wrappedDek, nonce: winner.nonce }, Buffer.from(`dek:${userId}`));
    this.dekCache.set(userId, final);
    return final;
  }

  async sealForUser(userId: string, purpose: string, plaintext: string): Promise<SealedSecret> {
    const dek = await this.dekFor(userId);
    const sealed = seal(dek, Buffer.from(plaintext, 'utf8'), Buffer.from(`${purpose}:${userId}`));
    return { ...sealed, keyVersion: this.masterVersion };
  }

  async openForUser(userId: string, purpose: string, sealed: Sealed): Promise<string> {
    const dek = await this.dekFor(userId);
    return open(dek, sealed, Buffer.from(`${purpose}:${userId}`)).toString('utf8');
  }

  /** For system-owned secrets (global MCP server env). */
  sealGlobal(purpose: string, plaintext: string): Sealed {
    return seal(this.master, Buffer.from(plaintext, 'utf8'), Buffer.from(`global:${purpose}`));
  }

  openGlobal(purpose: string, sealed: Sealed): string {
    return open(this.master, sealed, Buffer.from(`global:${purpose}`)).toString('utf8');
  }

  /** HMAC for short-lived signed tokens (preview URLs). */
  sign(payload: string): string {
    return createHmac('sha256', this.previewKey).update(payload).digest('base64url');
  }
}

export function last4(secret: string): string {
  return secret.length <= 4 ? '****' : secret.slice(-4);
}
