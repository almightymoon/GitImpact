FROM node:20-bookworm-slim AS base
WORKDIR /app
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
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]

FROM node:20-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
