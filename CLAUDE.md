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
- Compilar el servidor MCP: `npm run build -w @erp/mcp` (arrancar suelto: `npm run start -w @erp/mcp`)

## Calidad
- La aritmética del dinero vive en `packages/shared/src/calculo.ts`: funciones **puras**, sin base de datos y sin leer el reloj (la fecha entra como parámetro). Toda regla nueva de cálculo se añade ahí y se prueba ahí.
- Un cambio en el cálculo económico no se da por bueno sin un test que falle antes y pase después.
- `npm run verify` debe estar en verde antes de cada commit; el CI (`.github/workflows/ci.yml`) lo repite y además aplica las migraciones sobre una base vacía.

## Arquitectura y Reglas
- Monorepo npm workspaces: Next.js (Frontend en `apps/web`) y NestJS (API en `apps/api`), con paquetes compartidos `packages/shared` (esquemas Zod y tipos) y `packages/db` (esquema y migraciones).
- `apps/mcp` expone el ERP como herramientas MCP para agentes. **Habla siempre por la API HTTP, nunca contra Postgres**: así se aplican las validaciones, la numeración y el cálculo económico. Sus esquemas de entrada se importan de `@erp/shared`; no se duplican DTOs ahí.
- El ORM es **Drizzle** (no Prisma): esquema en `packages/db/src/schema.ts`, migraciones SQL en `packages/db/drizzle/`.
- La base de datos es PostgreSQL en `pgdata-erp` (BD `erp_dev`, usuario `erp`).
- Todo el código debe estar en español y usar componentes con Tailwind CSS.
- La documentación de diseño (`01-arquitectura.md` … `06-hoja-de-ruta.md`) es el contrato de alcance; el esquema sigue `02-base-de-datos.md`.

## Entornos de desarrollo

Hay dos montajes distintos; comprueba en cuál estás antes de seguir las rutas.

### Equipo con toolchain portátil (usuario sin permisos de administrador)
- Node portable v24: añadir `C:\Users\Victor\Tools\node-v24.18.0-win-x64` al `Path` de la sesión.
- PostgreSQL 16.9 portable: no auto-arranca al reiniciar; arrancar con
  `C:\Users\Victor\Tools\pgsql\bin\pg_ctl.exe -D C:\Users\Victor\Tools\pgdata-erp -l C:\Users\Victor\Tools\pgdata-erp\server.log -w start`

### Equipo `victo` (instalación con servicio; verificado el 2026-08-30)
- Node v24.19 en `C:\Program Files\nodejs`, ya en el `Path`. Las rutas portátiles
  de arriba **no existen en esta máquina**.
- PostgreSQL 16.15 como servicio `postgresql-x64-16`: arranca solo al reiniciar.
  `psql.exe` no está en el `Path`; vive en `C:\Program Files\PostgreSQL\16\bin`.
- Atajos de base de datos: `.\infra\bd.ps1 up | crear | migrate | seed | psql | reset -Confirmar`.
  El script detecta solo si usar el Postgres nativo o el contenedor de `infra/docker/`.
- **En este equipo se trabaja con el PostgreSQL nativo, no con Docker.** WSL 2.7 está
  instalado y operativo, pero el motor de Docker no arranca: el EDR corporativo
  (Panda Advanced EPDR) deja los sockets AF_UNIX de Docker en un estado en el que ni
  su propietario puede borrarlos, y el backend muere al recrearlos
  (`remove ...\Docker\run\sailor-ingest.sock: El sistema no tiene acceso al archivo`).
  Se reproduce en `AppData\Local\Docker\run` y en `AppData\Local\docker-secrets-engine`,
  y sobrevive al reinicio. No se arregla en local: IT debe excluir las rutas y procesos
  de Docker en la consola de Panda. Hasta entonces `bd.ps1` usa el nativo, que es lo
  correcto aquí. No pierdas tiempo reinstalando Docker ni WSL: no es ahí el problema.
