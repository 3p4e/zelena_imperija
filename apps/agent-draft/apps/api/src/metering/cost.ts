import type { Usage } from '@agent/providers';

export interface ModelPricing {
  inputPricePerMtok: string | number | null;
  outputPricePerMtok: string | number | null;
  cachedInputPricePerMtok: string | number | null;
}

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

/**
 * Estimated cost in USD. Provider-reported exact cost (OpenRouter) wins; otherwise
 * registry prices are used. Returns null when the registry has no price, so the
 * UI can say "unknown" rather than showing a fake zero.
 */
export function estimateCostUsd(usage: Usage, pricing: ModelPricing | null): number | null {
  if (usage.costUsd !== null) return usage.costUsd;
  if (!pricing) return null;
  const input = num(pricing.inputPricePerMtok);
  const output = num(pricing.outputPricePerMtok);
  if (input === null || output === null) return null;
  const cachedPrice = num(pricing.cachedInputPricePerMtok) ?? input;
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncached = Math.max(0, usage.inputTokens - cached);
  const cost = (uncached * input + cached * cachedPrice + usage.outputTokens * output) / 1_000_000;
  return Math.round(cost * 1e8) / 1e8;
}
