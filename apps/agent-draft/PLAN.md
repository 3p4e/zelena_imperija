# AI Coding-Agent Platform — Phase 0 Plan

Status: **DRAFT — awaiting admin approval before any application code is written.**
Branch: `draft/ai-agent-platform` (orphan). All work lives under `apps/agent-draft/`.
Date of research: 2026-10-04.

---

## 0. How to read this document

1. §1 is what cto.new actually is today, from its live site and docs. Several of your assumptions about it are wrong; §1.3 lists them.
2. §2 is the feature split (Phase 1 / Phase 2 / out of scope).
3. §3–§5 are architecture, data model, and stack, with justifications.
4. §6 is the compliance verdict for subscription-CLI mode, per provider.
5. §7 is risks. §8 is open questions I need you to answer. §9 is where I push back on the brief.
6. §10 is the Phase 1 execution order and the test plan mapped to your workflows A–I.

Nothing in this plan is implemented. No code exists yet.

---

## 1. What cto.new is today (research findings)

Sources: `cto.new`, `cto.new/pricing`, `docs.cto.new` (all pages in `llms.txt`), changelog to Sept 2026, plus third-party coverage. See References.

### 1.1 Positioning

cto.new (Engine Labs) started in 2025 as a "free AI code agent that plans, writes code and opens PRs" running asynchronously in cloud sandboxes against GitHub/GitLab repos. During 2026 it pivoted to **"Build and run a business with AI"**: the primary object is no longer a repo or a chat but an **AI Business** staffed by an **agent team** (Technical Lead, Backend/Frontend/QA Engineers, Marketing Strategist, Content Writer, Data Analyst, Sales Rep…). Pricing is ad-supported Free with daily-reset limits, plus Premium from $20/month with rolling 24h/7d limits.

### 1.2 Actual feature inventory (from docs and changelog)

| Area | Observed features |
|---|---|
| **Headquarters** | Chat with a **Lead** agent that (per permissions) hires/fires agents, assigns and evaluates tasks, uses MCPs, changes settings. Employees roster with live status, per-agent work logs, per-agent permissions and per-agent model. Pause/Resume the whole business to stop token spend. Tasks & Approvals surfaced in header and chat. |
| **Tasks** | Kanban of tasks by status; task outputs link to generated files; manual delete. |
| **Files** | Browser over the team's sandbox files; preview and copy. (Docs describe no editor or terminal.) |
| **Website** | Agents build and publish a public site on `ctonew.app`, custom domains, live preview. |
| **Chat UX** | Streaming, live tool calls, slash commands, image attachments, "suggested next messages", chat compaction for long sessions, "Surprise me" starter. |
| **Models** | Dropdown incl. "Auto model" router. Listed: Claude Opus 5, Claude Fable 5, Fable 5.1, Claude Sonnet 5, GPT‑5.5/5.6, Gemini 3.1 Pro / 3.5 Flash, DeepSeek V4 (Flash/Pro), Kimi K2.7/K3, GLM 5.1/5.3, MiniMax M3, Muse Spark, Mistral, Grok. Per-agent model override. **No BYOK anywhere in docs.** |
| **Tools** | Cloud sandboxes, web browsing, web search, email inbox per agent (AgentMail, wake-on-message, custom email domains), scheduling (cron-style triggers), webhooks inbound, Stripe product/payment-link creation (June 2026), Expo mobile builds. |
| **Integrations** | GitHub via "API integration" with repo-level access control; strong recommendation to use branch protection. Built-in MCPs: Sentry, Vercel, Supabase, Cloudflare Observability, Notion, Neon, Linear, Prisma, Render, Webflow; any custom local/remote MCP. MCP toggles account-wide and per-project; per-MCP "require approval before action". |
| **Settings** | Business name, Repositories, MCP servers, Lead permissions (autonomy ↔ token cost warning), Environment variables/secrets for sandboxes, Schedule, Webhooks. |
| **Marketplace** | Browse/hire/trade pre-built agent teams; private listings. |
| **Other** | CTO CLI (June 2026), CTOClaw no-code agent builder, Inbox, Finance, Ads sections (business-ops, not coding). |

### 1.3 Where your brief diverges from cto.new — and why that is fine

