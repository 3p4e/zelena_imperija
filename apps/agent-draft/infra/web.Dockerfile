FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/providers/package.json packages/providers/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @agent/web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @agent/web exec vite build

FROM caddy:2-alpine
COPY --from=build /app/apps/web/dist /srv
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
