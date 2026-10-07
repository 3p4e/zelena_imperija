import { Navigate, useNavigate, useSearch } from '@tanstack/react-router';
import { useMe } from '../lib/queries';
import { Tabs } from '../components/ui';
import { UsersTab } from '../admin/UsersTab';
import { SharedKeysTab } from '../admin/SharedKeysTab';
import { AgentsTab } from '../admin/AgentsTab';
import { CliTab } from '../admin/CliTab';
import { SettingsTab } from '../admin/SettingsTab';
import { UsageTab } from '../admin/UsageTab';
import { ToolsTab } from '../admin/ToolsTab';

const TABS = [
  { id: 'users', label: 'Users' },
  { id: 'shared', label: 'Shared keys' },
  { id: 'agents', label: 'Agents' },
  { id: 'tools', label: 'Tools' },
  { id: 'cli', label: 'Subscriptions' },
  { id: 'usage', label: 'Usage' },
  { id: 'settings', label: 'Settings' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function AdminPage() {
  const me = useMe();
  const search = useSearch({ from: '/app/admin' });
  const navigate = useNavigate({ from: '/admin' });
  if (me.data && !me.data.capabilities.admin) return <Navigate to="/" search={{}} />;
  const tab: TabId = TABS.some((t) => t.id === search.tab) ? (search.tab as TabId) : 'users';
  return (
    <div className="flex h-full flex-col">
      <Tabs<TabId> tabs={[...TABS]} value={tab} onChange={(t) => void navigate({ search: { tab: t } })} />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl p-6">
          {tab === 'users' && <UsersTab />}
          {tab === 'shared' && <SharedKeysTab />}
          {tab === 'agents' && <AgentsTab />}
          {tab === 'tools' && <ToolsTab />}
          {tab === 'cli' && <CliTab />}
          {tab === 'usage' && <UsageTab />}
          {tab === 'settings' && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}
