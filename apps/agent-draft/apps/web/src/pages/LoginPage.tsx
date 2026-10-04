import { useState, type SyntheticEvent } from 'react';
import { Link, Navigate, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { qk, useMe } from '../lib/queries';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data) return <Navigate to="/" search={{}} />;

  const submit = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<MeResponse>('/auth/login', { email, password });
      qc.setQueryData(qk.me, res);
      await navigate({ to: '/', search: {} });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field label="Email">
          <Input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" loading={busy}>
          Sign in
        </Button>
        <Link
          to="/reset-password"
          search={{}}
          className="text-center text-xs text-zinc-400 hover:text-zinc-200"
        >
          Forgot password?
        </Link>
        <p className="text-center text-xs text-zinc-500">Accounts are created by invitation only.</p>
      </form>
    </AuthLayout>
  );
}
