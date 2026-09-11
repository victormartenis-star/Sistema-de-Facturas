# Estado Actual del Proyecto

## Sesión (11/09/2026)
- **Estado:** API NestJS OK en http://localhost:3001. `categories.controller` fuente + `.d.ts` regenerados correctamente.
- **Fix categories / build API:** `apps/api/tsconfig.json` ahora extiende `tsconfig.base.json` (`strict`/`strictNullChecks`). Sin eso, Drizzle colapsaba los tipos de insert y `tsc` fallaba en muchos services (no en categories).
- **NO usar:** `npx tsx watch apps/api/src/main.ts` (rompe `@Get()` en categories). Usar `npm run dev:api`.
- **No editar** `dist/**/*.d.ts` a mano: se regeneran con `npm run build -w @erp/api`.
- **Obsidian (`ERP de cosntruccion/`):** eliminadas notas duplicadas; wikilinks canónicos. `Base de Datos Drizzle.md` = 15 tablas de `schema.ts` con índice tabla→módulo + campos/enums. `NestJS Backend.md` = 12 controladores reales (rutas sin `/api`, query params, tablas y `[[Módulo …]]`).
- **Siguiente paso:** Definir primera tarea de producto o `npm run dev:web`.
