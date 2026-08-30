# Reglas del ERP de Construcción

## Comandos Útiles
- Iniciar Web: `cd apps/web && npm run dev` (o `npm run dev:web` desde la raíz)
- Iniciar API: `cd apps/api && npm run dev` (o `npm run dev:api` desde la raíz)
- Migrar BD: `npm run db:migrate` (Drizzle Kit; generar migraciones: `npm run db:generate`, seed: `npm run db:seed`)
- Compilar paquetes compartidos: `npm run build:packages` (necesario antes de arrancar la API tras cambiar `packages/*`)
- Typecheck de todo el monorepo: `npm run typecheck`
- Lint: `npm run lint` (arreglar: `npm run lint:fix`) · Formato: `npm run format` / `npm run format:check`
- Tests: `npm test` (en desarrollo: `npm run test:watch -w @erp/shared`)
- **Todo junto, lo mismo que ejecuta el CI: `npm run verify`**

## Seguridad
- La API **deniega por defecto**: la guarda global exige sesión y el endpoint que deba ser abierto se marca con `@Public()`. Un endpoint nuevo sin decorar queda protegido, que es el fallo barato.
- Los permisos se comprueban por **capacidad** (`@RequireCapability`), nunca comparando roles.
- Roles = puestos del organigrama del manual de procesos, no una escala genérica.
- Ocultar algo en la interfaz no es una medida de seguridad: si un dato no debe verse, la API no debe devolverlo.
- `JWT_SECRET` es obligatoria en producción (mínimo 32 caracteres).

## Calidad
- La aritmética del dinero vive en `packages/shared/src/calculo.ts`: funciones **puras**, sin base de datos y sin leer el reloj (la fecha entra como parámetro). Toda regla nueva de cálculo se añade ahí y se prueba ahí.
- Un cambio en el cálculo económico no se da por bueno sin un test que falle antes y pase después.
- `npm run verify` debe estar en verde antes de cada commit; el CI (`.github/workflows/ci.yml`) lo repite y además aplica las migraciones sobre una base vacía.

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
