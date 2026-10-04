import { useQuery } from '@tanstack/react-query';
import type {
  AvailableModelOption,
  Conversation,
  MeResponse,
  Project,
  Provider,
  SandboxInfo,
  ToolCatalogEntry,
  UsageSummary,
  UserKey,
} from '@agent/shared';
import { ApiError, api } from './api';

export const qk = {
  me: ['me'] as const,
  projects: ['projects'] as const,
  conversations: (projectId: string) => ['conversations', projectId] as const,
  messages: (conversationId: string) => ['messages', conversationId] as const,
  models: ['models'] as const,
  providers: ['providers'] as const,
  cliOptions: ['cli-options'] as const,
  keys: ['keys'] as const,
  sandbox: (projectId: string) => ['sandbox', projectId] as const,
  files: (projectId: string) => ['files', projectId] as const,
  executions: (projectId: string) => ['executions', projectId] as const,
  testRuns: (projectId: string) => ['test-runs', projectId] as const,
  usage: (scope: string) => ['usage', scope] as const,
  tools: ['tools'] as const,
  defaults: ['defaults'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return await api.get<MeResponse>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export const useProjects = () =>
  useQuery({ queryKey: qk.projects, queryFn: () => api.get<Project[]>('/projects') });

export const useConversations = (projectId: string | undefined) =>
  useQuery({
    queryKey: qk.conversations(projectId ?? ''),
    queryFn: () => api.get<Conversation[]>(`/projects/${projectId ?? ''}/conversations`),
    enabled: !!projectId,
  });

export const useModels = () =>
  useQuery({ queryKey: qk.models, queryFn: () => api.get<AvailableModelOption[]>('/models') });
export const useProviders = () =>
  useQuery({ queryKey: qk.providers, queryFn: () => api.get<Provider[]>('/providers') });
export const useCliOptions = () =>
  useQuery({
    queryKey: qk.cliOptions,
    queryFn: () => api.get<{ kind: string; loginState: string }[]>('/cli/options'),
  });
export const useKeys = () => useQuery({ queryKey: qk.keys, queryFn: () => api.get<UserKey[]>('/keys') });
export const useTools = () =>
  useQuery({ queryKey: qk.tools, queryFn: () => api.get<ToolCatalogEntry[]>('/tools') });
export const useDefaults = () =>
  useQuery({
    queryKey: qk.defaults,
    queryFn: () =>
      api.get<{ defaultModelId: string | null; defaultCredentialMode: string | null }>('/me/defaults'),
  });

export const useSandbox = (projectId: string) =>
  useQuery({
    queryKey: qk.sandbox(projectId),
    queryFn: () => api.get<{ sandbox: SandboxInfo | null }>(`/projects/${projectId}/sandbox`),
    refetchInterval: 15_000,
  });

export const useUsage = (scope: string, query: string) =>
  useQuery({
    queryKey: qk.usage(`${scope}?${query}`),
    queryFn: () => api.get<UsageSummary>(`${scope}${query ? `?${query}` : ''}`),
  });
