import argon2 from 'argon2';

const OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } satisfies argon2.HashOptions;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (!hash) {
    // Burn comparable time so missing-password accounts are not distinguishable by latency.
    await argon2.hash(password, OPTIONS);
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
