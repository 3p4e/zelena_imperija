import { useState } from 'react';
import clsx from 'clsx';
import { FolderPlus, MessageSquarePlus, Settings2, Share2, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { Conversation, Project } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { qk } from '../lib/queries';
import { Badge, Button, ErrorText, Field, Input, Modal, Textarea } from '../components/ui';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { ShareDialog } from './ShareDialog';

interface Props {
  projects: Project[];
  project: Project | null;
  conversations: Conversation[];
  conversationId: string | null;
  onSelect: (projectId: string, conversationId?: string) => void;
}

export function ProjectSidebar({ projects, project, conversations, conversationId, onSelect }: Props) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = project?.myPermission === 'owner' || project?.myPermission === 'edit';

  const newConversation = async (): Promise<void> => {
    if (!project) return;
    try {
      const c = await api.post<Conversation>(`/projects/${project.id}/conversations`, {});
      await qc.invalidateQueries({ queryKey: qk.conversations(project.id) });
      onSelect(project.id, c.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const deleteConversation = async (id: string): Promise<void> => {
    if (!project || !confirm('Delete this conversation and its history?')) return;
    try {
      await api.del(`/conversations/${id}`);
      await qc.invalidateQueries({ queryKey: qk.conversations(project.id) });
      onSelect(project.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <aside className="flex min-h-0 flex-col bg-zinc-950">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Projects</span>
        <Button size="sm" variant="ghost" onClick={() => setCreating(true)} aria-label="New project">
          <FolderPlus className="size-3.5" />
        </Button>
      </div>
      <ul className="max-h-[40%] overflow-auto px-2">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p.id)}
              className={clsx('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm', p.id === project?.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900')}
            >
              <span className="truncate">{p.name}</span>
              {p.myPermission !== 'owner' && <Badge tone="info">shared · {p.myPermission}</Badge>}
              {p.status === 'archived' && <Badge>archived</Badge>}
            </button>
          </li>
        ))}
        {projects.length === 0 && <li className="px-2 py-2 text-xs text-zinc-500">No projects yet.</li>}
      </ul>

      {project && (
        <>
          <div className="mt-3 flex items-center justify-between border-t border-zinc-800 px-3 pt-3 pb-1">
            <span className="truncate text-xs font-semibold tracking-wide text-zinc-500 uppercase">Conversations</span>
            <div className="flex">
              {project.myPermission === 'owner' && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setShareOpen(true)} aria-label="Share project">
                    <Share2 className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)} aria-label="Project settings">
                    <Settings2 className="size-3.5" />
                  </Button>
                </>
              )}
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => void newConversation()} aria-label="New conversation">
                  <MessageSquarePlus className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-auto px-2 pb-3">
            {conversations.map((c) => (
              <li key={c.id} className="group flex items-center">
                <button
                  onClick={() => onSelect(project.id, c.id)}
                  className={clsx('min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm', c.id === conversationId ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900')}
                >
                  {c.status === 'running' && <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-amber-400" />}
                  {c.title}
                </button>
                {canEdit && (
                  <button onClick={() => void deleteConversation(c.id)} className="hidden px-1 text-zinc-500 group-hover:block hover:text-red-400" aria-label="Delete conversation">
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="px-3 pb-2">
        <ErrorText error={error} />
      </div>

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => onSelect(id)} />
      {project && settingsOpen && <ProjectSettingsDialog project={project} onClose={() => setSettingsOpen(false)} />}
      {project && shareOpen && <ShareDialog project={project} onClose={() => setShareOpen(false)} />}
    </aside>
  );
}

function NewProjectDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.post<Project>('/projects', { name, description: description || null });
      await qc.invalidateQueries({ queryKey: qk.projects });
      setName('');
      setDescription('');
      onClose();
      onCreated(p.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New project" open={open} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Name">
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" hint="Given to the agent as project context.">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" loading={busy}>
          Create project
        </Button>
      </form>
    </Modal>
  );
}
