# API image: builds the workspace packages and runs the Fastify server with tsx-free compiled JS is not
# possible for workspace TS sources, so the server runs through tsx (pinned in dependencies).
FROM node:22-bookworm-slim AS base
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/providers/package.json packages/providers/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @agent/api...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api

FROM base AS run
ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 4000
USER node
CMD ["node", "--import", "tsx", "src/main.ts"]
