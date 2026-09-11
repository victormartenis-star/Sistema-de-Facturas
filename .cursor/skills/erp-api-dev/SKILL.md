---
name: erp-api-dev
description: >-
  Arranque, build y depuración de la API NestJS en erp-dintel.
  Usar cuando falle el arranque, decoradores Nest, puerto 3001,
  o el usuario pida levantar/reparar apps/api.
---

# ERP API Dev

Raíz de trabajo: `erp-dintel/`.

## Arranque correcto

```bash
npm run build:packages   # si cambió packages/*
npm run db:seed          # solo si no hay empresa
npm run dev:api          # tsc watch + node --watch (Windows OK)
```

Producción local ya compilada: `npm run start -w @erp/api`.

## Prohibido

- `npx tsx watch apps/api/src/main.ts` — emite decoradores Stage 3; NestJS rompe con `Cannot read properties of undefined (reading 'value')` en `@Get()` / request-mapping.

## Requisitos Nest

- `experimentalDecorators` + `emitDecoratorMetadata` en `apps/api/tsconfig.json`.
- Entry con `import 'reflect-metadata'` en `apps/api/src/main.ts`.
- Puerto: `API_PORT` o `3001`. Env: `erp-dintel/.env` (`DATABASE_URL`, etc.).

## Smoke test

```bash
# PowerShell
Invoke-WebRequest http://localhost:3001/categories -UseBasicParsing
Invoke-WebRequest http://localhost:3001/projects -UseBasicParsing
```

Esperado: HTTP 200. Si falla conexión a BD → seed / `.\infra\bd.ps1` (Postgres nativo en equipo `victo`, no Docker).
