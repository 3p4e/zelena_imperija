import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminClient,
  modelRef,
  newProject,
  providerId,
  startHarness,
  type Client,
  type Harness,
} from '../helpers/harness.js';

/**
 * The seed ships the major providers. Hosted OpenAI-compatible ones (DeepSeek, xAI,
 * Mistral, Groq, …) share one adapter but differ by base URL, and each needs its
 * own key — they are not usable keyless the way a local server is.
 */
describe('K. major providers are seeded and reachable with the user’s own key', () => {
  let h: Harness;
  let admin: Client;

  beforeAll(async () => {
    h = await startHarness('wf_k');
    admin = await adminClient(h);
  });
  afterAll(async () => h.close());

  it('seeds every major provider and lists them in Settings', async () => {
    const provs = await admin.get<{ slug: string; displayName: string }[]>('/api/providers');
    const slugs = provs.body.map((p) => p.slug);
    for (const s of [
      'anthropic',
      'openai',
      'gemini',
      'openrouter',
      'deepseek',
      'xai',
      'mistral',
      'groq',
      'perplexity',
      'together',
      'fireworks',
    ]) {
      expect(slugs, s).toContain(s);
    }
  });

  it('a hosted compatible provider needs a key: no key → not offered, with key → BYOK through its base URL', async () => {
    const deepseek = await modelRef(admin, 'deepseek', 'deepseek-chat');

    // Admin has no DeepSeek key yet. The model is listed but with no payable mode —
    // unlike a keyless local server, a hosted provider cannot be used without a key.
    const before = await admin.get<{ model: { id: string }; credentialModes: string[] }[]>('/api/models');
    expect(before.body.find((o) => o.model.id === deepseek)?.credentialModes).toEqual([]);

    const key = 'sk-deepseek-user-key-9999';
    const saved = await admin.post<{ id: string }>('/api/keys', {
      providerId: await providerId(admin, 'deepseek'),
      apiKey: key,
    });
    expect(saved.status).toBe(201);

    // Testing a working key pulls the provider's live catalogue, so the picker shows every
    // model the provider actually offers — not just the seeded defaults.
    h.factory.setModels([
      {
        modelId: 'deepseek-chat',
        displayName: 'DeepSeek-V3',
        contextWindow: 64_000,
        maxOutput: 8_000,
        inputPricePerMtok: null,
        outputPricePerMtok: null,
        cachedInputPricePerMtok: null,
        supportsVision: false,
        supportsTools: true,
        supportsReasoning: false,
      },
      {
        modelId: 'deepseek-coder-v2',
        displayName: 'DeepSeek Coder V2',
        contextWindow: 128_000,
        maxOutput: 8_000,
        inputPricePerMtok: null,
        outputPricePerMtok: null,
        cachedInputPricePerMtok: null,
        supportsVision: false,
        supportsTools: true,
        supportsReasoning: false,
      },
    ]);
    const test = await admin.post<{ ok: boolean; modelsSeen: number | null }>(
      `/api/keys/${saved.body.id}/test`,
    );
    expect(test.body.ok).toBe(true);
    const catalogue = await admin.get<{ providerSlug: string; modelId: string }[]>('/api/admin/models');
    const deepseekIds = catalogue.body.filter((x) => x.providerSlug === 'deepseek').map((x) => x.modelId);
    expect(deepseekIds).toContain('deepseek-coder-v2'); // newly fetched from the provider
    expect(deepseekIds).toContain('deepseek-reasoner'); // seeded models are not retired by an auto-sync
    h.factory.setModels(undefined);

    const after = await admin.get<{ model: { id: string }; credentialModes: string[] }[]>('/api/models');
    expect(after.body.find((o) => o.model.id === deepseek)?.credentialModes).toEqual(['byok']);

    const { conversationId } = await newProject(admin, 'DeepSeek');
    h.factory.script([{ kind: 'text', text: 'hello from deepseek' }]);
    const run = await admin.sse(`/api/conversations/${conversationId}/messages`, {
      content: 'hi',
      modelId: deepseek,
      credentialMode: 'byok',
    });
    expect(run.events.find((e) => e.type === 'message_end')).toMatchObject({ status: 'complete' });
    expect(h.factory.calls.at(-1)).toMatchObject({
      kind: 'openai_compatible',
      apiKey: key,
      baseUrl: 'https://api.deepseek.com/v1',
    });
  });
});
