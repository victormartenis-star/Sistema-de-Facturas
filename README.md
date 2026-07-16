# Sistema de Facturas · ERP de Gestión Integral para Construcción

Plataforma en la nube que centraliza toda la información económica, administrativa y documental de una empresa de construcción: facturas con lectura automática por OCR/IA, tesorería, control de costes por obra, presupuestos, certificaciones, compras, dashboard financiero y copiloto de inteligencia artificial.

## Documentación de diseño

| Documento | Contenido |
|---|---|
| [01 · Arquitectura](01-arquitectura.md) | Visión general, monolito modular, pipeline OCR/IA, seguridad, infraestructura, backups |
| [02 · Base de datos](02-base-de-datos.md) | Modelo entidad-relación, esquema SQL completo, vistas del dashboard, estrategia del buscador |
| [03 · Módulos](03-modulos.md) | Los 10 módulos funcionales y la matriz de permisos por rol |
| [04 · Flujos de trabajo](04-flujos-de-trabajo.md) | Circuitos de gasto, ingreso, compras, ciclo mensual y procesos automáticos |
| [05 · Stack tecnológico](05-stack-tecnologico.md) | Tecnologías recomendadas, alternativas descartadas, costes de operación, estructura del repo |
| [06 · Hoja de ruta](06-hoja-de-ruta.md) | Plan de 12 meses en 5 fases, criterios de salida, métricas y riesgos |

## Resumen ejecutivo

- **La obra es el eje**: todo ingreso, gasto y documento se imputa a una obra; coste, margen y desviación presupuesto vs. real en tiempo real.
- **El documento es la fuente de verdad**: las facturas entran por web, foto de móvil o email; un pipeline con LLM de visión (Claude) extrae número, fecha, proveedor, base, IVA, total y forma de pago, las clasifica en 8 categorías y detecta duplicados y errores; un humano valida en segundos.
- **Tesorería viva**: vencimientos automáticos, conciliación bancaria (PSD2), caja, flujo de caja proyectado a 90 días y alertas de liquidez.
- **Ciclo completo de construcción**: presupuestos (import BC3) → certificaciones a origen → factura de venta → cobro; pedidos → albaranes → factura con cuadre a 3 bandas.
- **Inteligencia**: buscador full-text + semántico, informes automáticos exportables a Excel/PDF, y copiloto que responde preguntas en lenguaje natural con los permisos de cada usuario.
- **Stack**: Next.js + NestJS (TypeScript), PostgreSQL (+pgvector), Redis/BullMQ, S3, Claude API — PWA accesible desde PC, móvil y tablet, con backups automáticos.

## Roles

`admin` · `gerente` · `administracion` · `obra` (acceso restringido a sus obras asignadas). Matriz completa en [03 · Módulos](03-modulos.md).
