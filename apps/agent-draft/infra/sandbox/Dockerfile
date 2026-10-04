# Base image for per-project sandboxes. Runs as uid 1000 with a read-only root
# filesystem; /workspace is a named volume and /tmp, $HOME are tmpfs.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git ca-certificates curl python3 python3-venv python3-pip procps coreutils \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /workspace /home/sandbox \
 && chown 1000:1000 /workspace /home/sandbox

ENV HOME=/home/sandbox \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_USER=1

USER 1000:1000
WORKDIR /workspace
CMD ["sleep", "infinity"]
