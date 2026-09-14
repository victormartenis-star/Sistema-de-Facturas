# syntax=docker/dockerfile:1
#
# Build multietapa para la API (NestJS). El monorepo usa npm workspaces sin
# Turborepo, así que no hay una herramienta de "prune" que calcule qué
# necesita cada app; el patrón aquí es: instalar todo con devDependencies
# (deps), compilar (builder) y podar devDependencies ya con el build hecho
# (runner) — sin volver a tocar la red.
#
# Node 22, no 20: el monorepo fija `"engines": { "node": ">=22" }` en el
# package.json raíz.

# ── deps ─────────────────────────────────────────────────────────────────
# Se copian los package.json de los 6 workspaces (no solo los que usa la
# API): `npm ci`/`npm prune` necesitan ver el grafo completo del monorepo
# para que el resultado sea consistente con package-lock.json. Copiar solo
# manifiestos (no el código) deja esta capa en caché mientras no cambien
# las dependencias.
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

# ── builder ──────────────────────────────────────────────────────────────
# shared y db se compilan antes: la API importa su dist, no su fuente (ver
# CLAUDE.md). Este stage conserva devDependencies a propósito:
# docker-compose.staging.yml lo usa también como `target` del servicio
# `migrate`, que necesita `drizzle-kit`.
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build:packages && npm run build -w @erp/api

# ── runner ───────────────────────────────────────────────────────────────
# Imagen final de producción: sin devDependencies, sin fuente TypeScript de
# las apps que no hacen falta, usuario sin privilegios (`node`, ya viene
# creado en la imagen base node:alpine — no hace falta darlo de alta).
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app ./

# Poda devDependencies (typescript, drizzle-kit, concurrently…) ya con el
# build hecho, y quita lo que esta imagen no necesita para arrancar:
# el frontend, el MCP, los tests E2E y el código fuente ya compilado.
# drizzle/ (migraciones SQL) no hace falta aquí: las aplica el servicio
# `migrate` aparte, no la propia API al arrancar.
RUN npm prune --omit=dev \
  && rm -rf apps/web apps/mcp apps/e2e \
    packages/shared/src packages/db/src packages/db/drizzle \
  && mkdir -p /app/storage \
  && chown -R node:node /app

USER node

EXPOSE 3001

# Sin curl/wget en la imagen base: el healthcheck usa Node directamente.
# GET /auth/me sin token da 401 — respuesta esperada, confirma que la API
# está viva y enrutando (no hay un endpoint /health dedicado).
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3001/auth/me',r=>process.exit(r.statusCode===401?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
