/**
 * Las tablas de este módulo (`proveedores`, `contratos_subcontrata`,
 * `documentos_prl`) viven en `packages/db/src/schema.ts`, junto con el resto
 * del esquema — es el único sitio de la app que define tablas Drizzle (ver
 * `apps/api/src/modules/comparativos`, que sigue el mismo patrón). Este
 * fichero se conserva como redirección para no romper imports existentes.
 */
export * from '@erp/db';
