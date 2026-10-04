import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userKeys } from '../../src/db/schema/index.js';
import {
  adminClient,
  createMember,
  modelRef,
  newProject,
  providerId,
  startHarness,
  type Client,
  type Harness,
} from '../helpers/harness.js';

describe('D. own API key → connection test → requests use that key', () => {
  let h: Harness;
  let admin: Client;
  let member: Client;
  let openaiId: string;
  let gpt5: string;

  beforeAll(async () => {
    h = await startHarness('wf_d');
    admin = await adminClient(h);
    member = (await createMember(h, admin, 'dana@test.local')).client;
    openaiId = await providerId(member, 'openai');
    gpt5 = await modelRef(admin, 'openai', 'gpt-5');
  });
  afterAll(async () => h.close());

  it('stores the key encrypted, never returns it, validates it, and uses it', async () => {
    const plaintext = 'sk-member-own-key-abcd1234';
    const saved = await member.post<Record<string, unknown>>('/api/keys', {
      providerId: openaiId,
      label: 'personal',
      apiKey: plaintext,
    });
    expect(saved.status).toBe(201);
    expect(saved.body.last4).toBe('1234');
    expect(JSON.stringify(saved.body)).not.toContain(plaintext);
    expect(Object.keys(saved.body)).not.toContain('apiKey');

    const listed = await member.get('/api/keys');
    expect(JSON.stringify(listed.body)).not.toContain(plaintext);

    // At rest: ciphertext only.
    const row = await h.db.db.query.userKeys.findFirst({ where: eq(userKeys.id, saved.body.id as string) });
    expect(row?.ciphertext.includes(Buffer.from(plaintext))).toBe(false);
    expect(row?.ciphertext.length).toBeGreaterThan(plaintext.length);

    const test = await member.post<{ ok: boolean }>(`/api/keys/${saved.body.id as string}/test`);
    expect(test.body.ok).toBe(true);
    expect(h.factory.calls.at(-1)).toMatchObject({ kind: 'openai', apiKey: plaintext });

    // The member now sees OpenAI models as BYOK-capable.
    const models = await member.get<{ model: { id: string }; credentialModes: string[] }[]>('/api/models');
    expect(models.body.find((m) => m.model.id === gpt5)?.credentialModes).toEqual(['byok']);

    const { conversationId } = await newProject(member, 'BYOK');
    h.factory.script([{ kind: 'text', text: 'answered with your key' }]);
    const run = await member.sse(`/api/conversations/${conversationId}/messages`, {
      content: 'hi',
      modelId: gpt5,
      credentialMode: 'byok',
    });
    expect(run.events.some((e) => e.type === 'message_end' && e.status === 'complete')).toBe(true);
    expect(h.factory.lastRequest()).toMatchObject({ kind: 'openai', apiKey: plaintext, model: 'gpt-5' });

    const usage = await member.get<{ credentialSource: string; userId: string }[]>('/api/usage/records');
    expect(usage.body[0]?.credentialSource).toBe('byok');
  });

  it('marks a rejected key invalid and does not use it', async () => {
    const bad = await member.post<{ id: string }>('/api/keys', {
      providerId: openaiId,
      label: 'typo',
      apiKey: 'invalid-key-0000',
    });
    const test = await member.post<{ ok: boolean; message: string }>(`/api/keys/${bad.body.id}/test`);
    expect(test.body.ok).toBe(false);
    expect(test.body.message).toContain('rejected');
    const keys = await member.get<{ id: string; status: string }[]>('/api/keys');
    expect(keys.body.find((k) => k.id === bad.body.id)?.status).toBe('invalid');
  });

  it('revokes keys: ciphertext is destroyed and requests fail with a clear message', async () => {
    const keys = await member.get<{ id: string; status: string }[]>('/api/keys');
    for (const k of keys.body.filter((x) => x.status !== 'revoked'))
      expect((await member.del(`/api/keys/${k.id}`)).status).toBe(200);
    const after = await member.get<{ status: string }[]>('/api/keys');
    expect(after.body.every((k) => k.status === 'revoked')).toBe(true);
    const rows = await h.db.db.select().from(userKeys);
    for (const r of rows.filter((x) => x.status === 'revoked')) expect(r.ciphertext.length).toBe(0);

    const before = h.factory.requests.length;
    const { conversationId } = await newProject(member, 'No key');
    const run = await member.sse(`/api/conversations/${conversationId}/messages`, {
      content: 'hi',
      modelId: gpt5,
    });
    const end = run.events.find((e) => e.type === 'message_end');
    expect(end).toMatchObject({ status: 'error', errorCode: 'credential_missing' });
    expect(h.factory.requests.length).toBe(before);
  });

  it('surfaces a provider auth failure as a user-facing error', async () => {
    await member.post('/api/keys', { providerId: openaiId, label: 'wrong', apiKey: 'invalid-but-active' });
    const { conversationId } = await newProject(member, 'Bad key');
    const run = await member.sse(`/api/conversations/${conversationId}/messages`, {
      content: 'hi',
      modelId: gpt5,
    });
    const end = run.events.find((e) => e.type === 'message_end');
    expect(end).toMatchObject({ status: 'error', errorCode: 'provider_auth_failed' });
    expect(JSON.stringify(run.events)).not.toContain('invalid-but-active');
  });
});
