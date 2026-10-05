# Limitations and gaps

Honest list for Phase 1. "cto.new" refers to what its site and docs describe as of 2026-10-04.

## Not verified in this build (needs your credentials or host)
- **Real providers.** Adapters are unit-tested against recorded wire formats and workflows A–I run with a scripted model.
  Nothing was run against live Anthropic/OpenAI/Gemini/OpenRouter endpoints. Use the checklist in `docs/MANUAL-CHECKS.md`.
- **Subscription CLIs with a login.** The runner, parsers and failure paths are tested with the unmodified binaries and no login.
  A logged-in run needs your account. Parsers follow the vendors' documented JSON formats; vendors can change them.
- **`docker compose up` end to end.** The compose file and Caddyfile validate, but the full stack was not booted here
  (Docker Hub rate-limited image pulls in the build environment). The API, web bundle and sandboxes were run directly.
- **Gemini CLI** sign-in on a headless container is unconfirmed (sources conflict about the free path ending in 2026).

## Product gaps versus cto.new
- No multi-agent teams, hiring, kanban of tasks, lead agent, marketplace (Phase 2 / out of scope).
- No GitHub/GitLab, PRs, branches from remote repos; git works only on the project's local repo.
- No web browsing/search, email, calendar, scheduling, webhooks, Stripe, site publishing, mobile builds.
- No "Auto model" router, no chat compaction (old turns are dropped when the context fills), no image attachments, no slash commands.
- No MCP management UI; admin API only. MCP stdio servers run in the API container, not in a sandbox.
- No tool-approval prompts (the `requiresApproval` flag exists but nothing sets it).

## Technical limits
- **Costs are estimates.** Only OpenRouter reports exact cost and prices. Others use admin-editable registry prices that drift.
  Models without prices cannot be used on shared keys; their cost shows as unknown. Subscription runs record tokens, never cost.
- **Quota races.** Per-grant checks lock the grant row, but one in-flight request can overshoot a quota by its own cost.
- **Single API process.** Active runs are in memory; restarting the API stops them. Run history is kept.
- **Previews** use path-prefixed signed URLs; apps that hardcode absolute `/assets` paths may break (configure a base path).
  Wildcard-subdomain previews are not implemented.
- **Isolation** is Docker (runc) with dropped capabilities, read-only root, per-user networks and a host firewall script.
  It is not a VM boundary; for hostile members install gVisor and set `SANDBOX_RUNTIME=runsc` (untested here).
  The firewall rules live in the host kernel and are applied by the `sandbox-firewall` compose service; they are not
  reapplied after a host reboot until compose runs again.
- Disk limit is checked before commands and writes, not enforced by the filesystem; a single command can exceed it.
- Sandbox files persist in a Docker volume; there is no backup or export.
- Shared project edit access can run commands in the owner's sandbox, billed to the owner's limits.
- Interactive terminal sessions are logged by metadata only (bytes are stored as output chunks; keystrokes are not).
- Users are created by the admin with a generated one-time password (username = email) that must be replaced at first sign-in; the admin copies the invite text and sends it by hand. No email is sent and there is no email verification. The older token-link invite endpoints still exist in the API but are not used by the UI.

## Decisions taken without your answer to the open questions
Single VM behind Caddy; runc default; egress allowed with host/LAN blocked; path-prefix previews; admin-visible reset
links without SMTP; members may use any configured provider with their own key; edit shares spend the owner's limits;
Node+Python sandbox image; Gemini CLI optional; branch kept orphan.
