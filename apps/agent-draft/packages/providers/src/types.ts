import type { ProviderKind } from '@agent/shared';

/** JSON Schema object describing a tool's input. Kept opaque; validated by the tool registry. */
export type JsonSchema = Record<string, unknown>;

export interface TextPart {
  type: 'text';
  text: string;
}
export interface ImagePart {
  type: 'image';
  mimeType: string;
  /** base64-encoded bytes */
  data: string;
}
export interface ToolCallPart {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: unknown;
}
export interface ToolResultPart {
  type: 'tool_result';
  toolCallId: string;
  content: string;
  isError: boolean;
}
export interface ReasoningPart {
  type: 'reasoning';
  text: string;
}
export type ContentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart | ReasoningPart;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ContentPart[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface StructuredOutputSpec {
  name: string;
  schema: JsonSchema;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  maxOutputTokens?: number;
  temperature?: number;
  /** When set, the provider must return a single JSON object matching the schema as the text content. */
  structuredOutput?: StructuredOutputSpec;
  reasoningEffort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  /** Per-request timeout for the first byte / inactivity, ms. */
  timeoutMs?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number | null;
  /** Exact cost when the provider reports it (OpenRouter); otherwise null and the registry estimates. */
  costUsd: number | null;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argumentsDelta: string }
  | { type: 'tool_call_end'; id: string; name: string; arguments: unknown }
  | { type: 'usage'; usage: Usage }
  | { type: 'finish'; reason: FinishReason };

export interface ChatResponse {
  content: ContentPart[];
  usage: Usage;
  finishReason: FinishReason;
}

export interface ModelInfo {
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutput: number | null;
  inputPricePerMtok: number | null;
  outputPricePerMtok: number | null;
  cachedInputPricePerMtok: number | null;
  supportsVision: boolean | null;
  supportsTools: boolean | null;
  supportsReasoning: boolean | null;
}

export interface CredentialCheck {
  ok: boolean;
  message: string;
  modelsSeen: number | null;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string | undefined;
  /** Injected for tests; defaults to globalThis.fetch. */
  fetch?: typeof fetch | undefined;
  /** Default per-request timeout, ms. */
  timeoutMs?: number | undefined;
}

/**
 * The single provider contract. Nothing outside `packages/providers` may contain
 * vendor-specific request or response shapes.
 */
export interface AIProvider {
  readonly kind: ProviderKind;
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamEvent>;
  listModels(): Promise<ModelInfo[]>;
  validateCredential(): Promise<CredentialCheck>;
}
