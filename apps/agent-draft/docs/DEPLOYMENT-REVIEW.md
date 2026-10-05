# ANVIL — deployment review (KVM4, 2026-10-05)

Live at https://anvil.srv1231216.hstgr.cloud (Hostinger VPS 1231216, Traefik, Let's Encrypt).

## How it was deployed
1. `infra/deploy/docker-compose.build.yml` (project `anvil_build`): one-shot builder that builds
   `agent-sandbox-base`, `anvil-api`, `anvil-web` from the public repo; ends with `BUILD_DONE`. Removed afterwards.
2. `infra/deploy/docker-compose.traefik.yml` (project `anvil`): runtime stack using the local images
   (`pull_policy: never`). Env: `PUBLIC_HOST`, `POSTGRES_PASSWORD`, `MASTER_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
   Hostinger's Docker manager pulls but never builds, hence the two phases.

## Verified on the live stack
- HTTPS with a valid certificate; admin login; `/api/admin/settings` reachable.
- Sandbox: uid 1000, CapEff 0. From inside it the host's :22/:443, another stack's published port, the Docker
  proxy and the metadata address were all unreachable; outbound internet works (by design).
- Sandbox defaults lowered for the shared host: admin 1 CPU/1 GB/4 GB/2 containers; member 0.5 CPU/512 MB/2 GB/1 container.

## Not verified
- Real model calls (the DeepSeek key available in the environment was invalid).
- Subscription CLIs (disabled on this deployment); load with many concurrent users on the shared host.

## Follow-ups
- Set the repository back to private after each build (it was public only so the builder could clone).
- Rotate the Hostinger API credential that was printed in an earlier session.
- Change the generated admin password on first login; never commit `MASTER_KEY` / passwords.
- Upgrade path: redeploy the build stack, then redeploy `anvil`.
