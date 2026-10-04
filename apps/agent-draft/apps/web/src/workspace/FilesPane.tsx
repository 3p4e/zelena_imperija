import { useMemo, useState } from 'react';
import clsx from 'clsx';
import Editor from '@monaco-editor/react';
import { KeyCode, KeyMod } from 'monaco-editor';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, File, FilePlus, Folder, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { FileEntry, Project } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { languageFor } from '../lib/monaco';
import { qk } from '../lib/queries';
import { Button, Empty, ErrorText, Spinner } from '../components/ui';

interface FileContent {
  path: string;
  content: string;
  size: number;
  binary: boolean;
  truncated: boolean;
}

export function FilesPane({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const qc = useQueryClient();
  const files = useQuery({
    queryKey: qk.files(project.id),
    queryFn: () => api.get<{ entries: FileEntry[] }>(`/projects/${project.id}/files`),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const content = useQuery({
    queryKey: ['file', project.id, selected],
    queryFn: () =>
      api.get<FileContent>(
        `/projects/${project.id}/files/content?path=${encodeURIComponent(selected ?? '')}`,
      ),
    enabled: !!selected,
  });

  const visible = useMemo(() => {
    const entries = files.data?.entries ?? [];
    return entries.filter((e) => ![...collapsed].some((c) => e.path.startsWith(`${c}/`)));
  }, [files.data, collapsed]);

  const save = async (): Promise<void> => {
    if (!selected || draft === null) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/projects/${project.id}/files/content`, { path: selected, content: draft });
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['file', project.id, selected] });
      await qc.invalidateQueries({ queryKey: qk.files(project.id) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const create = async (): Promise<void> => {
    const path = prompt('New file path (relative to the project root):');
    if (!path) return;
    try {
      await api.put(`/projects/${project.id}/files/content`, { path, content: '' });
      await qc.invalidateQueries({ queryKey: qk.files(project.id) });
      setSelected(path.replace(/^\/+/, ''));
      setDraft(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (path: string): Promise<void> => {
    if (!confirm(`Delete ${path}?`)) return;
    try {
      await api.del(`/projects/${project.id}/files/content?path=${encodeURIComponent(path)}`);
      if (selected === path) setSelected(null);
      await qc.invalidateQueries({ queryKey: qk.files(project.id) });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="grid h-full grid-cols-[220px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-r border-zinc-800">
        <div className="flex items-center gap-1 px-2 py-1.5">
          <span className="flex-1 text-[11px] tracking-wide text-zinc-500 uppercase">/workspace</span>
          <Button size="sm" variant="ghost" aria-label="Refresh files" onClick={() => void files.refetch()}>
            <RefreshCw className="size-3.5" />
          </Button>
          {canEdit && (
            <Button size="sm" variant="ghost" aria-label="New file" onClick={() => void create()}>
              <FilePlus className="size-3.5" />
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto pb-2 font-mono text-[12px]">
          {files.isLoading && <Spinner label="Starting sandbox…" />}
          {files.error && <ErrorText error={errorMessage(files.error)} />}
          {files.data?.entries.length === 0 && <Empty>No files yet.</Empty>}
          {visible.map((e) => {
            const depth = e.path.split('/').length - 1;
            const name = e.path.split('/').pop();
            const isCollapsed = collapsed.has(e.path);
            return (
              <div key={e.path} className="group flex items-center">
                <button
                  className={clsx(
                    'flex min-w-0 flex-1 items-center gap-1 py-0.5 pr-1 text-left hover:bg-zinc-900',
                    selected === e.path && 'bg-zinc-800',
                  )}
                  style={{ paddingLeft: 8 + depth * 12 }}
                  onClick={() => {
                    if (e.type === 'dir') {
                      const next = new Set(collapsed);
                      if (isCollapsed) next.delete(e.path);
                      else next.add(e.path);
                      setCollapsed(next);
                    } else {
                      setSelected(e.path);
                      setDraft(null);
                    }
                  }}
                >
                  {e.type === 'dir' ? (
                    <>
                      {isCollapsed ? (
                        <ChevronRight className="size-3 shrink-0" />
                      ) : (
                        <ChevronDown className="size-3 shrink-0" />
                      )}
                      <Folder className="size-3.5 shrink-0 text-amber-500/80" />
                    </>
                  ) : (
                    <File className="ml-3 size-3.5 shrink-0 text-zinc-500" />
                  )}
                  <span className="truncate">{name}</span>
                </button>
                {canEdit && (
                  <button
                    className="hidden px-1 text-zinc-500 group-hover:block hover:text-red-400"
                    aria-label={`Delete ${e.path}`}
                    onClick={() => void remove(e.path)}
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex min-h-0 flex-col">
        {selected ? (
          <>
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs">
              <span className="truncate font-mono text-zinc-300">{selected}</span>
              {draft !== null && <span className="text-amber-400">unsaved</span>}
              {canEdit && (
                <Button
                  size="sm"
                  className="ml-auto"
                  variant={draft !== null ? 'primary' : 'secondary'}
                  disabled={draft === null}
                  loading={saving}
                  onClick={() => void save()}
                >
                  <Save className="size-3.5" /> Save
                </Button>
              )}
            </div>
            <ErrorText error={error} />
            {content.isLoading ? (
              <Spinner />
            ) : content.error ? (
              <ErrorText error={errorMessage(content.error)} />
            ) : content.data?.binary ? (
              <Empty>Binary file ({content.data.size} bytes).</Empty>
            ) : (
              <div className="min-h-0 flex-1">
                <Editor
                  theme="vs-dark"
                  path={selected}
                  language={languageFor(selected)}
                  value={draft ?? content.data?.content ?? ''}
                  onChange={(v) => setDraft(v ?? '')}
                  options={{
                    readOnly: !canEdit || content.data?.truncated === true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                  onMount={(editor) => {
                    editor.addCommand(KeyMod.CtrlCmd | KeyCode.KeyS, () => void save());
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <Empty>Select a file to view or edit it.</Empty>
        )}
      </div>
    </div>
  );
}
