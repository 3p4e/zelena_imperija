import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../../src/db/client.js';
import { users } from '../../src/db/schema/index.js';
import { KeyVault } from '../../src/credentials/vault.js';
import { signPreviewToken, verifyPreviewToken } from '../../src/sandbox/preview-token.js';
import { freshDatabase } from '../helpers/db.js';

describe('KeyVault (envelope encryption)', () => {
  let db: DbHandle;
  let vault: KeyVault;
  let alice: string;
  let bob: string;
  const master = randomBytes(32).toString('base64');

  beforeAll(async () => {
    db = createDb(await freshDatabase('unit_vault'));
    vault = new KeyVault(db.db, master, 1);
    const rows = await db.db
      .insert(users)
      .values([
        { email: 'a@x', displayName: 'A' },
        { email: 'b@x', displayName: 'B' },
      ])
      .returning();
    alice = rows[0]?.id ?? '';
    bob = rows[1]?.id ?? '';
  });
  afterAll(async () => db.close());

  it('round-trips a secret and never stores plaintext', async () => {
    const sealed = await vault.sealForUser(alice, 'provider-key', 'sk-very-secret');
    expect(sealed.ciphertext.includes(Buffer.from('sk-very-secret'))).toBe(false);
    expect(await vault.openForUser(alice, 'provider-key', sealed)).toBe('sk-very-secret');
  });

  it('binds ciphertext to the user and purpose', async () => {
    const sealed = await vault.sealForUser(alice, 'provider-key', 'sk-alice');
    await expect(vault.openForUser(bob, 'provider-key', sealed)).rejects.toThrow();
    await expect(vault.openForUser(alice, 'other-purpose', sealed)).rejects.toThrow();
  });

  it('detects tampering', async () => {
    const sealed = await vault.sealForUser(alice, 'provider-key', 'sk-alice');
    const tampered = Buffer.from(sealed.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    await expect(vault.openForUser(alice, 'provider-key', { ciphertext: tampered, nonce: sealed.nonce })).rejects.toThrow();
  });

  it('decrypts with a fresh vault instance (keys survive restarts) but not with another master key', async () => {
    const sealed = await vault.sealForUser(alice, 'provider-key', 'persisted');
    expect(await new KeyVault(db.db, master, 1).openForUser(alice, 'provider-key', sealed)).toBe('persisted');
    const wrong = new KeyVault(db.db, randomBytes(32).toString('base64'), 1);
    await expect(wrong.openForUser(alice, 'provider-key', sealed)).rejects.toThrow();
  });

  it('rejects a malformed master key', () => {
    expect(() => new KeyVault(db.db, 'c2hvcnQ=', 1)).toThrow(/32 bytes/);
  });

  it('signs preview tokens that cannot be altered or reused after expiry', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signPreviewToken(vault, { projectId: alice, port: 8080, userId: bob, exp });
    expect(verifyPreviewToken(vault, token)).toEqual({ projectId: alice, port: 8080, userId: bob, exp });
    expect(verifyPreviewToken(vault, token.replace('.8080.', '.8081.'))).toBeNull();
    expect(verifyPreviewToken(vault, token.slice(0, -2) + 'xx')).toBeNull();
    const expired = signPreviewToken(vault, { projectId: alice, port: 8080, userId: bob, exp: 1 });
    expect(verifyPreviewToken(vault, expired)).toBeNull();
  });
});
