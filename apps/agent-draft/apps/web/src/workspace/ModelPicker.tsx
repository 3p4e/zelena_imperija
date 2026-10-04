import type { CliKind, CredentialMode } from '@agent/shared';
import { useCliOptions, useModels } from '../lib/queries';
import { CLI_LABELS } from '../lib/format';
import { Select } from '../components/ui';

export interface Selection {
  modelId: string | null;
  credentialMode: CredentialMode | null;
  cliKind: CliKind | null;
}

export const EMPTY_SELECTION: Selection = { modelId: null, credentialMode: null, cliKind: null };

const MODE_LABEL: Record<string, string> = { byok: 'own key', shared: 'shared key' };

function encode(s: Selection): string {
  if (s.credentialMode === 'subscription_cli' && s.cliKind) return `cli:${s.cliKind}`;
  if (s.modelId) return `api:${s.modelId}:${s.credentialMode ?? 'auto'}`;
  return 'inherit';
}

function decode(v: string): Selection {
  if (v.startsWith('cli:')) return { modelId: null, credentialMode: 'subscription_cli', cliKind: v.slice(4) as CliKind };
  if (v.startsWith('api:')) {
    const [, modelId, mode] = v.split(':');
    return { modelId: modelId ?? null, credentialMode: mode === 'auto' || !mode ? null : (mode as CredentialMode), cliKind: null };
  }
  return EMPTY_SELECTION;
}

/**
 * Lists only what the current user can actually run: models with a usable key
 * (own or shared), plus subscription CLIs for the admin.
 */
export function ModelPicker({ value, onChange, inheritLabel, disabled }: { value: Selection; onChange: (s: Selection) => void; inheritLabel: string; disabled?: boolean }) {
  const models = useModels();
  const cli = useCliOptions();
  const byProvider = new Map<string, NonNullable<typeof models.data>>();
  for (const opt of models.data ?? []) {
    const list = byProvider.get(opt.model.providerSlug) ?? [];
    list.push(opt);
    byProvider.set(opt.model.providerSlug, list);
  }
  const current = encode(value);
  const known = current === 'inherit' || current.startsWith('cli:') || (models.data ?? []).some((o) => current.startsWith(`api:${o.model.id}:`));

  return (
    <Select value={current} onChange={(e) => onChange(decode(e.target.value))} disabled={disabled} className="max-w-[260px] text-xs" aria-label="Model">
      <option value="inherit">{inheritLabel}</option>
      {!known && <option value={current}>(unavailable model)</option>}
      {[...byProvider.entries()].map(([provider, opts]) => (
        <optgroup key={provider} label={provider}>
          {opts.flatMap((o) =>
            o.credentialModes.length <= 1
              ? [
                  <option key={o.model.id} value={`api:${o.model.id}:auto`}>
                    {o.model.displayName}
                    {o.credentialModes[0] === 'shared' ? ' (shared key)' : ''}
                  </option>,
                ]
              : o.credentialModes.map((m) => (
                  <option key={`${o.model.id}:${m}`} value={`api:${o.model.id}:${m}`}>
                    {o.model.displayName} ({MODE_LABEL[m] ?? m})
                  </option>
                )),
          )}
        </optgroup>
      ))}
      {(cli.data ?? []).length > 0 && (
        <optgroup label="Subscriptions (admin)">
          {(cli.data ?? []).map((c) => (
            <option key={c.kind} value={`cli:${c.kind}`}>
              {CLI_LABELS[c.kind] ?? c.kind}
              {c.loginState !== 'logged_in' ? ' — not logged in' : ''}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}