- **cto.new has no BYOK, no self-hosting, no per-user keys, no model registry UI.** Your credential layer (§3.3 of the brief) is *more* capable than cto.new, not a reproduction. Good: it is also the hardest part, so it must be built first.
- **cto.new's primary UX is "chat with a Lead who delegates", not a three-panel IDE.** The three-panel IDE you describe (file tree, editor, terminal, preview) is closer to Lovable/Bolt/Replit than to cto.new. cto.new's Files view has no editor or terminal per its docs. I will build what you asked (three-panel), but `LIMITATIONS.md` will be honest that the *shape* differs.
- **Multi-agent teams are cto.new's core identity.** You pushed it to Phase 2. Correct call for an MVP, but understand that Phase 1 reproduces cto.new's 2025 feature set (single coding agent + sandbox + PR-less iteration), not its 2026 one.
- **cto.new is repo-first (GitHub/GitLab) and asynchronous.** You asked for project-first with GitHub in Phase 2. Phase 1 will still include a `git` tool (local repo inside the sandbox), so adding remotes/PRs later is additive.

---

## 2. Feature split

### Phase 1 (MVP — must fully work)

**Identity & tenancy**
- Admin + member roles; admin creates users or invite links; no open sign-up.
- Login/logout, server-side sessions (HttpOnly cookie), password reset via emailed token (SMTP configured in `.env`; if SMTP is not configured, admin can copy the reset link from the admin page).
- Login rate limiting; HTTPS enforcement outside localhost (HSTS + redirect behind the bundled reverse proxy).
- Strict ownership scoping of every resource; optional project sharing (read/edit) with named users.
- Suspend user.

**Projects & workspace UI**
- Projects: files (in sandbox volume, snapshotted to server storage), conversations, selected provider/model, execution & test history.
- Three-panel UI: Left (projects, conversations), Centre (streaming chat, markdown, code highlighting, collapsible tool calls, stop/retry/regenerate, per-message model picker), Right (file tree, Monaco editor, xterm terminal, test results, live preview iframe).

**Provider & model layer** (highest priority)
- `AIProvider` interface: `chat`, `stream`, tool calling, structured output (JSON schema), usage reporting, `listModels`.
- Adapters: Anthropic, OpenAI, Google Gemini, OpenRouter, generic OpenAI-compatible (DeepSeek, Mistral, xAI, Ollama, LM Studio via base URL).
- DB model registry: provider, model id, display name, context window, prices, capabilities, availability; dynamic refresh from provider APIs where available; admin edit.
- Selection per project, per message, global default.

**Credentials**
- (a) BYOK per user, envelope-encrypted, masked, write-only API, test/validate/revoke.
- (b) Admin-shared keys with per-member grant, daily/monthly spend quota, model allowlist; enforced server-side pre-request.
- (c) Subscription-CLI mode, **admin only**, via unmodified official CLIs under the admin's own login — see §6 for which providers are in.

**Agent & tools**
- One primary coding agent (plan → edit → run → test → iterate) defined by DB configuration (role, system prompt, model, allowed tools).
- Tool registry with a generic `Tool` contract; Phase 1 tools: `fs.read/write/list/patch/delete`, `shell.exec`, `git.*`, `http.fetch`, `preview.open`. MCP servers (stdio and streamable-HTTP) as a tool source; admin configures them via `.env`/admin API in Phase 1, UI in Phase 2.
- Per-member tool restrictions.

**Sandbox**
- One Docker container per project, per owner; no shared volumes/networks between users; per-user Docker network; host filesystem never mounted; cgroup CPU/mem/pids limits; disk quota via sized volume; command timeouts; process cleanup; full exec logging; preview via authenticated reverse proxy.
- Member limits fixed by admin; admin limits configurable.

**Metering**
- `usage_records` per request with all required fields; dashboards per project / user / overall.
- Admin: no quotas; optional safety cap (per task + per day) on by default, editable/disableable.

**Errors & logging**
- Typed provider error taxonomy mapped to user-facing messages; retry with backoff for 429/5xx/timeouts; structured JSON logs with secret redaction; no stack traces to client.

**Ops**
- `docker compose up` → reverse proxy (Caddy) + API + web + Postgres + sandbox runtime access. `.env.example`, README, LIMITATIONS.md, migrations, lint, typecheck, tests A–I.

### Phase 2 (after Phase 1 acceptance)
- Multi-agent delegation (Lead → Backend/Frontend/QA), agent roster UI, per-agent model/permissions, work logs.
- MCP server management UI, per-MCP "require approval".
- Web browsing tool (headless Chromium in sandbox), web search tool.
- GitHub connection: clone private repos, push branches, open PRs.
- Email and calendar tools.
- Scheduled triggers and inbound webhooks.
- Chat compaction, image attachments, slash commands.
- Project templates / "Surprise me".

### Out of scope (no code, no hooks)
Billing, Stripe, plans/tiers/entitlements, marketplace, landing page, public registration, ads, public website publishing (`ctonew.app` equivalent), mobile app builds, agent email inboxes, Finance/Ads/Inbox business modules.

---

## 3. Architecture

