import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import type { ChatStreamEvent } from '@agent/shared';
import { loadConfig, type AppConfig } from '../../src/config/env.js';
import { createDb, type DbHandle } from '../../src/db/client.js';
import { runSeed } from '../../src/db/seed.js';
import { createDocker } from '../../src/sandbox/docker.js';
import { buildDeps } from '../../src/container.js';
import { buildApp } from '../../src/app.js';
import type { AppDeps } from '../../src/deps.js';
import type { Mailer } from '../../src/lib/mailer.js';
import { freshDatabase } from './db.js';
import { ScriptedFactory } from './scripted-factory.js';

export const ADMIN = { email: 'admin@test.local', password: 'admin-password-1' };

export interface SentMail {
  to: string;
  subject: string;
  text: string;
}

export interface Harness {
  app: FastifyInstance;
  deps: AppDeps;
  db: DbHandle;
  config: AppConfig;
  baseUrl: string;
  factory: ScriptedFactory;
  mail: SentMail[];
  close: () => Promise<void>;
}

export async function startHarness(name: string, overrides: Record<string, string> = {}, listenPort = 0): Promise<Harness> {
  const url = await freshDatabase(name);
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    DATABASE_URL: url,
    MASTER_KEY: randomBytes(32).toString('base64'),
    PUBLIC_URL: 'http://localhost',
    REQUIRE_HTTPS: 'false',
    SANDBOX_PREFIX: `agent-test-${name}`,
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password,
    ...overrides,
  });
  const db = createDb(url);
  await runSeed(db.db, config);
  const log = pino({ level: 'warn' });
  const factory = new ScriptedFactory();
  const mail: SentMail[] = [];
  const mailer: Mailer = {
    configured: true,
    send: (to, subject, text) => {
      mail.push({ to, subject, text });
      return Promise.resolve();
    },
  };
  const docker = createDocker(config.DOCKER_HOST);
  const deps = await buildDeps({ config, db: db.db, log, docker, providerFactory: factory.create, mailer });
  const app = await buildApp(deps);
  await app.listen({ port: listenPort, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    app,
    deps,
    db,
    config,
    baseUrl: `http://127.0.0.1:${port}`,
    factory,
    mail,
    close: async () => {
      await app.close();
      await cleanupDocker(config.SANDBOX_PREFIX, docker);
      await deps.tools.mcp.closeAll();
      await db.close();
    },
  };
}

/** Removes every container, volume and network created under the test prefix. */
export async function cleanupDocker(prefix: string, docker = createDocker(process.env.DOCKER_HOST ?? 'unix:///var/run/docker.sock')): Promise<void> {
  const containers = await docker.listContainers({ all: true, filters: { name: [prefix] } });
  for (const c of containers) await docker.getContainer(c.Id).remove({ force: true }).catch(() => undefined);
  const { Volumes } = await docker.listVolumes({ filters: { name: [prefix] } });
  for (const v of Volumes) await docker.getVolume(v.Name).remove({ force: true }).catch(() => undefined);
  const networks = await docker.listNetworks({ filters: { name: [prefix] } });
  for (const n of networks) await docker.getNetwork(n.Id).remove().catch(() => undefined);
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

/** Minimal HTTP client with a cookie jar, JSON helpers and SSE collection. */
export class Client {
  private cookie: string | null = null;

  constructor(private readonly baseUrl: string) {}

  get authenticated(): boolean {
    return this.cookie !== null;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = /agent_session=([^;]*)/.exec(setCookie);
      if (m?.[1]) this.cookie = `agent_session=${m[1]}`;
      else if (setCookie.includes('agent_session=;')) this.cookie = null;
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed as T };
  }

  get = <T = unknown>(p: string): Promise<ApiResponse<T>> => this.request<T>('GET', p);
  post = <T = unknown>(p: string, b?: unknown): Promise<ApiResponse<T>> => this.request<T>('POST', p, b ?? {});
  put = <T = unknown>(p: string, b?: unknown): Promise<ApiResponse<T>> => this.request<T>('PUT', p, b ?? {});
  patch = <T = unknown>(p: string, b?: unknown): Promise<ApiResponse<T>> => this.request<T>('PATCH', p, b ?? {});
  del = <T = unknown>(p: string): Promise<ApiResponse<T>> => this.request<T>('DELETE', p);

  async login(email: string, password: string): Promise<ApiResponse> {
    return this.post('/api/auth/login', { email, password });
  }

  /** POSTs and collects SSE `data:` frames until the server ends the stream. */
  async sse(path: string, body: unknown): Promise<{ status: number; events: ChatStreamEvent[]; error: unknown }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.headers.get('content-type')?.includes('text/event-stream')) {
      return { status: res.status, events: [], error: await res.json().catch(() => null) };
    }
    const text = await res.text();
    const events = text
      .split('\n\n')
      .map((b) => b.split('\n').find((l) => l.startsWith('data: ')))
      .filter((l): l is string => !!l)
      .map((l) => JSON.parse(l.slice(6)) as ChatStreamEvent);
    return { status: res.status, events, error: null };
  }
}

/** Creates a member through the admin API and returns a logged-in client for them. */
export async function createMember(h: Harness, admin: Client, email: string): Promise<{ client: Client; id: string }> {
  const password = 'member-password-1';
  const res = await admin.post<{ id: string }>('/api/admin/users', { email, displayName: email.split('@')[0], role: 'member', password });
  if (res.status !== 201) throw new Error(`create member failed: ${res.status} ${JSON.stringify(res.body)}`);
  const client = new Client(h.baseUrl);
  const login = await client.login(email, password);
  if (login.status !== 200) throw new Error(`member login failed: ${login.status}`);
  return { client, id: res.body.id };
}

export async function adminClient(h: Harness): Promise<Client> {
  const c = new Client(h.baseUrl);
  const r = await c.login(ADMIN.email, ADMIN.password);
  if (r.status !== 200) throw new Error(`admin login failed: ${r.status}`);
  return c;
}

export async function modelRef(c: Client, providerSlug: string, modelId: string): Promise<string> {
  const r = await c.get<{ id: string; providerSlug: string; modelId: string }[]>('/api/admin/models');
  const m = r.body.find((x) => x.providerSlug === providerSlug && x.modelId === modelId);
  if (!m) throw new Error(`model ${providerSlug}/${modelId} not seeded`);
  return m.id;
}

export async function providerId(c: Client, slug: string): Promise<string> {
  const r = await c.get<{ id: string; slug: string }[]>('/api/providers');
  const p = r.body.find((x) => x.slug === slug);
  if (!p) throw new Error(`provider ${slug} missing`);
  return p.id;
}

export async function newProject(c: Client, name: string): Promise<{ projectId: string; conversationId: string }> {
  const p = await c.post<{ id: string }>('/api/projects', { name });
  if (p.status !== 201) throw new Error(`project create failed ${p.status} ${JSON.stringify(p.body)}`);
  const convs = await c.get<{ id: string }[]>(`/api/projects/${p.body.id}/conversations`);
  const conv = convs.body[0];
  if (!conv) throw new Error('no default conversation');
  return { projectId: p.body.id, conversationId: conv.id };
}
