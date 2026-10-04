import type { ChatRequest, ModelInfo, ProviderConfig } from '../types.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number | null;
  pricing: { prompt: string; completion: string; input_cache_read?: string };
  architecture?: { input_modalities?: string[]; modality?: string };
  supported_parameters?: string[];
  top_provider?: { max_completion_tokens?: number | null };
}

/**
 * OpenRouter speaks Chat Completions and additionally reports exact cost per
 * request (`usage.cost`) and full pricing in `/models`, so the registry can use
 * real numbers instead of seeded estimates.
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super({
      ...config,
      kind: 'openrouter',
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      includeUsageOption: true,
      extraHeaders: { 'x-title': 'Self-hosted agent platform' },
      extraBody: { usage: { include: true } },
    });
  }

  override async listModels(): Promise<ModelInfo[]> {
    const res = await this.http.json<{ data: OpenRouterModel[] }>(`${this.baseUrl}/models`, {
      method: 'GET',
      headers: this.headers(),
    });
    return res.data.map((m) => {
      const params = m.supported_parameters ?? [];
      const inputs = m.architecture?.input_modalities ?? [];
      return {
        modelId: m.id,
        displayName: m.name,
        contextWindow: m.context_length,
        maxOutput: m.top_provider?.max_completion_tokens ?? null,
        inputPricePerMtok: perMtok(m.pricing.prompt),
        outputPricePerMtok: perMtok(m.pricing.completion),
        cachedInputPricePerMtok: m.pricing.input_cache_read ? perMtok(m.pricing.input_cache_read) : null,
        supportsVision: inputs.includes('image'),
        supportsTools: params.includes('tools'),
        supportsReasoning: params.includes('reasoning') || params.includes('include_reasoning'),
      };
    });
  }

  protected override buildBody(request: ChatRequest): Record<string, unknown> {
    const body = super.buildBody(request);
    if (request.reasoningEffort) {
      delete body.reasoning_effort;
      body.reasoning = { effort: request.reasoningEffort };
    }
    return body;
  }
}

/** OpenRouter prices are USD per token as strings; convert to USD per million tokens. */
function perMtok(perToken: string): number | null {
  const n = Number(perToken);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 1_000_000) / 1_000_000;
}
