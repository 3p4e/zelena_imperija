import { useState, type SyntheticEvent } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { api, errorMessage } from '../lib/api';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { AuthLayout } from './AuthLayout';

export function ResetPasswordPage() {
  const { token } = useSearch({ from: '/reset-password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setDone(await fn());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const request = (e: SyntheticEvent): void => {
    e.preventDefault();
    void run(async () => {
      const r = await api.post<{ delivery: 'email' | 'admin' }>('/auth/password-reset/request', { email });
      return r.delivery === 'email'
        ? 'If an account exists for that email, a reset link is on its way.'
        : 'Email delivery is not configured on this server. Ask the admin for a reset link.';
    });
  };

  const complete = (e: SyntheticEvent): void => {
    e.preventDefault();
    void run(async () => {
      await api.post('/auth/password-reset/complete', { token, password });
      return 'Password updated. You can sign in now.';
    });
  };

  return (
    <AuthLayout title={token ? 'Choose a new password' : 'Reset your password'}>
      {done ? (
        <div className="flex flex-col gap-3 text-sm text-zinc-300">
          <p>{done}</p>
          <Link to="/login" className="text-amber-400 hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : token ? (
        <form onSubmit={complete} className="flex flex-col gap-3">
          <Field label="New password" hint="At least 10 characters.">
            <Input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" variant="primary" loading={busy}>
            Set password
          </Button>
        </form>
      ) : (
        <form onSubmit={request} className="flex flex-col gap-3">
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" variant="primary" loading={busy}>
            Send reset link
          </Button>
          <Link to="/login" className="text-center text-xs text-zinc-400 hover:text-zinc-200">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
