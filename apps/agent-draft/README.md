# BACK_LOG — self-hosted AI coding-agent platform (draft)

A private workspace where an AI agent plans, edits files, runs commands and tests inside an isolated
Docker sandbox per project, and shows the result in a live preview. One admin, optional invited members.
No sign-up, billing, plans or tiers. Branch: `draft/ai-agent-platform` (orphan, never merged to `main`).

## Quick start

Requirements: Linux host with Docker (Compose v2). A DNS name if you want public HTTPS.

```bash
cp .env.example .env
openssl rand -base64 32          # put the result in MASTER_KEY
$EDITOR .env                     # set POSTGRES_PASSWORD, MASTER_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, PUBLIC_URL
docker compose up --build -d
```

Open `PUBLIC_URL` (default http://localhost:8080) and sign in as `ADMIN_EMAIL`.
Then: **Settings → API keys** (add a provider key), pick a model in the chat header, describe what to build.

For HTTPS on a server: set `SITE_ADDRESS=agent.example.com` and `PUBLIC_URL=https://agent.example.com`,
open ports 80/443. Caddy obtains certificates automatically. Plain HTTP is only accepted on localhost.

### Subscription CLIs (admin only, optional)

Runs the vendors' unmodified CLIs headless under **your own** login. The platform never reads or stores
their credentials; the login lives in the `agent-cli-home` Docker volume.

```bash
docker compose --profile cli build cli-runner
docker compose run --rm cli-runner claude                    # then /login
docker compose run --rm cli-runner codex login --device-auth
docker compose run --rm cli-runner gemini                    # Login with Google
# set CLI_RUNNER_ENABLED=true in .env, restart api, then Admin → Subscriptions → Check status → Enable
```

Check each vendor's current terms before using a subscription this way; see `PLAN.md` §6 and `LIMITATIONS.md`.

### MCP servers

Admin API (UI comes in Phase 2): `POST /api/admin/mcp-servers`
`{"name":"fetch","transport":"stdio","command":"npx","args":["-y","some-mcp"],"env":{"TOKEN":"…"}}` or
`{"transport":"http","url":"https://…"}`. Tools appear as `mcp__<server>__<tool>` under Admin → Tools.
Members get no MCP tool unless you allow it per member. stdio servers run in the API container.

## Develop

```bash
pnpm install
# Postgres on :5432 and a Docker daemon are required for the integration tests
docker build -t agent-sandbox-base:latest infra/sandbox
pnpm lint && pnpm typecheck
pnpm test                 # provider adapters + API unit tests
pnpm test:e2e             # workflows A–I (real Postgres, real sandboxes, scripted model)
pnpm test:sandbox         # isolation tests against the Docker daemon (+ CLI runner if its image exists)
pnpm --filter @agent/web test:ui    # browser test (Chromium via PW_CHROMIUM_PATH)
```

Env for tests: `TEST_DATABASE_ADMIN_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`).

## Architecture

```
browser ── Caddy (TLS, static web, /api, /preview) ── api (Fastify)
                                                       ├─ Postgres (Drizzle migrations)
                                                       ├─ providers: Anthropic, OpenAI, Gemini, OpenRouter, OpenAI-compatible
                                                       ├─ agent runtime + tool registry (built-in + MCP)
                                                       ├─ docker-socket-proxy ── Docker ── sandbox per project (own volume,
                                                       │                                      per-user network, no host mounts)
                                                       └─ cli-runner containers (admin only, subscription mode)
```

- `packages/shared` contracts (zod) · `packages/providers` the `AIProvider` interface and adapters (no vendor logic elsewhere)
- `apps/api` auth, credentials, metering, sandbox manager, tools, agent runtime, routes · `apps/web` React UI
- Model registry, agents, tool catalog, limits and quotas live in the database, not in code.
- Credential sources: own key (BYOK), admin-shared key with per-member quotas/allowlist, subscription CLI (admin).
- Every route requires a session unless marked public; project resources are owner-scoped (404 for others).

## Schema and migrations

`apps/api/src/db/schema/*` → `apps/api/drizzle/*.sql` (`pnpm db:generate`). Migrations and an idempotent seed
(providers, models, primary agent, bootstrap admin) run on API start. Only two columns are JSON:
tool-call arguments and tool input schemas (MCP env is stored encrypted).
