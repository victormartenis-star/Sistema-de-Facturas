# syntax=docker/dockerfile:1
#
# Build multietapa para el frontend (Next.js), aprovechando
# `output: 'standalone'` (apps/web/next.config.ts): Next traza qué archivos
# de node_modules usa de verdad en tiempo de ejecución y genera su propio
# node_modules mínimo — a diferencia de la API, aquí no hace falta podar
# devDependencies a mano.

# ── deps ─────────────────────────────────────────────────────────────────
# Mismos 6 manifiestos que en apps/api/Dockerfile: ver el comentario allí.
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
FROM node:22-alpine AS builder
WORKDIR /app

# NEXT_PUBLIC_* se incrusta en el JS del navegador durante `next build`, no
# en tiempo de ejecución: hay que pasarlo como build arg (docker-compose
# `build.args`, leído de .env.staging), no basta con la variable de entorno
# del contenedor ya arrancado. Ver CI-CD y Despliegue Staging.md.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY --from=deps /app ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
# shared se compila antes: el "main" de su package.json apunta a dist/, y
# Next lo resuelve por ahí aunque esté en transpilePackages.
RUN npm run build -w @erp/shared && npm run build -w @erp/web

# ── runner ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# El standalone de Next para un monorepo replica la ruta de la app dentro
# del árbol del repo (detecta la raíz por outputFileTracingRoot): el
# resultado trae ya su propio node_modules mínimo y apps/web/server.js.
# @erp/shared no aparece aparte porque transpilePackages lo compila e
# incrusta directamente en los chunks — comprobado con un build real fuera
# de Docker antes de escribir este Dockerfile, ver [[CI-CD y Despliegue
# Staging]]. `.next/static` se copia aparte a propósito: el modo
# standalone no lo incluye solo (documentado así por Next).
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3000/login',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
