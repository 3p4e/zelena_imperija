import type { ProviderKind, UpsertModel } from '@agent/shared';

export interface SeedProvider {
  kind: ProviderKind;
  slug: string;
  displayName: string;
  models: UpsertModel[];
}

/**
 * Seed registry. Prices are USD per million tokens and are only a starting
 * point: the admin can edit any row, and `refresh` adds newly published model
 * ids (with null prices where the vendor API does not publish them).
 */
export const SEED_PROVIDERS: SeedProvider[] = [
  {
    kind: 'anthropic',
    slug: 'anthropic',
    displayName: 'Anthropic',
    models: [
      m('claude-sonnet-4-5', 'Claude Sonnet 4.5', 200_000, 64_000, 3, 15, 0.3, {
        vision: true,
        reasoning: true,
      }),
      m('claude-opus-4-1', 'Claude Opus 4.1', 200_000, 32_000, 15, 75, 1.5, {
        vision: true,
        reasoning: true,
      }),
      m('claude-haiku-4-5', 'Claude Haiku 4.5', 200_000, 64_000, 1, 5, 0.1, {
        vision: true,
        reasoning: true,
      }),
    ],
  },
  {
    kind: 'openai',
    slug: 'openai',
    displayName: 'OpenAI',
    models: [
      m('gpt-5', 'GPT-5', 400_000, 128_000, 1.25, 10, 0.125, { vision: true, reasoning: true }),
      m('gpt-5-mini', 'GPT-5 mini', 400_000, 128_000, 0.25, 2, 0.025, { vision: true, reasoning: true }),
      m('gpt-4.1', 'GPT-4.1', 1_047_576, 32_768, 2, 8, 0.5, { vision: true }),
    ],
  },
  {
    kind: 'gemini',
    slug: 'gemini',
    displayName: 'Google Gemini',
    models: [
      m('gemini-2.5-pro', 'Gemini 2.5 Pro', 1_048_576, 65_536, 1.25, 10, 0.31, {
        vision: true,
        reasoning: true,
      }),
      m('gemini-2.5-flash', 'Gemini 2.5 Flash', 1_048_576, 65_536, 0.3, 2.5, 0.075, {
        vision: true,
        reasoning: true,
      }),
    ],
  },
  {
    kind: 'openrouter',
    slug: 'openrouter',
    displayName: 'OpenRouter',
    // OpenRouter publishes exact pricing; the list is populated on first refresh.
    models: [],
  },
];

function m(
  modelId: string,
  displayName: string,
  contextWindow: number,
  maxOutput: number,
  input: number,
  output: number,
  cached: number | null,
  caps: { vision?: boolean; reasoning?: boolean } = {},
): UpsertModel {
  return {
    modelId,
    displayName,
    contextWindow,
    maxOutput,
    inputPricePerMtok: input,
    outputPricePerMtok: output,
    cachedInputPricePerMtok: cached,
    supportsVision: caps.vision ?? false,
    supportsTools: true,
    supportsReasoning: caps.reasoning ?? false,
    supportsStructuredOutput: true,
    available: true,
  };
}

export const PRIMARY_AGENT_SLUG = 'coder';

export const PRIMARY_AGENT_SYSTEM_PROMPT = `You are a senior software engineer working inside an isolated Linux sandbox for the user's project.
The project files live in /workspace. You have tools to read, write and patch files, run shell commands, use git, fetch URLs and register preview ports.

Working method:
1. Understand the request. If it is ambiguous in a way that changes the result, ask one precise question; otherwise proceed.
2. Plan briefly in one short paragraph, then act. Prefer small, verifiable steps.
3. Create or edit files with the file tools, never by echoing into the shell.
4. Run the code with shell_exec and tests with test_run. Read the output. Fix failures before declaring success.
5. When the project serves HTTP, start it bound to 0.0.0.0 and call preview_register with the port so the user can see it.
6. Finish with a short summary of what changed, how you verified it, and what is left.

Rules: never claim something works that you did not run. Keep commands non-interactive. Do not attempt to reach the host machine or other containers.`;

/**
 * Tools granted to the seeded primary agent. `mcp__*` grants every MCP tool the admin
 * configures; members still need an explicit per-tool allow from the admin.
 */
export const PRIMARY_AGENT_TOOLS = [
  'fs_list',
  'fs_read',
  'fs_write',
  'fs_patch',
  'fs_delete',
  'shell_exec',
  'test_run',
  'git_status',
  'git_commit',
  'git_diff',
  'git_log',
  'http_fetch',
  'preview_register',
  'mcp__*',
] as const;
