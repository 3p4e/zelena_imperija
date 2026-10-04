/**
 * Backend for the browser test (apps/web/e2e). Real API, Postgres and Docker
 * sandbox; only the model is scripted. Not used in production.
 */
import { startHarness } from '../helpers/harness.js';

const port = Number(process.env.UI_API_PORT ?? 4300);
const h = await startHarness('ui', {}, port);
h.factory.chunkDelayMs = 15;
h.factory.script([
  {
    kind: 'tool_call',
    text: 'I will **create the page** first.',
    name: 'fs_write',
    arguments: { path: 'site/index.html', content: '<h1>Hello from the UI test</h1>' },
  },
  { kind: 'tool_call', name: 'shell_exec', arguments: { command: 'ls -la site && cat site/index.html' } },
  { kind: 'tool_call', name: 'preview_register', arguments: { port: 8090, label: 'site', command: 'cd site && python3 -m http.server 8090 --bind 0.0.0.0' } },
  { kind: 'text', text: 'Done. The page is in the **Preview** tab.\n\n```python\nprint("highlighted")\n```' },
]);
process.stdout.write(`ui test api listening on ${h.baseUrl}\n`);

const shutdown = (): void => {
  void h.close().finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
