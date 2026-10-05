import { useState, type SyntheticEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { qk } from '../lib/queries';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { AuthLayout } from './AuthLayout';

/** Shown instead of the app while the account still has an admin-issued one-time password. */
export function ForcePasswordChange({ email }: { email: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (next !== again) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password', { currentPassword: current, newPassword: next });
      await qc.invalidateQueries({ queryKey: qk.me });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const logout = async (): Promise<void> => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    await navigate({ to: '/login' });
  };

  return (
    <AuthLayout title="Choose your own password">
      <p className="mb-3 text-xs text-zinc-400">
        Signed in as {email} with a one-time password. Set your own password to continue.
      </p>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field label="One-time password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="New password (min. 10 characters)">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Repeat new password">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" loading={busy}>
          Set password
        </Button>
        <button
          type="button"
          className="text-xs text-zinc-500 hover:text-zinc-300"
          onClick={() => void logout()}
        >
          Sign out
        </button>
      </form>
    </AuthLayout>
  );
}
