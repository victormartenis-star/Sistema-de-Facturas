/**
 * Validación XSD de Facturae en los e2e: reutiliza el validador de producción
 * (`src/invoices/facturae-xsd.ts`) para no duplicar esquemas ni lógica.
 */
export { validarFacturaeXsd as validateFacturaeXsd } from '../../src/invoices/facturae-xsd';
