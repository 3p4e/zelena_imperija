import { and, eq } from 'drizzle-orm';
import type { CredentialMode } from '@agent/shared';
import type { Db } from '../../db/client.js';
import { conversations, projectShares, projects } from '../../db/schema/index.js';
import type { SessionUser } from '../../auth/session.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { requireUuid } from '../../lib/validate.js';

export type Need = 'read' | 'edit' | 'owner';
export type Permission = 'owner' | 'read' | 'edit';

export interface ProjectAccess {
  project: typeof projects.$inferSelect;
  permission: Permission;
}

/**
 * The single ownership check for project-scoped resources. A project is visible
 * only to its owner and to users it is explicitly shared with. Unrelated users,
 * the admin included, get 404 so existence does not leak.
 */
export async function projectFor(
  db: Db,
  user: SessionUser,
  projectId: unknown,
  need: Need,
): Promise<ProjectAccess> {
  const id = requireUuid(projectId, 'project id');
  const project = await db.query.projects.findFirst({ where: eq(projects.id, id) });
  if (!project) throw notFound('Project');
  if (project.ownerUserId === user.id) return { project, permission: 'owner' };
  const share = await db.query.projectShares.findFirst({
    where: and(eq(projectShares.projectId, id), eq(projectShares.userId, user.id)),
  });
  if (!share) throw notFound('Project');
  if (need === 'owner') throw forbidden('Only the project owner can do this.');
  if (need === 'edit' && share.permission !== 'edit')
    throw forbidden('You have read-only access to this project.');
  return { project, permission: share.permission };
}

export async function conversationFor(
  db: Db,
  user: SessionUser,
  conversationId: unknown,
  need: Need,
): Promise<ProjectAccess & { conversation: typeof conversations.$inferSelect }> {
  const id = requireUuid(conversationId, 'conversation id');
  const conversation = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });
  if (!conversation) throw notFound('Conversation');
  try {
    const access = await projectFor(db, user, conversation.projectId, need);
    return { ...access, conversation };
  } catch (err) {
    if (err instanceof AppError && err.code === 'not_found') throw notFound('Conversation');
    throw err;
  }
}

/** Members can never select subscription CLI mode, wherever a selection is stored. */
export function assertModeAllowed(user: SessionUser, mode: CredentialMode | null | undefined): void {
  if (mode === 'subscription_cli' && user.role !== 'admin') {
    throw forbidden('Subscription CLI mode is available to the admin only.');
  }
}
