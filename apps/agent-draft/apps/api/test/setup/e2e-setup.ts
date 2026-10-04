import { execSync } from 'node:child_process';

// E2E tests need Postgres and a Docker daemon with the sandbox image built.
const image = process.env.SANDBOX_IMAGE ?? 'agent-sandbox-base:latest';
try {
  execSync(`docker image inspect ${image}`, { stdio: 'ignore' });
} catch {
  throw new Error(`Sandbox image ${image} is missing. Build it with: docker build -t ${image} infra/sandbox`);
}
