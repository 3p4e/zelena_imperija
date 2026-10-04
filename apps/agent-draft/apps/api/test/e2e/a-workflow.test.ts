import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '@agent/shared';
import { adminClient, modelRef, newProject, providerId, startHarness, type Client, type Harness } from '../helpers/harness.js';

/**
 * Workflow A: create project → chat → agent creates files → runs them → preview works.
 * The model is mocked; the sandbox, tools, preview proxy and database are real.
 */
describe('A. project → chat → files → run → preview', () => {
  let h: Harness;
  let admin: Client;

  beforeAll(async () => {
    h = await startHarness('wf_a');
    admin = await adminClient(h);
    await admin.post('/api/keys', { providerId: await providerId(admin, 'anthropic'), apiKey: 'sk-ant-admin-key-0001' });
  });
  afterAll(async () => h.close());

  it('runs the full agent loop and serves the result through the preview proxy', async () => {
    const { projectId, conversationId } = await newProject(admin, 'Hello site');
    const claude = await modelRef(admin, 'anthropic', 'claude-sonnet-4-5');

    h.factory.script([
      {
        kind: 'tool_call',
        text: 'I will create the page first.',
        name: 'fs_write',
        arguments: { path: 'site/index.html', content: '<h1>Hello from the agent</h1>' },
      },
      { kind: 'tool_call', name: 'shell_exec', arguments: { command: 'cat site/index.html && python3 --version' } },
      { kind: 'tool_call', name: 'test_run', arguments: { command: 'test -f site/index.html && echo "# pass 1" && echo "# fail 0"' } },
      { kind: 'tool_call', name: 'preview_register', arguments: { port: 8080, label: 'site', command: 'cd site && python3 -m http.server 8080 --bind 0.0.0.0' } },
      { kind: 'text', text: 'The page is live in the preview panel.' },
    ]);

    const run = await admin.sse(`/api/conversations/${conversationId}/messages`, { content: 'Build a hello page and preview it', modelId: claude });
    expect(run.status).toBe(200);

    const results = run.events.filter((e): e is Extract<ChatStreamEvent, { type: 'tool_result' }> => e.type === 'tool_result');
    expect(results.map((r) => r.toolName)).toEqual(['fs_write', 'shell_exec', 'test_run', 'preview_register']);
    for (const r of results) expect(r.isError, `${r.toolName}: ${r.resultText}`).toBe(false);
    expect(results[1]?.resultText).toContain('Hello from the agent');
    expect(results[1]?.resultText).toContain('Python 3');
    expect(results[2]?.resultText).toContain('1 passed');
    expect(run.events.at(-1)).toEqual({ type: 'conversation_status', status: 'idle' });

    // Files exist in the sandbox and are visible through the file API.
    const files = await admin.get<{ entries: { path: string }[] }>(`/api/projects/${projectId}/files`);
    expect(files.body.entries.map((e) => e.path)).toContain('site/index.html');

    // The preview proxy serves the agent's server without the session cookie.
    const preview = await admin.get<{ url: string }>(`/api/projects/${projectId}/preview-url?port=8080`);
    expect(preview.status).toBe(200);
    const page = await fetch(`${h.baseUrl}${preview.body.url}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain('sandbox');
    expect(await page.text()).toContain('Hello from the agent');

    // History, execution log, test results and usage are persisted.
    const msgs = await admin.get<{ messages: { role: string; status: string }[] }>(`/api/conversations/${conversationId}/messages`);
    expect(msgs.body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
    const execs = await admin.get<{ command: string; exitCode: number | null }[]>(`/api/projects/${projectId}/executions`);
    expect(execs.body.some((e) => e.command.includes('cat site/index.html') && e.exitCode === 0)).toBe(true);
    const tests = await admin.get<{ passed: number; failed: number }[]>(`/api/projects/${projectId}/test-runs`);
    expect(tests.body[0]).toMatchObject({ passed: 1, failed: 0 });
    const usage = await admin.get<{ requests: number; inputTokens: number }>(`/api/usage/summary?projectId=${projectId}`);
    expect(usage.body.requests).toBe(5);
    expect(usage.body.inputTokens).toBe(500);

    // The model saw the tool results on later turns.
    const lastReq = h.factory.lastRequest();
    expect(JSON.stringify(lastReq?.messages)).toContain('Preview is live on port 8080');
  });
});
