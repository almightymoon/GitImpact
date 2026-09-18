FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY cli ./cli
RUN pnpm install --frozen-lockfile

FROM base AS build
RUN pnpm build:packages && pnpm --filter @gitimpact/web build && pnpm --filter @gitimpact/worker build

FROM node:20-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
# Runtime image has no corepack/pnpm — invoke Next via the workspace symlink.
CMD ["node", "./node_modules/next/dist/bin/next", "start", "-p", "3000"]

FROM node:20-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
# Worker must be able to clone repositories (static analysis only — never npm install).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
