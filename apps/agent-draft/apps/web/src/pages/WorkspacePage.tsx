import { useEffect } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useConversations, useProjects } from '../lib/queries';
import { ProjectSidebar } from '../workspace/ProjectSidebar';
import { ChatPanel } from '../workspace/ChatPanel';
import { RightPanel } from '../workspace/RightPanel';
import { Empty, Spinner } from '../components/ui';

/** Three-panel workspace: projects/conversations · chat · files/terminal/tests/preview. */
export function WorkspacePage() {
  const search = useSearch({ from: '/app/' });
  const navigate = useNavigate({ from: '/' });
  const projects = useProjects();
  const project = projects.data?.find((p) => p.id === search.project) ?? null;
  const conversations = useConversations(project?.id);
  const conversation = conversations.data?.find((c) => c.id === search.conversation) ?? null;

  // Keep the URL pointing at something that exists.
  useEffect(() => {
    if (!projects.data) return;
    if (!project && projects.data[0])
      void navigate({ search: { project: projects.data[0].id }, replace: true });
  }, [projects.data, project, navigate]);
  useEffect(() => {
    if (!project || !conversations.data) return;
    if (!conversation && conversations.data[0])
      void navigate({
        search: { project: project.id, conversation: conversations.data[0].id },
        replace: true,
      });
  }, [project, conversations.data, conversation, navigate]);

  if (projects.isLoading) return <Spinner />;
  const canEdit = project?.myPermission === 'owner' || project?.myPermission === 'edit';

  return (
    <div className="grid h-full grid-cols-[260px_minmax(0,1fr)_minmax(0,1.1fr)]">
      <ProjectSidebar
        projects={projects.data ?? []}
        project={project}
        conversations={conversations.data ?? []}
        conversationId={conversation?.id ?? null}
        onSelect={(projectId, conversationId) =>
          void navigate({
            search: { project: projectId, ...(conversationId ? { conversation: conversationId } : {}) },
          })
        }
      />
      <section className="flex min-h-0 flex-col border-x border-zinc-800">
        {project && conversation ? (
          <ChatPanel key={conversation.id} project={project} conversation={conversation} canEdit={canEdit} />
        ) : (
          <Empty>{project ? 'Create a conversation to start.' : 'Create a project to start.'}</Empty>
        )}
      </section>
      <section className="flex min-h-0 flex-col">
        {project ? (
          <RightPanel key={project.id} project={project} canEdit={canEdit} />
        ) : (
          <Empty>No project selected.</Empty>
        )}
      </section>
    </div>
  );
}
