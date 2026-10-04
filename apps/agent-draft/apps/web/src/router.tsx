import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { InvitePage } from './pages/InvitePage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const tokenSearch = (s: Record<string, unknown>): { token?: string } =>
  typeof s.token === 'string' ? { token: s.token } : {};

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite',
  validateSearch: tokenSearch,
  component: InvitePage,
});
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: tokenSearch,
  component: ResetPasswordPage,
});

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: AppShell });

export interface WorkspaceSearch {
  project?: string;
  conversation?: string;
}
const workspaceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  validateSearch: (s: Record<string, unknown>): WorkspaceSearch => ({
    ...(typeof s.project === 'string' ? { project: s.project } : {}),
    ...(typeof s.conversation === 'string' ? { conversation: s.conversation } : {}),
  }),
  component: WorkspacePage,
});
const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
});
const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin',
  validateSearch: (s: Record<string, unknown>): { tab?: string } =>
    typeof s.tab === 'string' ? { tab: s.tab } : {},
  component: AdminPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  inviteRoute,
  resetRoute,
  appRoute.addChildren([workspaceRoute, settingsRoute, adminRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: false });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
