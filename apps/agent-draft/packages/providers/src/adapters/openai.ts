import type { ModelInfo, ProviderConfig } from '../types.js';
import { OpenAICompatibleProvider, type OAIModelsResponse } from './openai-compatible.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Model ids that are not chat models and must not appear in the registry. */
const NON_CHAT_PATTERNS = [
  /embedding/i,
  /whisper/i,
  /^tts/i,
  /dall-e/i,
  /moderation/i,
  /realtime/i,
  /audio/i,
  /transcribe/i,
  /image/i,
  /^davinci/i,
  /^babbage/i,
  /search/i,
  /sora/i,
];

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super({ ...config, kind: 'openai', baseUrl: config.baseUrl ?? DEFAULT_BASE_URL, includeUsageOption: true });
  }

  override async listModels(): Promise<ModelInfo[]> {
    const all = await super.listModels();
    return all.filter((m) => !NON_CHAT_PATTERNS.some((p) => p.test(m.modelId)));
  }

  protected override mapModel(m: OAIModelsResponse['data'][number]): ModelInfo {
    const base = super.mapModel(m);
    const reasoning = /^(o\d|gpt-5)/i.test(m.id);
    return { ...base, supportsTools: true, supportsReasoning: reasoning };
  }
}
