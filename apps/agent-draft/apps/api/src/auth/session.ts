import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { loginAttempts, sessions, users } from '../db/schema/index.js';
import { hashToken, newToken } from '../lib/crypto.js';

export const SESSION_COOKIE = 'agent_session';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'member';
  status: 'active' | 'suspended';
  createdAt: Date;
  sessionId: string;
}

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly ttlHours: number,
  ) {}

  async create(
    userId: string,
    meta: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken(32);
    const expiresAt = new Date(Date.now() + this.ttlHours * 3600_000);
    await this.db.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt,
    });
    return { token, expiresAt };
  }

  async resolve(token: string): Promise<SessionUser | null> {
    const tokenHash = hashToken(token);
    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        lastSeenAt: sessions.lastSeenAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!row) return null;
    if (Date.now() - row.lastSeenAt.getTime() > 60_000) {
      await this.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.sessionId));
      await this.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, row.id));
    }
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      status: row.status,
      createdAt: row.createdAt,
      sessionId: row.sessionId,
    };
  }

  async destroy(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }

  async destroyAllForUser(userId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async purgeExpired(): Promise<void> {
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  }
}

/**
 * DB-backed login throttle; survives restarts. Failures are counted per email
 * (stops password guessing on one account) and per IP with a higher ceiling
 * (stops spraying many accounts) so one noisy IP cannot lock everyone out.
 */
export class LoginThrottle {
  static readonly IP_MULTIPLIER = 5;

  constructor(
    private readonly db: Db,
    private readonly max: number,
    private readonly windowMinutes: number,
  ) {}

  async isBlocked(subjects: string[]): Promise<boolean> {
    const since = new Date(Date.now() - this.windowMinutes * 60_000);
    for (const subject of subjects) {
      const limit = subject.startsWith('ip:') ? this.max * LoginThrottle.IP_MULTIPLIER : this.max;
      const [row] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(loginAttempts)
        .where(
          and(
            eq(loginAttempts.subject, subject),
            eq(loginAttempts.success, false),
            gt(loginAttempts.attemptedAt, since),
          ),
        );
      if ((row?.n ?? 0) >= limit) return true;
    }
    return false;
  }

  async record(subjects: string[], success: boolean): Promise<void> {
    if (subjects.length === 0) return;
    await this.db.insert(loginAttempts).values(subjects.map((subject) => ({ subject, success })));
    if (success) {
      // Only the account's own counter resets; an IP's failures stand until the window passes.
      for (const subject of subjects.filter((s) => !s.startsWith('ip:'))) {
        await this.db.delete(loginAttempts).where(eq(loginAttempts.subject, subject));
      }
    }
  }
}
