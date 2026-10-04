export const USER_ROLES = ['admin', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PROVIDER_KINDS = ['anthropic', 'openai', 'gemini', 'openrouter', 'openai_compatible'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const CREDENTIAL_MODES = ['byok', 'shared', 'subscription_cli'] as const;
export type CredentialMode = (typeof CREDENTIAL_MODES)[number];

export const CLI_KINDS = ['claude_code', 'codex', 'gemini_cli'] as const;
export type CliKind = (typeof CLI_KINDS)[number];

export const KEY_STATUSES = ['active', 'revoked', 'invalid'] as const;
export type KeyStatus = (typeof KEY_STATUSES)[number];

export const MODEL_SOURCES = ['seed', 'fetched', 'manual'] as const;
export type ModelSource = (typeof MODEL_SOURCES)[number];

export const SHARE_PERMISSIONS = ['read', 'edit'] as const;
export type SharePermission = (typeof SHARE_PERMISSIONS)[number];

export const PROJECT_STATUSES = ['active', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CONVERSATION_STATUSES = ['idle', 'running', 'stopped', 'error'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_ROLES = ['system', 'user', 'assistant', 'tool'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_STATUSES = ['streaming', 'complete', 'stopped', 'error'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const PART_KINDS = ['text', 'reasoning', 'tool_call', 'tool_result', 'error'] as const;
export type PartKind = (typeof PART_KINDS)[number];

export const SANDBOX_STATUSES = ['creating', 'running', 'stopped', 'failed', 'removed'] as const;
export type SandboxStatus = (typeof SANDBOX_STATUSES)[number];

export const EXECUTION_KINDS = ['shell', 'test', 'preview', 'git', 'fs'] as const;
export type ExecutionKind = (typeof EXECUTION_KINDS)[number];

export const USAGE_STATUSES = ['ok', 'error', 'rate_limited', 'timeout', 'blocked_quota', 'blocked_cap'] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

export const TOOL_PERMISSIONS = ['read', 'write', 'exec', 'network'] as const;
export type ToolPermission = (typeof TOOL_PERMISSIONS)[number];

export const TOOL_SOURCES = ['builtin', 'mcp'] as const;
export type ToolSource = (typeof TOOL_SOURCES)[number];

export const MCP_TRANSPORTS = ['stdio', 'http'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const NETWORK_MODES = ['egress', 'none'] as const;
export type NetworkMode = (typeof NETWORK_MODES)[number];

export const CLI_LOGIN_STATES = ['unknown', 'logged_in', 'logged_out'] as const;
export type CliLoginState = (typeof CLI_LOGIN_STATES)[number];
