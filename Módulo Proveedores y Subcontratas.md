# Módulo Proveedores y Subcontratas

## Descripción

Módulo de gestión integral de proveedores y subcontratas para el ERP DINTEL. Este módulo centraliza la información de los proveedores (con sus datos fiscales y de contacto), el seguimiento de contratos de subcontrata por obra, y el control de documentación de Prevención de Riesgos Laborales (PRL) necesaria para la operativa en las construcciones.

El módulo está diseñado como un bounded context dentro del monolito modular, con aislamiento mediante `company_id` y relaciones con el módulo de Obras (proyectos) y el módulo de Certificaciones para la imputación de costes.

## Endpoints API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/proveedores` | Listar proveedores con filtros opcionales (empresa, activo/inaactivo) |
| `GET` | `/proveedores/:id` | Obtener datos completos de un proveedor por su UUID |
| `POST` | `/proveedores` | Dar de alta un nuevo proveedor o subcontrata (valida CIF/NIF único por empresa) |
| `PATCH` | `/proveedores/:id` | Actualizar datos del proveedor (razón social, categoría, retención, etc.) |
| `DELETE` | `/proveedores/:id` | Eliminación lógica del proveedor (bloqueado si tiene contratos activos) |
| `POST` | `/proveedores/:id/documentos-prl` | Subir y registrar documentación PRL (plan seguridad, seguro RC, certificado SS, etc.) |

## Integraciones Principales

### Módulo Obras (Proyectos)
- Un proveedor puede tener **varios contratos** en **distintas obras**
- Los contratos de subcontrata incluyen: número de contrato, fechas, importe total, importe ejecutado, % ejecutado, retención de garantía
- Los importes ejecutados se imputan automáticamente al módulo de certificaciones

### Módulo Certificaciones
- El campo `importeEjecutado` y `pctEjecutado` en `contratos_subcontrata` se utilizan para:
  - Calcular el `% certificado` acumulado en las certificaciones a origen
  - Detectar desviaciones entre lo presupuestado y lo ejecutado por subcontrata
  - Generar alertas si la retención de garantía no se ha liberado correctamente

### Módulo Compliance/PRL
- Documentación PRL obligatoria antes de autorizar cualquier operación financiera con el proveedor
- Validación automática de documentos vencidos y próximos a vencer (alertas a 30 días)
- Bloqueo de `assertCanTransact` si la documentación PRL no está vigente

### Módulo Contactos
- Los proveedores/subcontratas están vinculados a un registro `contacts` central
- El campo `requiresCompliance: true` marca al contacto como sujeto a homologación PRL
- Los datos fiscales (CIF/NIF) se validan y unicen en la tabla `proveedores`

## Dominio y Reglas de Negocio

### Estados de Proveedor
- `activo`: Proveedor disponible para nuevas contrataciones y operaciones
- `inactivo` (por eliminación lógica): Proveedor sin contratos activos, visible solo en históricos

### Estados de Contrato de Subcontrata
- `borrador`: Contrato en preparación, no ha comenzado la obra
- `activo`: Ejecución en curso de la obra contratada
- `completado`: Obra finalizada, pendiente de liquidación final
- `cancelado`: Contrato dado de baja antes de tiempo

### Documentación PRL Bloqueante
Los siguientes tipos de documentos bloquean las operaciones financieras si no están presentes y vigentes:
- `plan_seguridad`: Plan de seguridad y salud de la obra
- `seguro_rc`: Seguro de responsabilidad civil
- `certificado_ss`: Certificado de condiciones de seguridad
- `itinerario_formativo`: Itinerario formativo del trabajador
- `epi`: Equipo de protección individual

### Retención de Garantía
- Cada proveedor puede tener una retención de garantía por defecto (configurable, típicamente 5%)
- Los contratos heredan la retención del proveedor, pero pueden sobreescribirse
- La liberación de la retención está condicionada a la vigencia de la documentación PRL
- Se generan vencimientos diferenciados: ordinario (importes por cobrar) y retención (diferida, típicamente 1 año)

## Tablas de Base de Datos

### `proveedores`
- Datos maestros del proveedor/subcontrata
- CIF/NIF (único por empresa)
- Datos de contacto y condiciones de pago
- Retención de garantía por defecto

### `contratos_subcontrata`
- Contratos vinculados a una obra específica
- Seguimiento de importe ejecutado vs. total
- Porcentaje ejecutado a origen
- Fechas de inicio/fín prevista y real

### `documentos_prl`
- Historial de documentación de prevención por proveedor
- Control de fechas de emisión y vencimiento
- Estado: vigente, proximo_vencimiento, vencido, rechazado

## Checklist de Implementación

- [x] Esquema Drizzle ORM (`proveedores`, `contratos_subcontrata`, `documentos_prl`)
- [x] DTOs de validación class-validator (`CreateProveedorDto`, `UpdateProveedorDto`, `UploadDocumentoPRLDto`)
- [x] Controller NestJS con rutas CRUD y subida de documentos
- [x] Service con lógica de negocio (validaciones, verificación PRL, relaciones)
- [x] Módulo NestJS exportando servicio
- [x] Documentación en Obsidian con diagrama ERD
- [x] Tests unitarios y E2E — lógica pura en `proveedores.test.ts` (8 tests, Fase 11) y guard de compliance en `prl-guard.e2e-spec.ts` (5 tests, 14-sep-2026 noche: pedido y factura de compra, con y sin ficha, con y sin PRL vencido)
- [ ] Integración con módulo de certificaciones (importe ejecutado → certificación)
- [x] Integración con módulo compliance/PRL — `assertAptoParaPago()` enlazado en `PurchaseOrdersService.create()` e `InvoicesService.approve()` (14-sep-2026, noche, Fase 11); las alertas de vencimiento siguen siendo solo las de homologación general (`GET /cumplimiento/alertas`, en `contacts`), no hay un equivalente todavía para `documentos_prl`
- [ ] Configuración de retenciones de garantía por defecto por empresa