```
                         ┌─────────────────────────────────────────────────────────┐
  Browser (admin/member) │  Caddy reverse proxy  (TLS, HSTS, /api, /preview/*, /) │
          │              └───────┬─────────────────────────┬───────────────────────┘
          │                      │                         │
          ▼                      ▼                         ▼
   ┌──────────────┐     ┌──────────────────────────────────────────────────────────┐
   │  web (React) │     │  api (Node 22 / Fastify)                                 │
   │  Vite SPA    │◀SSE─│  auth · projects · chat · agent-runtime · providers      │
   └──────────────┘     │  tools · sandbox-manager · metering · admin · preview-px │
                        └───────┬───────────────┬──────────────────┬───────────────┘
                                │               │                  │
                                ▼               ▼                  ▼
                        ┌────────────┐   ┌────────────────┐  ┌──────────────────────┐
                        │ Postgres 16│   │ Docker Engine  │  │ Provider APIs        │
                        │ (Drizzle)  │   │ via socket-    │  │ Anthropic/OpenAI/    │
                        └────────────┘   │ proxy          │  │ Gemini/OpenRouter/   │
                                         └───────┬────────┘  │ OpenAI-compatible    │
                                                 │           └──────────────────────┘
                                                 ▼
                        ┌──────────────────────────────────────────────────────────┐
                        │ per-project sandbox containers (one per project)         │
                        │ net: user-<id> (isolated bridge) · vol: proj-<id>        │
                        │ cgroups: cpu/mem/pids · no host mounts · exec via API    │
                        │ ┌───────────────┐  ┌──────────────┐  ┌────────────────┐ │
                        │ │ admin proj A  │  │ member1 proj │  │ member2 proj   │ │
                        │ └───────────────┘  └──────────────┘  └────────────────┘ │
                        └──────────────────────────────────────────────────────────┘
                                                 │
                        ┌────────────────────────┴─────────────────────────────────┐
                        │ cli-runner container (ADMIN ONLY, subscription mode)      │
                        │ unmodified `claude`, `codex`, `gemini` binaries,          │
                        │ admin's own CLI login state in a private volume,          │
                        │ invoked headless per task, workspace = project volume     │
                        └───────────────────────────────────────────────────────────┘
```

### 3.1 Request flow for one agent turn

1. `POST /api/conversations/:id/messages` → authz (owner or editor) → resolve effective provider/model/credential (`message > project > user default > global default`).
2. **Pre-flight gate** (server-side, before any provider call): member quota on shared key, model allowlist, tool restrictions, admin safety cap, model availability.
3. Agent runtime loop: build context (system prompt from `agent_definitions`, file tree summary, recent messages) → `provider.stream()` → emit SSE deltas → on tool call: check allowlist → execute in sandbox via sandbox-manager → append tool result → loop until `stop` or max iterations.
4. Each provider call writes one `usage_records` row (tokens, cost from registry price, duration, status, credential source).
5. Stop: client `POST .../stop` sets an abort signal; in-flight sandbox exec is killed; partial message persisted.

### 3.2 Subscription-CLI path (admin only)

For a run with `credential_source = subscription_cli`, the agent runtime does **not** run its own loop. It spawns the vendor's official CLI in headless mode inside the `cli-runner` container with `cwd` bound to the project's volume, parses its streaming JSON event output into the same `MessagePart` stream the UI already renders, and records usage from the CLI's reported totals where provided (cost reported as `null` when the vendor does not expose it; `LIMITATIONS.md` will say so). Tool execution is the CLI's own; our tool registry is bypassed in this mode and the UI shows the CLI's tool events read-only. Members get a 403 on any endpoint that references this mode.

### 3.3 Sandbox isolation design

- API talks to Docker only through `tecnativa/docker-socket-proxy` with a minimal allowlist (containers, exec, networks, volumes; **no** `POST /images/build`, no privileged, no host bind mounts). This limits blast radius if the API is compromised.
- Container hardening: `--cap-drop ALL`, `--security-opt no-new-privileges`, read-only root with a writable `/workspace` volume and tmpfs `/tmp`; `--pids-limit`; CPU/mem from the owner's limits row; non-root user inside.
- Network: one Docker bridge network per **user** (`agent-user-<id>`) with `enable_icc=false`; egress allowed (npm/pip installs) unless admin sets `network_mode=none` per member; host gateway access blocked by an iptables rule installed by the sandbox manager at network creation (documented; verified by test).
- Preview: container port is published only on the Docker internal network; API reverse-proxies `/preview/:projectId/:port/*` after session check. See open question Q4 on subdomains.
- Idle containers stopped after N minutes; removed with project.

---

## 4. Relational data model (PostgreSQL, Drizzle migrations)

