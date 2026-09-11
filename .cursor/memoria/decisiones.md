# Decisiones del Proyecto

## Cerradas
- **API solo con `tsc` + Node, no `tsx`:** NestJS requiere `experimentalDecorators`; `tsx` emite decoradores Stage 3 y rompe el arranque.
- **MCP habla por HTTP a `apps/api`, nunca a Postgres directo:** validaciones, numeración y cálculo económico pasan por la API.
- **ORM = Drizzle** (no Prisma). Esquema en `packages/db/src/schema.ts`.
- **Equipo `victo`:** PostgreSQL nativo (servicio), no Docker (bloqueado por EDR).

## Abiertas
- (ninguna pendiente de entorno; siguiente capa = producto)
