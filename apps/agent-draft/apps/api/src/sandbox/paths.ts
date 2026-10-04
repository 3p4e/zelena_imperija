import path from 'node:path';
import { AppError } from '../lib/errors.js';

export const WORKSPACE = '/workspace';

/**
 * Maps a user/agent-supplied path to an absolute path inside /workspace.
 * Rejects anything that escapes the workspace. (Symlinks can only point inside
 * the container's own filesystem; the host is never mounted.)
 */
export function workspacePath(input: string, opts: { allowRoot?: boolean } = {}): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 1024 || input.includes('\0')) {
    throw new AppError('validation_failed', 'Invalid path.');
  }
  const rel = input.startsWith(WORKSPACE) ? input.slice(WORKSPACE.length) : input;
  const abs = path.posix.resolve(WORKSPACE, `.${rel.startsWith('/') ? rel : `/${rel}`}`);
  if (abs === WORKSPACE) {
    if (opts.allowRoot) return abs;
    throw new AppError('validation_failed', 'Path must point to a file or directory inside the project.');
  }
  if (!abs.startsWith(`${WORKSPACE}/`))
    throw new AppError('validation_failed', 'Path escapes the project workspace.');
  return abs;
}

export function relativeToWorkspace(abs: string): string {
  return abs === WORKSPACE ? '' : abs.slice(WORKSPACE.length + 1);
}