All ids are UUIDv7. All tables have `created_at`, `updated_at`. No JSON blobs except where the shape is genuinely external and opaque (tool-call `arguments` as validated `jsonb` against the tool's schema; MCP server `env` map). Both are flagged below.

```
users(id, email UNIQUE, password_hash, display_name, role ENUM(admin,member), status ENUM(active,suspended), created_by_user_id?)
sessions(id, user_id FK, token_hash UNIQUE, ip, user_agent, expires_at, last_seen_at)
invites(id, email, token_hash UNIQUE, role, created_by, expires_at, accepted_at?)
password_resets(id, user_id, token_hash UNIQUE, expires_at, used_at?)
login_attempts(id, email_or_ip, attempted_at, success BOOL)

providers(id, kind ENUM(anthropic,openai,gemini,openrouter,openai_compatible), slug UNIQUE, display_name, base_url?, enabled)
models(id, provider_id FK, model_id, display_name, context_window INT, max_output INT?, input_price_per_mtok NUMERIC, output_price_per_mtok NUMERIC, cached_input_price_per_mtok?, supports_vision BOOL, supports_tools BOOL, supports_reasoning BOOL, supports_structured_output BOOL, available BOOL, source ENUM(seed,fetched,manual), last_fetched_at?, UNIQUE(provider_id, model_id))
global_settings(singleton: default_model_id FK, admin_safety_cap_enabled BOOL, admin_cap_per_task_usd NUMERIC?, admin_cap_per_day_usd NUMERIC?, admin_sandbox_cpu, admin_sandbox_mem_mb, admin_sandbox_disk_mb, admin_max_containers, member_sandbox_cpu, member_sandbox_mem_mb, member_sandbox_disk_mb, member_max_containers, container_idle_minutes, command_timeout_s)

user_keys(id, user_id FK, provider_id FK, label, ciphertext BYTEA, nonce BYTEA, key_version INT, last4, status ENUM(active,revoked,invalid), last_validated_at?, UNIQUE(user_id, provider_id, label))
  -- (a) BYOK; admin's rows double as the pool for (b)
shared_key_grants(id, user_key_id FK -> admin-owned user_keys, member_user_id FK, daily_limit_usd NUMERIC, monthly_limit_usd NUMERIC, enabled, UNIQUE(user_key_id, member_user_id))
shared_key_grant_models(grant_id FK, model_id FK, PK(grant_id, model_id))      -- allowlist
member_tool_restrictions(user_id FK, tool_name, allowed BOOL, PK(user_id, tool_name))
member_limits(user_id PK FK, sandbox_cpu, sandbox_mem_mb, sandbox_disk_mb, max_containers, network_mode ENUM(egress,none))
cli_providers(id, kind ENUM(claude_code,codex,gemini_cli), enabled, binary_version?, login_state ENUM(unknown,logged_in,logged_out), last_checked_at)   -- admin only

user_defaults(user_id PK FK, default_model_id?, default_credential_mode ENUM(byok,shared,subscription_cli)?)

projects(id, owner_user_id FK, name, description?, default_model_id?, default_credential_mode?, sandbox_image, status ENUM(active,archived))
project_shares(project_id FK, user_id FK, permission ENUM(read,edit), PK(project_id,user_id))
project_files(id, project_id FK, path, size, sha256, updated_at, UNIQUE(project_id,path))   -- index/snapshot of sandbox volume; content lives in object storage dir per project

agent_definitions(id, slug UNIQUE, display_name, role_description, system_prompt TEXT, default_model_id?, max_iterations INT, enabled, is_primary BOOL)
agent_definition_tools(agent_definition_id FK, tool_name, PK(...))

mcp_servers(id, owner_user_id FK? (null = global, admin), name, transport ENUM(stdio,http), command?, args TEXT[], url?, env_ciphertext BYTEA?, enabled)   -- env is opaque vendor config → encrypted jsonb
tool_catalog(name PK, source ENUM(builtin,mcp), mcp_server_id FK?, description, input_schema jsonb, permission ENUM(read,write,exec,network), enabled)   -- schema is inherently JSON Schema

conversations(id, project_id FK, title, agent_definition_id FK, model_id? , credential_mode?, status ENUM(idle,running,stopped,error))
messages(id, conversation_id FK, role ENUM(system,user,assistant,tool), seq INT, status ENUM(streaming,complete,stopped,error), model_id?, parent_message_id? (for regenerate), UNIQUE(conversation_id, seq))
message_parts(id, message_id FK, seq INT, kind ENUM(text,reasoning,tool_call,tool_result,error), text TEXT?, tool_name?, tool_call_id?, arguments jsonb? (validated against tool schema), result_text TEXT?, is_error BOOL?)

sandboxes(id, project_id FK UNIQUE, container_id, network_id, volume_name, status ENUM(creating,running,stopped,failed,removed), cpu, mem_mb, disk_mb, started_at?, stopped_at?)
executions(id, sandbox_id FK, conversation_id?, message_part_id?, kind ENUM(shell,test,preview,git,fs), command TEXT, exit_code INT?, started_at, finished_at?, timed_out BOOL, stdout_bytes, stderr_bytes)
execution_logs(id, execution_id FK, stream ENUM(stdout,stderr), seq INT, chunk TEXT, at)
test_runs(id, execution_id FK, framework, total INT?, passed INT?, failed INT?, summary TEXT)
preview_ports(id, sandbox_id FK, port INT, label, UNIQUE(sandbox_id, port))

usage_records(id, user_id FK, project_id?, conversation_id?, message_id?, provider_id FK, model_id FK, credential_source ENUM(byok,shared,subscription_cli), user_key_id?, shared_key_grant_id?, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens?, estimated_cost_usd NUMERIC?, duration_ms, status ENUM(ok,error,rate_limited,timeout,blocked_quota,blocked_cap), error_code?, at)
  -- indexes: (user_id, at), (project_id, at), (shared_key_grant_id, at)
audit_log(id, actor_user_id?, action, target_type, target_id, ip, at)
```

Quota enforcement reads `SUM(estimated_cost_usd)` from `usage_records` for the grant over the current UTC day/month inside the pre-flight transaction with `SELECT … FOR UPDATE` on the grant row to avoid races between concurrent requests.

---

## 5. Tech stack and justification

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | TypeScript everywhere, strict, ESM | Your constraint; shared types between API/UI/tests. | — |
| Monorepo | pnpm workspaces + Turborepo-free (plain pnpm `-r` scripts) | Minimal tooling; one lockfile. | Nx/Turbo: unnecessary. |
| API | Node 22 + **Fastify** 5 + Zod schemas → OpenAPI | Fast, typed, plugin model fits per-route authz hooks, native SSE. | NestJS: heavy DI; Express: untyped, slower. Hono: fine but weaker ecosystem for SSE/multipart. |
| DB | **PostgreSQL 16** + **Drizzle ORM** with SQL migrations | Real relational schema, generated+hand-editable migrations, no runtime schema magic. | Prisma: migration drift, heavier runtime; SQLite: fine for one user but you have members and concurrent containers. |
| Auth | Hand-rolled sessions (argon2id, opaque token hashed in DB) | Full control over roles and rate-limiting; no third-party identity. Lucia is deprecated to a guide, which is what we follow. | Auth.js: OAuth-centric; Keycloak: operational overhead. |
| Secrets | AES‑256‑GCM envelope encryption; `MASTER_KEY` from env; per-user DEK | Key rotation without re-encrypting everything; no key in DB plaintext. | KMS: not available on a self-hosted box by default. |
| Frontend | **React 19 + Vite**, TanStack Router + Query, Tailwind + shadcn/ui, **Monaco**, **xterm.js**, `react-markdown` + `shiki` | Mature editor/terminal components; no SSR needed for an authenticated SPA. | Next.js: SSR adds nothing here and complicates SSE/preview proxying. |
| Streaming | SSE (server→client), REST (client→server) | Simpler than WebSockets through Caddy; stop/retry are plain POSTs. Terminal uses one WebSocket (bidirectional required). | — |
| Jobs | In-process async runs with DB-backed state; abort via `AbortController` | Single-server deployment; adding Redis/BullMQ is premature. Flagged in §7. | BullMQ: needs Redis; defer to Phase 2 if multi-agent needs it. |
| Sandbox | Docker Engine via **dockerode** through **docker-socket-proxy** | Required by brief; proxy limits privilege escalation. | gVisor/Firecracker: stronger but host-kernel dependent; offer as optional runtime flag `SANDBOX_RUNTIME=runsc`. |
| Sandbox image | Custom `sandbox-base` (Debian slim, Node 22, Python 3.12, git, common build tools, non-root user) | Covers typical web projects; admin can set per-project image. | — |
| Reverse proxy | **Caddy** | Automatic TLS (ACME or internal CA), HSTS, simple config, wildcard subdomains if Q4 = yes. | nginx: manual TLS. Traefik: more moving parts. |
| Provider SDKs | Official `@anthropic-ai/sdk`, `openai`, `@google/genai`; OpenRouter and generic use `openai` with `baseURL` | Correct tool-call and streaming semantics per vendor; thin adapters. | Vercel AI SDK: another abstraction on top of ours; hides usage/cost details we need. |
| MCP | `@modelcontextprotocol/sdk` client (stdio + streamable HTTP) | Official client; tools surface as `tool_catalog` rows. | — |
| Tests | **Vitest** (unit/integration), **Playwright** (E2E), Testcontainers-style Docker tests for isolation | Standard, fast. The mocked provider is a test-only adapter registered only when `NODE_ENV=test`, never shipped in the production registry. | — |
| Lint/format | ESLint (typescript-eslint strict) + Prettier; `tsc --noEmit` in CI script | Required by DoD. | Biome: fine too; ESLint has the stricter TS rules we want. |
| Logging | `pino` with a redaction list (`authorization`, `api_key`, `*.key`, `token`, cookies) | Structured JSON; redaction is built in. | — |

---

## 6. Subscription-CLI mode: compliance verdict per provider

Verified 2026‑10‑04 against the vendors' own documentation. This is my reading of published terms, not legal advice; re-verify before go-live.

### 6.1 Anthropic — Claude Code (Pro/Max) — **IN, with conditions**

Anthropic's "Legal and compliance" page states:
- OAuth is "intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- Third-party developers may not "route requests through Free, Pro, or Max plan credentials on behalf of their users" nor "collect, store, or intermediate Claude.ai credentials or session tokens".
- But explicitly: this does not "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code". Hosting requires the binary to be unmodified and no authentication method removed.
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."

Design that stays inside this:
- Install the **unmodified** `@anthropic-ai/claude-code` package in the `cli-runner` image. Never patch, never read `~/.claude/.credentials.json`, never pass its token to anything else.
- Login is done **by you, interactively**, once: `docker compose exec cli-runner claude login` (Anthropic's own flow). The platform stores nothing but a status flag (`cli_providers.login_state`).
- Only the admin can trigger runs; members get 403 at the route layer and never see the mode in the UI.
- Runs use `claude -p --output-format stream-json` with the project volume as `cwd`. This is Claude Code's documented headless/programmatic mode.
- Residual risk: "ordinary, individual usage" is undefined; a heavy agent workload through a web UI could be judged non-ordinary. You are the only user and it is your own subscription, which is the strongest possible position, but Anthropic "may enforce without prior notice". Fallback is one click: switch the project to your BYOK Anthropic key.

### 6.2 OpenAI — Codex CLI (ChatGPT Plus/Pro) — **IN, with conditions**

Codex auth docs: "Sign in with ChatGPT" is a first-class mode; headless servers are supported via `codex login --device-auth` (device code) or by copying `~/.codex/auth.json`; `codex exec --json` is the documented non-interactive mode; the docs say "Don't expose Codex execution in untrusted or public environments." OpenAI additionally announced (Sept 29, 2026) "Sign in with ChatGPT" for third-party apps with per-app caps — that program is for apps that integrate the official sign-in, not relevant to us because we never hold the credential.

Design: identical pattern — unmodified `@openai/codex`, admin logs in once via device code inside `cli-runner`, platform spawns `codex exec --json --cd /workspace`, admin only, no credential handling by the platform. The platform is private (invite-only, behind TLS), satisfying "not public".

### 6.3 Google — Gemini CLI (Google AI Pro/Ultra) — **CONDITIONAL — needs confirmation at Phase 1 start**

Conflicting signals: multiple sources report the personal-Google-account login path for Gemini CLI was discontinued on 2026‑06‑18, yet the official `geminicli.com` authentication and quota pages (dated 2026‑09‑18) still document Google-account sign-in with Google AI Pro (1,500 req/day) and Ultra (2,000 req/day) quotas, and headless mode "will use your existing authentication method, if an existing authentication credential is cached."

Design if it works: unmodified `@google/gemini-cli`, admin signs in once, runs via `gemini -p … --output-format stream-json`. I will implement the adapter behind the same `CliRunner` interface. If sign-in on a headless container fails at Phase 1 start, the Gemini CLI is left **disabled** with the reason written in `LIMITATIONS.md`, and Gemini remains fully available via API key.

### 6.4 What is explicitly NOT built
No token extraction, no proxying of consumer OAuth tokens through our `AIProvider` adapters, no sharing of the CLI runner with members, no "Sign in with X" flows inside our UI.

---

## 7. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Docker socket access = root on host.** A bug in the API could create privileged containers. | High | docker-socket-proxy with strict allowlist; API runs non-root; no bind mounts allowed; optional `runsc` runtime. Phase 1 isolation tests assert a host path is unreachable. |
| R2 | **Egress from sandboxes** can reach the host network / LAN / Docker API. | High | iptables DROP to host gateway and RFC1918 ranges per sandbox network (configurable); test asserts it. |
| R3 | **Subscription-CLI terms change** (Anthropic has already enforced twice in 2026; Gemini free path removed). | Medium | Isolated `CliRunner` module; one-switch fallback to BYOK; status page shows login state and last error. |
| R4 | **Cost estimation inaccuracy** → quota under/over-enforcement. Prices in registry go stale; cached-token pricing differs per vendor. | Medium | OpenRouter and OpenAI expose pricing/usage; Anthropic/Gemini seeded and admin-editable; enforcement uses *estimated* cost and the UI says so; shared-key quota also has a hard token ceiling option. |
| R5 | **Preview under a path prefix** breaks many dev servers (absolute asset URLs, HMR websockets). | Medium | See Q4: wildcard subdomain is the robust fix. |
| R6 | **Single-process runtime**: API restart kills in-flight agent runs. | Medium | Runs persist state per step; on restart they are marked `stopped` with a visible "resume" action. Acceptable for single-server. |
| R7 | **Model registry drift**: vendors rename/retire models. | Low | `available=false` on fetch miss; UI warns and offers nearest. |
| R8 | **Scope size.** Phase 1 as written is ~6–8 weeks of focused engineering for one person. The brief says "no placeholders". | High | §10 ordering delivers vertical slices; each slice is runnable. If you need to cut, §9 says what to cut. |
| R9 | **Password reset without SMTP** is a dead button, which your rules forbid. | Low | Admin-visible reset link fallback when SMTP is unset; documented. |
| R10 | **MCP servers run as subprocesses of the API** (stdio) — they execute on the host container, not in the sandbox. | Medium | Phase 1: stdio MCP servers only when admin-configured; HTTP MCP preferred; Phase 2 runs stdio MCPs inside the project sandbox. |

---

## 8. Open questions for you (answer before Phase 1)

- **Q1. Hosting target.** Single Linux VM with Docker, public hostname and DNS you control? Or LAN-only? This decides TLS (ACME vs internal CA) and Q4.
- **Q2. Sandbox runtime.** Plain `runc` (default) or do you accept installing gVisor (`runsc`) on the host for stronger isolation? I will make it a flag; the default matters for the isolation tests.
- **Q3. Egress policy default for members.** `egress` (needed for `npm install`) or `none`? I propose `egress` with host/LAN blocked.
- **Q4. Preview routing.** Do you have a wildcard DNS record (`*.agent.yourdomain`) and wildcard cert available? If yes, previews become `https://p-<projectId>-<port>.agent.yourdomain` (robust). If no, path-prefix proxy only (fragile for some frameworks; documented).
- **Q5. Password reset email.** Will you supply SMTP credentials? If not, the admin-page reset link is the only path.
- **Q6. Member BYOK scope.** Should members be allowed to add BYOK keys for *any* provider the admin has configured, or only those the admin enables for members? I propose: any configured provider.
- **Q7. Project sharing.** Should an `edit` share allow running commands in the owner's sandbox (it means their CPU/disk quota is spent by someone else)? I propose: `edit` = files + chat; execution still counts against the owner's limits and is logged with the actor.
- **Q8. Sandbox base image.** Node 22 + Python 3.12 + git. Anything else you will routinely need (Go, Rust, Java, Docker-in-Docker)? DinD is **excluded** by default for isolation reasons.
- **Q9. Gemini CLI.** If headless Google-account login proves unavailable, is it acceptable to ship Phase 1 with Claude Code + Codex only in subscription mode (DoD requires "one subscription-CLI provider")?
- **Q10. Repository layout.** The orphan branch currently contains only `apps/agent-draft/`. Confirm you want it to stay orphan (no shared history with `main`) rather than a normal branch off `main`.

---

## 9. Where I push back on the brief

1. **"Provider and model layer is highest priority" — agreed, but the sandbox is the critical path.** Adapters are a few hundred lines each; the sandbox manager, network isolation, preview proxy and their tests are where the schedule risk and security risk sit. I will build adapters first (they unblock the chat loop), but start sandbox work in parallel from day one.
2. **Three-panel IDE vs cto.new.** You asked to reproduce cto.new's functionality, then specified an IDE layout cto.new does not have. I will build what you specified; do not later judge the result against cto.new's actual chat-first UX. If you want parity with cto.new's shape, say so now and I will replace the right panel with a Files/Preview/Tasks view and keep editor+terminal as secondary tabs.
3. **Admin "no quotas" + "safety cap on by default".** These are consistent only if the cap is framed as a *circuit breaker*, not a quota: when hit, the run pauses with a one-click "raise cap and continue", never a silent block. Confirm.
4. **"Fetch model lists dynamically where the API allows."** Model lists are available from all five; **prices are not** from Anthropic, Gemini, or most OpenAI-compatible endpoints. Cost estimates for those are seeded values that will drift. Your shared-key quotas are only as accurate as the price table. Accept this or route members through OpenRouter, which reports exact cost per request.
5. **Workflow A with "two real providers and one subscription-CLI provider" as a DoD.** That requires your real keys and your logged-in CLI session on the target host. I cannot execute that from this environment; I will deliver the automated A–I suite against the mocked provider plus a scripted checklist for you to run A with real credentials. Please accept that split or provide a test account and host.
6. **"Relational schema, no catch-all JSON."** Three columns are inherently JSON: tool-call arguments (shape defined by the tool's JSON Schema), tool `input_schema` itself, and MCP server env maps. They are validated, bounded, and listed in §4. Anything else JSON is a defect.
7. **Phase 2 "email and calendar tools"** have no equivalent of a sandbox: an agent sending email from your account is an irreversible external action. When we get there, it needs a human-approval gate per action, like cto.new's "require approval" toggle. Noting now so the tool contract in Phase 1 carries a `requires_approval` flag from the start (a boolean column, not a hook into billing or tiers).

---

## 10. Phase 1 execution order and test mapping

Each step ends with running code and its tests.

1. **Scaffold**: pnpm workspace, `apps/api`, `apps/web`, `packages/{shared,providers,tools,db}`, Docker Compose (Caddy, api, web, postgres, docker-socket-proxy), `.env.example`, lint/typecheck scripts. Test: `docker compose up` serves a login page. → **I** (unauth denied) begins here.
2. **Auth & users**: sessions, invites, reset, rate limit, admin page skeleton, suspend. Tests: unit + API. → **I**, part of **F**.
3. **Providers & registry**: `AIProvider`, five adapters, registry sync, mocked test provider. Tests: unit per adapter (request shaping, stream parsing, tool-call parsing, usage extraction, error mapping). → **B**, **C**.
4. **Credentials**: BYOK encrypt/validate/revoke; shared grants + quotas + allowlist; pre-flight gate. Tests: API. → **D**, **G**, **H**, **E**.
5. **Sandbox manager**: create/start/stop/exec/stream/timeout/cleanup; networks; limits; preview proxy. Tests: isolation suite (host FS unreachable, cross-user unreachable, timeout enforced). → **F** (containers).
6. **Tool registry + agent runtime**: tools, MCP client, agent loop, SSE, stop/retry/regenerate. Tests: tool registry unit; agent loop with mocked provider.
7. **Workspace UI**: three panels, Monaco, xterm, preview iframe, usage dashboards, admin pages. Tests: Playwright → **A** end-to-end.
8. **Subscription-CLI runner**: `cli-runner` image, `CliRunner` interface, Claude Code + Codex (+ Gemini if Q9 permits), status page, admin-only guards. Tests: adapter parsing on recorded fixtures; 403 for members → **H**.
9. **Hardening & docs**: redaction audit, error taxonomy, README, LIMITATIONS.md, final lint/typecheck/test run, report.

---

## References

- cto.new home and pricing: https://cto.new/ · https://cto.new/pricing
- cto.new docs index and pages: https://docs.cto.new/llms.txt · Headquarters, Tasks, Files, Settings, Models, MCP Integrations, GitHub, Fair use, Premium, Changelog (all under https://docs.cto.new/)
- Third-party coverage of cto.new's 2025 launch and 2026 freemium shift: https://aijourn.com/cto-new-raises-5-7m-to-launch-worlds-first-completely-free-ai-coding-agent/ · https://www.saasworthy.com/product/cto-new
- Anthropic, Claude Code "Legal and compliance" (authentication and credential use; hosting Claude Code): https://code.claude.com/docs/en/legal-and-compliance
- Anthropic Consumer Terms: https://www.anthropic.com/legal/consumer-terms · Commercial Terms: https://www.anthropic.com/legal/commercial-terms
- Coverage of Anthropic's 2026 enforcement against third-party OAuth use: https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546
- OpenAI Codex authentication (ChatGPT sign-in, device auth, headless, credential storage): https://learn.chatgpt.com/docs/auth (redirect from https://developers.openai.com/codex/auth)
- OpenAI "Sign in with ChatGPT" for third-party tools (DevDay, 2026‑09‑29): https://thenewstack.io/sign-in-with-chatgpt/
- Gemini CLI authentication: https://geminicli.com/docs/get-started/authentication/ · Quotas and pricing: https://geminicli.com/docs/resources/quota-and-pricing/
- Reports of Gemini CLI personal free-tier discontinuation (2026‑06‑18): https://facta.dev/blog/gemini-cli-free-tier-shutdown · https://overbrilliant.com/gemini-cli-free-tier/
