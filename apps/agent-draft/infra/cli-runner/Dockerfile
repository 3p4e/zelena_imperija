# Official vendor CLIs, installed unmodified from npm, for the admin-only
# subscription mode. Login state lives in the volume mounted at /home/cli and is
# created by the admin through each vendor's own interactive login flow:
#   docker compose run --rm cli-runner claude                      (then /login)
#   docker compose run --rm cli-runner codex login --device-auth
#   docker compose run --rm cli-runner gemini                      (Login with Google)
FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION=latest
ARG CODEX_VERSION=latest
ARG GEMINI_CLI_VERSION=latest

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl python3 procps ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@openai/codex@${CODEX_VERSION}" \
      "@google/gemini-cli@${GEMINI_CLI_VERSION}" \
 && npm cache clean --force \
 && mkdir -p /home/cli /workspace \
 && chown 1000:1000 /home/cli /workspace

ENV HOME=/home/cli
USER 1000:1000
WORKDIR /workspace
CMD ["bash"]
