# syntax=docker/dockerfile:1
#
# Imagen del servidor MCP. Transporte stdio (ver [[Módulo MCP & Cerebro]]):
# no expone ningún puerto ni corre como servicio de red — se invoca de
# forma puntual con stdin/stdout conectados (`docker compose run -i mcp`),
# no como un contenedor de fondo. En docker-compose.staging.yml está detrás
# del perfil `tools`, así que `docker compose up` no lo arranca solo.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/e2e/package.json apps/e2e/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/shared ./packages/shared
COPY apps/mcp ./apps/mcp
RUN npm run build -w @erp/shared && npm run build -w @erp/mcp

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app ./
RUN npm prune --omit=dev \
  && rm -rf apps/web apps/api apps/e2e packages/db packages/shared/src

USER node

# Sin EXPOSE: no hay puerto que publicar (stdio, no HTTP).
CMD ["node", "apps/mcp/dist/index.js"]
