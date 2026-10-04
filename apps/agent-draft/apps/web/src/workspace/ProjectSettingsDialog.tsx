import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Project } from '@agent/shared';
import { api, errorMessage } from '../lib/api';
import { qk } from '../lib/queries';
import { Button, ErrorText, Field, Input, Modal, Textarea } from '../components/ui';
import { ModelPicker, type Selection } from './ModelPicker';

export function ProjectSettingsDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [selection, setSelection] = useState<Selection>({
    modelId: project.defaultModelId,
    credentialMode: project.defaultCredentialMode,
    cliKind: project.defaultCliKind,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (patch: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/projects/${project.id}`, patch);
      await qc.invalidateQueries({ queryKey: qk.projects });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!confirm(`Delete "${project.name}"? Its sandbox, files and history are removed permanently.`)) return;
    setBusy(true);
    try {
      await api.del(`/projects/${project.id}`);
      await qc.invalidateQueries({ queryKey: qk.projects });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="Project settings" open onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" hint="Given to the agent as project context.">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Default model for new conversations">
          <ModelPicker value={selection} onChange={setSelection} inheritLabel="Use my default" />
        </Field>
        <ErrorText error={error} />
        <div className="flex justify-between gap-2">
          <Button variant="danger" onClick={() => void remove()} disabled={busy}>
            Delete project
          </Button>
          <div className="flex gap-2">
            <Button
              onClick={() => void save({ status: project.status === 'archived' ? 'active' : 'archived' })}
              disabled={busy}
            >
              {project.status === 'archived' ? 'Unarchive' : 'Archive'}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                void save({
                  name,
                  description: description || null,
                  defaultModelId: selection.modelId,
                  defaultCredentialMode: selection.credentialMode,
                  defaultCliKind: selection.cliKind,
                })
              }
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
