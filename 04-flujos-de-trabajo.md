# 05 · Stack Tecnológico Recomendado

Criterios de elección: un solo lenguaje principal (TypeScript) para minimizar el coste de equipo, tecnologías maduras con gran comunidad, y servicios gestionados para todo lo que no sea el core del negocio.

## Stack principal

| Capa | Tecnología | Por qué |
|---|---|---|
| **Frontend** | **Next.js 15 (React 19) + TypeScript** | SSR para carga rápida, un solo framework para web/PWA, ecosistema enorme. |
| UI | **Tailwind CSS + shadcn/ui** | Interfaz moderna tipo Notion/Linear con poco esfuerzo; componentes accesibles y personalizables. |
| Estado/datos | **TanStack Query + Zustand** | Caché de servidor declarativa, optimistic updates (validación de facturas fluida). |
| Tablas y gráficos | **TanStack Table + Recharts** | Tablas virtuales para miles de facturas; gráficos del dashboard. |
| Visor documental | **pdf.js** + visor de imágenes propio | Vista previa con resaltado de zonas extraídas. |
| **Backend** | **NestJS (Node 22 + TypeScript)** | Arquitectura modular que casa 1:1 con los bounded contexts; DI, guards (RBAC), OpenAPI generado. |
| ORM | **Prisma** (o Drizzle) | Migraciones versionadas, tipos end-to-end con el frontend. |
| Validación | **Zod** (compartido front/back) | Un único esquema de validación para API y formularios. |
| **Base de datos** | **PostgreSQL 16** + `pgvector` + `pg_trgm` + `unaccent` | Transaccional + full-text + semántico en un solo motor: menos piezas. |
| Cola / caché | **Redis + BullMQ** | Pipeline OCR asíncrono, reintentos, prioridades, cron jobs. |
| Ficheros | **S3 / Cloudflare R2** (región UE, versionado) | Durabilidad 11 nueves, URLs firmadas, Object Lock. |
| **IA - extracción** | **Claude API (visión + tool use)** — modelo `claude-sonnet-5` para extracción/clasificación, `claude-haiku-4-5` para tareas simples de bajo coste | Extracción estructurada de facturas heterogéneas con JSON Schema estricto; mejor relación precisión/esfuerzo que entrenar OCR propio. |
| IA - OCR texto completo | **Tesseract 5** (self-host, gratis) o **Azure Document Intelligence** (si se requiere más precisión) | Texto íntegro para el buscador full-text. |
| IA - embeddings | Voyage AI / text-embedding multilingüe | Búsqueda semántica de documentos. |
| Banca | **GoCardless Bank Account Data** (ex-Nordigen) | Agregación bancaria PSD2 en España con coste bajo. |
| Email entrante/saliente | **Postmark / SES** + inbound webhooks | Buzón de facturas y envío de avisos/informes. |
| Exportación | **exceljs** (xlsx) + **Playwright/Chromium headless** (PDF desde plantillas HTML) | Informes idénticos a lo que se ve en pantalla. |
| **Infra** | **Docker + GitHub Actions**; Railway/Render al inicio → AWS ECS después | CI/CD simple, coste inicial < 100 €/mes. |
| Observabilidad | **Sentry + logs estructurados (pino) + Better Stack** | Errores y uptime desde el día 1. |
| Auth | Propia (JWT + Argon2 + TOTP) o **Keycloak** si se prefiere delegar | Control total del RBAC por obra. |

## Alternativas consideradas (y por qué no)

| Opción | Motivo de descarte |
|---|---|
| Microservicios desde el inicio | Sobrecarga operativa injustificada para un equipo pequeño; el monolito modular permite extraer servicios más tarde. |
| Python/Django o FastAPI como backend único | Válido, pero rompe el "un solo lenguaje" con el frontend; el ecosistema TS cubre todo el dominio. Python queda como opción para un microservicio de ML futuro. |
| Odoo como base | Personalizar Odoo a este flujo documental-IA cuesta más que construir a medida, y ata a su modelo de datos y licencias. |
| OCR propio entrenado (LayoutLM etc.) | Coste alto de datos etiquetados; los LLM de visión actuales lo superan sin entrenamiento. Reevaluar solo si el coste por documento se dispara. |
| Elasticsearch para el buscador | PostgreSQL FTS + pgvector cubre el volumen esperado (decenas de miles de documentos); una pieza menos que operar. |
| MongoDB | El dominio es fuertemente relacional (facturas↔vencimientos↔pagos↔obras); se necesitan transacciones y agregaciones SQL. |

## Estimación de costes de operación (fase inicial)

| Concepto | Coste mensual aprox. |
|---|---|
| Hosting PaaS (API + workers + frontend) | 40–80 € |
| PostgreSQL gestionado | 20–50 € |
| S3/R2 (100 GB + tráfico) | 5–15 € |
| Claude API (~2.000 facturas/mes con Sonnet visión) | 30–80 € |
| Agregador bancario | 0–50 € |
| Email transaccional + monitorización | 15–30 € |
| **Total** | **≈ 110–300 €/mes** |

## Estructura de repositorio propuesta (monorepo)

```
sistema-facturas/
├── apps/
│   ├── web/                  # Next.js (frontend PWA)
│   ├── api/                  # NestJS (API REST + módulos de dominio)
│   └── workers/              # Procesos BullMQ (OCR, alertas, informes, banca)
├── packages/
│   ├── shared/               # Tipos, esquemas Zod, utilidades comunes
│   ├── db/                   # Esquema Prisma + migraciones + seeds
│   └── ai/                   # Prompts, JSON Schemas de extracción, clientes LLM
├── infra/
│   ├── docker/               # Dockerfiles + docker-compose para desarrollo
│   └── github/               # Workflows CI/CD
└── docs/                     # Esta documentación
```
