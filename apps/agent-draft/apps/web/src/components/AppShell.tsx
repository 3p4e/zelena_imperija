import { Link, Navigate, Outlet, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../lib/queries';
import { Spinner } from './ui';
import { ForcePasswordChange } from '../pages/ForcePasswordChange';

/** Authenticated layout: top bar plus the routed page. Unauthenticated users go to /login. */
export function AppShell() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (me.isLoading) return <Spinner />;
  if (!me.data) return <Navigate to="/login" />;
  const { user, capabilities } = me.data;
  if (user.mustChangePassword) return <ForcePasswordChange email={user.email} />;

  const logout = async (): Promise<void> => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    await navigate({ to: '/login' });
  };

  const link =
    'rounded px-2 py-1 text-sm text-zinc-400 hover:text-zinc-100 [&.active]:bg-zinc-800 [&.active]:text-zinc-100';
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-zinc-800 bg-zinc-950 px-3">
        <Link to="/" search={{}} className="flex items-center gap-2 font-semibold tracking-tight">
          <img src="/favicon.svg" alt="" className="size-5" />
          BACK_LOG
        </Link>
        <nav className="flex gap-1">
          <Link to="/" search={{}} className={link} activeOptions={{ exact: true, includeSearch: false }}>
            Workspace
          </Link>
          <Link to="/settings" className={link}>
            Settings
          </Link>
          {capabilities.admin && (
            <Link to="/admin" search={{}} className={link}>
              Admin
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
          <span>
            {user.displayName} · {user.role}
          </span>
          <button
            onClick={() => void logout()}
            className="flex items-center gap-1 hover:text-zinc-100"
            aria-label="Log out"
          >
            <LogOut className="size-3.5" /> Log out
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
