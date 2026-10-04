import type { Db } from '../../db/client.js';
import type { SandboxManager } from '../../sandbox/manager.js';
import type { ToolRegistry } from '../registry.js';
import { fsTools } from './fs.js';
import { gitTools } from './git.js';
import { httpTools } from './http.js';
import { previewTools } from './preview.js';
import { shellTools } from './shell.js';

export function registerBuiltinTools(registry: ToolRegistry, sandbox: SandboxManager, db: Db): void {
  for (const t of [
    ...fsTools(sandbox),
    ...shellTools(sandbox, db),
    ...gitTools(sandbox),
    ...httpTools(sandbox),
    ...previewTools(sandbox, db),
  ]) {
    registry.register(t);
  }
}
