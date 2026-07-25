# Reglas del ERP de Construcción

## Comandos Útiles
- Iniciar Web: `cd apps/web && npm run dev` (o `npm run dev:web` desde la raíz)
- Iniciar API: `cd apps/api && npm run dev` (o `npm run dev:api` desde la raíz)
- Migrar BD: `npm run db:migrate` (Drizzle Kit; generar migraciones: `npm run db:generate`, seed: `npm run db:seed`)
- Compilar paquetes compartidos: `npm run build:packages` (necesario antes de arrancar la API tras cambiar `packages/*`)
- Typecheck de todo el monorepo: `npm run typecheck`

## Arquitectura y Reglas
- Monorepo npm workspaces: Next.js (Frontend en `apps/web`) y NestJS (API en `apps/api`), con paquetes compartidos `packages/shared` (esquemas Zod y tipos) y `packages/db` (esquema y migraciones).
- El ORM es **Drizzle** (no Prisma): esquema en `packages/db/src/schema.ts`, migraciones SQL en `packages/db/drizzle/`.
- La base de datos es PostgreSQL en `pgdata-erp` (BD `erp_dev`, usuario `erp`).
- Todo el código debe estar en español y usar componentes con Tailwind CSS.
- La documentación de diseño (`01-arquitectura.md` … `06-hoja-de-ruta.md`) es el contrato de alcance; el esquema sigue `02-base-de-datos.md`.

## Entorno de este PC (usuario sin permisos de administrador)
- Node portable v24: añadir `C:\Users\Victor\Tools\node-v24.18.0-win-x64` al `Path` de la sesión.
- PostgreSQL 16.9 portable: no auto-arranca al reiniciar; arrancar con
  `C:\Users\Victor\Tools\pgsql\bin\pg_ctl.exe -D C:\Users\Victor\Tools\pgdata-erp -l C:\Users\Victor\Tools\pgdata-erp\server.log -w start`
