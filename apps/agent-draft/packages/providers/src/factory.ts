import type { ProviderKind } from '@agent/shared';
import { AnthropicProvider } from './adapters/anthropic.js';
import { GeminiProvider } from './adapters/gemini.js';
import { OpenAICompatibleProvider } from './adapters/openai-compatible.js';
import { OpenAIProvider } from './adapters/openai.js';
import { OpenRouterProvider } from './adapters/openrouter.js';
import type { AIProvider, ProviderConfig } from './types.js';

export type ProviderFactory = (kind: ProviderKind, config: ProviderConfig) => AIProvider;

/** The only place that maps a provider kind to an adapter class. */
export const createProvider: ProviderFactory = (kind, config) => {
  switch (kind) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'openai_compatible':
      return new OpenAICompatibleProvider({ ...config, kind: 'openai_compatible' });
  }
};

/** Whether the kind requires an API key to function (local servers often do not). */
export function kindRequiresApiKey(kind: ProviderKind): boolean {
  return kind !== 'openai_compatible';
}
