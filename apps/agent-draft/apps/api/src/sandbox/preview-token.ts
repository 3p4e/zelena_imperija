import { safeEqual } from '../lib/crypto.js';
import type { KeyVault } from '../credentials/vault.js';

export interface PreviewClaims {
  projectId: string;
  port: number;
  userId: string;
  exp: number;
}

/**
 * Previews are served under /preview/<token>/... with the token in the path, so
 * iframes and relative asset URLs work without the session cookie. Responses
 * carry `Content-Security-Policy: sandbox`, which gives agent-generated pages an
 * opaque origin: they cannot read the platform's cookies or call its API as the user.
 */
export function signPreviewToken(vault: KeyVault, claims: PreviewClaims): string {
  const payload = `v1.${claims.projectId}.${claims.port}.${claims.userId}.${claims.exp}`;
  return `${payload}.${vault.sign(payload)}`;
}

export function verifyPreviewToken(vault: KeyVault, token: string): PreviewClaims | null {
  const parts = token.split('.');
  if (parts.length !== 6 || parts[0] !== 'v1') return null;
  const [, projectId, portStr, userId, expStr, sig] = parts;
  if (!projectId || !portStr || !userId || !expStr || !sig) return null;
  const payload = parts.slice(0, 5).join('.');
  if (!safeEqual(vault.sign(payload), sig)) return null;
  const exp = Number(expStr);
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  return { projectId, port, userId, exp };
}
