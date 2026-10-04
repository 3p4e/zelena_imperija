import { bigint, boolean, index, integer, pgEnum, pgTable, real, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { EXECUTION_KINDS, SANDBOX_STATUSES } from '@agent/shared';
import { createdAt, id, updatedAt } from './common.js';
import { conversations, messageParts, projects } from './projects.js';
import { users } from './users.js';

export const sandboxStatusEnum = pgEnum('sandbox_status', SANDBOX_STATUSES);
export const executionKindEnum = pgEnum('execution_kind', EXECUTION_KINDS);

export const sandboxes = pgTable(
  'sandboxes',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    containerId: text('container_id'),
    networkId: text('network_id'),
    volumeName: text('volume_name').notNull(),
    status: sandboxStatusEnum('status').notNull().default('creating'),
    cpu: real('cpu').notNull(),
    memMb: integer('mem_mb').notNull(),
    diskMb: integer('disk_mb').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sandboxes_project_idx').on(t.projectId)],
);

export const executions = pgTable(
  'executions',
  {
    id: id(),
    sandboxId: uuid('sandbox_id')
      .notNull()
      .references(() => sandboxes.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    messagePartId: uuid('message_part_id').references(() => messageParts.id, { onDelete: 'set null' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: executionKindEnum('kind').notNull(),
    command: text('command').notNull(),
    exitCode: integer('exit_code'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    timedOut: boolean('timed_out').notNull().default(false),
    stdoutBytes: bigint('stdout_bytes', { mode: 'number' }).notNull().default(0),
    stderrBytes: bigint('stderr_bytes', { mode: 'number' }).notNull().default(0),
  },
  (t) => [index('executions_sandbox_idx').on(t.sandboxId, t.startedAt)],
);

export const executionLogs = pgTable(
  'execution_logs',
  {
    id: id(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    stream: text('stream', { enum: ['stdout', 'stderr'] }).notNull(),
    seq: integer('seq').notNull(),
    chunk: text('chunk').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('execution_logs_exec_seq_idx').on(t.executionId, t.seq)],
);

export const testRuns = pgTable('test_runs', {
  id: id(),
  executionId: uuid('execution_id')
    .notNull()
    .references(() => executions.id, { onDelete: 'cascade' }),
  framework: text('framework').notNull(),
  total: integer('total'),
  passed: integer('passed'),
  failed: integer('failed'),
  summary: text('summary').notNull(),
  createdAt: createdAt(),
});

export const previewPorts = pgTable(
  'preview_ports',
  {
    id: id(),
    sandboxId: uuid('sandbox_id')
      .notNull()
      .references(() => sandboxes.id, { onDelete: 'cascade' }),
    port: integer('port').notNull(),
    label: text('label').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('preview_ports_sandbox_port_idx').on(t.sandboxId, t.port)],
);
