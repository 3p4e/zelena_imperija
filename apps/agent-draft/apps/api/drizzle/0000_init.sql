CREATE TYPE "public"."network_mode" AS ENUM('egress', 'none');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."cli_kind" AS ENUM('claude_code', 'codex', 'gemini_cli');--> statement-breakpoint
CREATE TYPE "public"."cli_login_state" AS ENUM('unknown', 'logged_in', 'logged_out');--> statement-breakpoint
CREATE TYPE "public"."credential_mode" AS ENUM('byok', 'shared', 'subscription_cli');--> statement-breakpoint
CREATE TYPE "public"."key_status" AS ENUM('active', 'revoked', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."model_source" AS ENUM('seed', 'fetched', 'manual');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('anthropic', 'openai', 'gemini', 'openrouter', 'openai_compatible');--> statement-breakpoint
CREATE TYPE "public"."mcp_transport" AS ENUM('stdio', 'http');--> statement-breakpoint
CREATE TYPE "public"."tool_permission" AS ENUM('read', 'write', 'exec', 'network');--> statement-breakpoint
CREATE TYPE "public"."tool_source" AS ENUM('builtin', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('idle', 'running', 'stopped', 'error');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('system', 'user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('streaming', 'complete', 'stopped', 'error');--> statement-breakpoint
CREATE TYPE "public"."part_kind" AS ENUM('text', 'reasoning', 'tool_call', 'tool_result', 'error');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."share_permission" AS ENUM('read', 'edit');--> statement-breakpoint
CREATE TYPE "public"."execution_kind" AS ENUM('shell', 'test', 'preview', 'git', 'fs');--> statement-breakpoint
CREATE TYPE "public"."sandbox_status" AS ENUM('creating', 'running', 'stopped', 'failed', 'removed');--> statement-breakpoint
CREATE TYPE "public"."usage_status" AS ENUM('ok', 'error', 'rate_limited', 'timeout', 'blocked_quota', 'blocked_cap');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"ip" "inet",
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"success" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_limits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"sandbox_cpu" real NOT NULL,
	"sandbox_mem_mb" integer NOT NULL,
	"sandbox_disk_mb" integer NOT NULL,
	"max_containers" integer NOT NULL,
	"network_mode" "network_mode" DEFAULT 'egress' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_tool_restrictions" (
	"user_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"allowed" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"suspended_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cli_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "cli_kind" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"binary_version" text,
	"login_state" "cli_login_state" DEFAULT 'unknown' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"default_model_id" uuid,
	"admin_safety_cap_enabled" boolean DEFAULT true NOT NULL,
	"admin_cap_per_task_usd" numeric(12, 4),
	"admin_cap_per_day_usd" numeric(12, 4),
	"admin_sandbox_cpu" real DEFAULT 4 NOT NULL,
	"admin_sandbox_mem_mb" integer DEFAULT 8192 NOT NULL,
	"admin_sandbox_disk_mb" integer DEFAULT 20480 NOT NULL,
	"admin_max_containers" integer DEFAULT 10 NOT NULL,
	"member_sandbox_cpu" real DEFAULT 1 NOT NULL,
	"member_sandbox_mem_mb" integer DEFAULT 2048 NOT NULL,
	"member_sandbox_disk_mb" integer DEFAULT 4096 NOT NULL,
	"member_max_containers" integer DEFAULT 2 NOT NULL,
	"container_idle_minutes" integer DEFAULT 30 NOT NULL,
	"command_timeout_s" integer DEFAULT 300 NOT NULL,
	"agent_max_iterations" integer DEFAULT 40 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "global_settings_singleton" CHECK ("global_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"context_window" integer NOT NULL,
	"max_output" integer,
	"input_price_per_mtok" numeric(12, 6),
	"output_price_per_mtok" numeric(12, 6),
	"cached_input_price_per_mtok" numeric(12, 6),
	"supports_vision" boolean DEFAULT false NOT NULL,
	"supports_tools" boolean DEFAULT true NOT NULL,
	"supports_reasoning" boolean DEFAULT false NOT NULL,
	"supports_structured_output" boolean DEFAULT true NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"source" "model_source" DEFAULT 'seed' NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "provider_kind" NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"base_url" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_key_grant_models" (
	"grant_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	CONSTRAINT "shared_key_grant_models_grant_id_model_id_pk" PRIMARY KEY("grant_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "shared_key_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_key_id" uuid NOT NULL,
	"member_user_id" uuid NOT NULL,
	"daily_limit_usd" numeric(12, 4) NOT NULL,
	"monthly_limit_usd" numeric(12, 4) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_defaults" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"default_model_id" uuid,
	"default_credential_mode" "credential_mode",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_deks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"master_key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"label" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	"last4" text NOT NULL,
	"status" "key_status" DEFAULT 'active' NOT NULL,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_definition_tools" (
	"agent_definition_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	CONSTRAINT "agent_definition_tools_agent_definition_id_tool_name_pk" PRIMARY KEY("agent_definition_id","tool_name")
);
--> statement-breakpoint
CREATE TABLE "agent_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"role_description" text DEFAULT '' NOT NULL,
	"system_prompt" text NOT NULL,
	"default_model_id" uuid,
	"max_iterations" integer DEFAULT 40 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"name" text NOT NULL,
	"transport" "mcp_transport" NOT NULL,
	"command" text,
	"args" text[] DEFAULT '{}' NOT NULL,
	"url" text,
	"env_ciphertext" "bytea",
	"env_nonce" "bytea",
	"enabled" boolean DEFAULT true NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_catalog" (
	"name" text PRIMARY KEY NOT NULL,
	"source" "tool_source" NOT NULL,
	"mcp_server_id" uuid,
	"description" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"permission" "tool_permission" NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"agent_definition_id" uuid NOT NULL,
	"model_id" uuid,
	"credential_mode" "credential_mode",
	"cli_kind" "cli_kind",
	"cli_session_id" text,
	"status" "conversation_status" DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" "part_kind" NOT NULL,
	"text" text,
	"tool_name" text,
	"tool_call_id" text,
	"arguments" jsonb,
	"result_text" text,
	"is_error" boolean
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"seq" integer NOT NULL,
	"status" "message_status" DEFAULT 'complete' NOT NULL,
	"model_id" uuid,
	"credential_mode" "credential_mode",
	"cli_kind" "cli_kind",
	"parent_message_id" uuid,
	"superseded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_shares" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" "share_permission" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_shares_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_model_id" uuid,
	"default_credential_mode" "credential_mode",
	"default_cli_kind" "cli_kind",
	"sandbox_image" text NOT NULL,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"stream" text NOT NULL,
	"seq" integer NOT NULL,
	"chunk" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_part_id" uuid,
	"actor_user_id" uuid,
	"kind" "execution_kind" NOT NULL,
	"command" text NOT NULL,
	"exit_code" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"timed_out" boolean DEFAULT false NOT NULL,
	"stdout_bytes" bigint DEFAULT 0 NOT NULL,
	"stderr_bytes" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preview_ports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sandbox_id" uuid NOT NULL,
	"port" integer NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"container_id" text,
	"network_id" text,
	"volume_name" text NOT NULL,
	"status" "sandbox_status" DEFAULT 'creating' NOT NULL,
	"cpu" real NOT NULL,
	"mem_mb" integer NOT NULL,
	"disk_mb" integer NOT NULL,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"framework" text NOT NULL,
	"total" integer,
	"passed" integer,
	"failed" integer,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"conversation_id" uuid,
	"message_id" uuid,
	"provider_id" uuid,
	"provider_slug" text NOT NULL,
	"model_ref" uuid,
	"model_id" text NOT NULL,
	"credential_source" "credential_mode" NOT NULL,
	"user_key_id" uuid,
	"shared_key_grant_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer,
	"estimated_cost_usd" numeric(14, 8),
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"status" "usage_status" NOT NULL,
	"error_code" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_limits" ADD CONSTRAINT "member_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_tool_restrictions" ADD CONSTRAINT "member_tool_restrictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_settings" ADD CONSTRAINT "global_settings_default_model_id_models_id_fk" FOREIGN KEY ("default_model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_key_grant_models" ADD CONSTRAINT "shared_key_grant_models_grant_id_shared_key_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."shared_key_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_key_grant_models" ADD CONSTRAINT "shared_key_grant_models_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_key_grants" ADD CONSTRAINT "shared_key_grants_user_key_id_user_keys_id_fk" FOREIGN KEY ("user_key_id") REFERENCES "public"."user_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_key_grants" ADD CONSTRAINT "shared_key_grants_member_user_id_users_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_defaults" ADD CONSTRAINT "user_defaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_defaults" ADD CONSTRAINT "user_defaults_default_model_id_models_id_fk" FOREIGN KEY ("default_model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_deks" ADD CONSTRAINT "user_deks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_keys" ADD CONSTRAINT "user_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_keys" ADD CONSTRAINT "user_keys_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition_tools" ADD CONSTRAINT "agent_definition_tools_agent_definition_id_agent_definitions_id_fk" FOREIGN KEY ("agent_definition_id") REFERENCES "public"."agent_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_default_model_id_models_id_fk" FOREIGN KEY ("default_model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_catalog" ADD CONSTRAINT "tool_catalog_mcp_server_id_mcp_servers_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_definition_id_agent_definitions_id_fk" FOREIGN KEY ("agent_definition_id") REFERENCES "public"."agent_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_parts" ADD CONSTRAINT "message_parts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_shares" ADD CONSTRAINT "project_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_default_model_id_models_id_fk" FOREIGN KEY ("default_model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_message_part_id_message_parts_id_fk" FOREIGN KEY ("message_part_id") REFERENCES "public"."message_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_ports" ADD CONSTRAINT "preview_ports_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_model_ref_models_id_fk" FOREIGN KEY ("model_ref") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_key_id_user_keys_id_fk" FOREIGN KEY ("user_key_id") REFERENCES "public"."user_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_shared_key_grant_id_shared_key_grants_id_fk" FOREIGN KEY ("shared_key_grant_id") REFERENCES "public"."shared_key_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash_idx" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "login_attempts_subject_idx" ON "login_attempts" USING btree ("subject","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_tool_restrictions_pk" ON "member_tool_restrictions" USING btree ("user_id","tool_name");--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_token_hash_idx" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "cli_providers_kind_idx" ON "cli_providers" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "models_provider_model_idx" ON "models" USING btree ("provider_id","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_slug_idx" ON "providers" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_key_grants_key_member_idx" ON "shared_key_grants" USING btree ("user_key_id","member_user_id");--> statement-breakpoint
CREATE INDEX "shared_key_grants_member_idx" ON "shared_key_grants" USING btree ("member_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_keys_user_provider_label_idx" ON "user_keys" USING btree ("user_id","provider_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definitions_slug_idx" ON "agent_definitions" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_name_idx" ON "mcp_servers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "conversations_project_idx" ON "conversations" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_parts_message_seq_idx" ON "message_parts" USING btree ("message_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_seq_idx" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "project_shares_user_idx" ON "project_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_logs_exec_seq_idx" ON "execution_logs" USING btree ("execution_id","seq");--> statement-breakpoint
CREATE INDEX "executions_sandbox_idx" ON "executions" USING btree ("sandbox_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_ports_sandbox_port_idx" ON "preview_ports" USING btree ("sandbox_id","port");--> statement-breakpoint
CREATE UNIQUE INDEX "sandboxes_project_idx" ON "sandboxes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "usage_records_user_at_idx" ON "usage_records" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "usage_records_project_at_idx" ON "usage_records" USING btree ("project_id","at");--> statement-breakpoint
CREATE INDEX "usage_records_grant_at_idx" ON "usage_records" USING btree ("shared_key_grant_id","at");