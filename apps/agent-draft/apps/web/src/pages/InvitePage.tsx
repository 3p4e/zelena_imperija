import { useState, type SyntheticEvent } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { qk } from '../lib/queries';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { AuthLayout } from './AuthLayout';

export function InvitePage() {
  const { token } = useSearch({ from: '/invite' });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<MeResponse>('/auth/invites/accept', { token, displayName, password });
      qc.setQueryData(qk.me, res);
      await navigate({ to: '/', search: {} });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Accept invitation">
        <ErrorText error="This link has no invitation token. Ask the admin for a new invite." />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Accept invitation">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field label="Your name">
          <Input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Choose a password" hint="At least 10 characters.">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
