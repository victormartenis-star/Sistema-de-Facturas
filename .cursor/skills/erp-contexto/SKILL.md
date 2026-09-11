---
name: erp-contexto
description: >-
  Orienta al agente en el monorepo ERP Dintel antes de codificar.
  Usar al empezar una sesión, al pedir contexto/estado/siguiente paso,
  o antes de cambios de arquitectura en erp-dintel.
---

# ERP Contexto

## Checklist (en orden)

1. Leer `.cursor/memoria/estado-actual.md` y `.cursor/memoria/decisiones.md`.
2. Si hace falta detalle de arquitectura/comandos: `erp-dintel/CLAUDE.md`.
3. Confirmar stack afectado: `apps/api` | `apps/web` | `apps/mcp` | `packages/shared` | `packages/db`.
4. Responder en ≤3 frases: estado, bloqueo (si hay), siguiente paso.
5. Tras un hito: actualizar solo `.cursor/memoria/estado-actual.md` (y `decisiones.md` si se cierra una decisión).

## Qué NO hacer

- No inventar estado: si la memoria está vacía o contradictoria, dilo.
- No meter estado largo en `.cursor/rules/` (las rules solo apuntan a memoria).
- No usar `npx tsx` para la API NestJS → skill `erp-api-dev`.
