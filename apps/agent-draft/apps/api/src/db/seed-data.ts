import type { ProviderCategory, ProviderKind, UpsertModel } from '@agent/shared';

export interface SeedProvider {
  kind: ProviderKind;
  slug: string;
  displayName: string;
  /** Required for `openai_compatible` providers; the vendor's OpenAI-style endpoint. */
  baseUrl?: string;
  /** False only for keyless local servers (e.g. Ollama). Hosted providers need a key. */
  requiresKey?: boolean;
  /** Grouping in the UI: featured, cloud or local. */
  category?: ProviderCategory;
  models: UpsertModel[];
}

/**
 * Seed registry of the major providers. Prices are USD per million tokens and
 * are only a starting point: the admin can edit any row, and `refresh` pulls the
 * vendor's live model list (with null prices where the API does not publish them).
 *
 * Most vendors expose an OpenAI-compatible endpoint, so they share one adapter
 * (`openai_compatible`) and differ only by `baseUrl`. Each still needs the user's
 * own API key for that vendor (BYOK) or an admin-shared key.
 */
export const SEED_PROVIDERS: SeedProvider[] = [
  {
    kind: 'anthropic',
    slug: 'anthropic',
    category: 'featured',
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
    category: 'featured',
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
    category: 'featured',
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
    category: 'featured',
    displayName: 'OpenRouter',
    // OpenRouter is a gateway to every model; its list is populated on first refresh.
    models: [],
  },
  {
    kind: 'openai_compatible',
    slug: 'deepseek',
    category: 'cloud',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    // Defaults only; saving a key refreshes this from DeepSeek's live model list.
    models: [
      m('deepseek-chat', 'DeepSeek (chat)', 128_000, 8_000, 0.27, 1.1, 0.07),
      m('deepseek-reasoner', 'DeepSeek (reasoner)', 128_000, 8_000, 0.55, 2.19, 0.14, {
        reasoning: true,
      }),
    ],
  },
  {
    kind: 'openai_compatible',
    slug: 'xai',
    category: 'cloud',
    displayName: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    models: [
      m('grok-2-latest', 'Grok 2', 131_072, 32_768, 2, 10, null),
      m('grok-2-vision-latest', 'Grok 2 Vision', 32_768, 8_192, 2, 10, null, { vision: true }),
    ],
  },
  {
    kind: 'openai_compatible',
    slug: 'mistral',
    category: 'cloud',
    displayName: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: [
      m('mistral-large-latest', 'Mistral Large', 131_072, 32_768, 2, 6, null),
      m('mistral-small-latest', 'Mistral Small', 131_072, 32_768, 0.2, 0.6, null),
      m('codestral-latest', 'Codestral', 262_144, 32_768, 0.3, 0.9, null),
    ],
  },
  {
    kind: 'openai_compatible',
    slug: 'groq',
    category: 'cloud',
    displayName: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      m('llama-3.3-70b-versatile', 'Llama 3.3 70B', 131_072, 32_768, 0.59, 0.79, null),
      m('llama-3.1-8b-instant', 'Llama 3.1 8B', 131_072, 8_192, 0.05, 0.08, null),
    ],
  },
  {
    kind: 'openai_compatible',
    slug: 'perplexity',
    category: 'cloud',
    displayName: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
    models: [
      m('sonar', 'Sonar', 127_072, 8_000, 1, 1, null),
      m('sonar-pro', 'Sonar Pro', 200_000, 8_000, 3, 15, null),
    ],
  },
  {
    kind: 'openai_compatible',
    slug: 'together',
    category: 'cloud',
    displayName: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    // Large open-model catalog; populated on first refresh.
    models: [],
  },
  {
    kind: 'openai_compatible',
    slug: 'fireworks',
    category: 'cloud',
    displayName: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    // Large open-model catalog; populated on first refresh.
    models: [],
  },
  {
    kind: 'openai_compatible',
    slug: 'cerebras',
    category: 'cloud',
    displayName: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    models: [
      m('llama-3.3-70b', 'Llama 3.3 70B', 128_000, 8_000, null, null, null),
      m('qwen-3-235b-a22b-instruct-2507', 'Qwen3 235B', 128_000, 32_000, null, null, null),
    ],
  },
  {
    kind: 'openai_compatible',
    slug: 'moonshot',
    category: 'cloud',
    displayName: 'Moonshot AI (Kimi)',
    baseUrl: 'https://api.moonshot.ai/v1',
    models: [m('kimi-k2-0905-preview', 'Kimi K2', 256_000, 32_000, null, null, null)],
  },
  {
    kind: 'openai_compatible',
    slug: 'zai',
    category: 'cloud',
    displayName: 'Z.ai (GLM)',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    models: [m('glm-4.6', 'GLM-4.6', 200_000, 32_000, null, null, null, { reasoning: true })],
  },
  {
    kind: 'openai_compatible',
    slug: 'nvidia',
    category: 'cloud',
    displayName: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    // Free hosted catalogue (Nemotron, GPT-OSS, DeepSeek, …); populated on first refresh.
    models: [],
  },
  {
    kind: 'openai_compatible',
    slug: 'alibaba',
    category: 'cloud',
    displayName: 'Alibaba Cloud (Qwen)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: [
      m('qwen-max', 'Qwen Max', 32_000, 8_000, null, null, null),
      m('qwen-plus', 'Qwen Plus', 131_000, 8_000, null, null, null),
    ],
  },
  {
    kind: 'openai_compatible',
    slug: 'ollama',
    category: 'local',
    displayName: 'Ollama',
    requiresKey: false,
    // Local server; the admin sets the reachable base URL (e.g. http://host.docker.internal:11434/v1).
    baseUrl: 'http://localhost:11434/v1',
    models: [],
  },
  {
    kind: 'openai_compatible',
    slug: 'lmstudio',
    category: 'local',
    displayName: 'LM Studio',
    requiresKey: false,
    baseUrl: 'http://localhost:1234/v1',
    models: [],
  },
  {
    kind: 'openai_compatible',
    slug: 'localai',
    category: 'local',
    displayName: 'LocalAI',
    requiresKey: false,
    baseUrl: 'http://localhost:8080/v1',
    models: [],
  },
];

function m(
  modelId: string,
  displayName: string,
  contextWindow: number,
  maxOutput: number,
  input: number | null,
  output: number | null,
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

export const PRIMARY_AGENT_SYSTEM_PROMPT = `You are ANVIL, the coding agent of a self-hosted AI software-engineering workspace of the same name.
If asked what you are or what this platform is, say: ANVIL is a private, self-hosted platform where a user describes software and you build it for them inside an isolated per-project Docker sandbox, with a live preview and a full terminal. Each project is isolated; the user brings their own model API keys.

You work as a senior software engineer inside an isolated Linux sandbox for the user's project.
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
