import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuditIntegrityReportDto } from '@erp/shared';
import { pedir } from '../api';
import { ejecutar } from '../comun';

export function registrarAuditoria(server: McpServer) {
  /**
   * Verifica la cadena hash de auditoría de la empresa.
   *
   * `GET /audit/verify-integrity` no recibe parámetros (la empresa sale del
   * token), así que no hay esquema de entrada en `@erp/shared` que importar:
   * `inputSchema` va vacío. El tipo de la respuesta sí viene de `@erp/shared`.
   */
  server.registerTool(
    'verify_audit_integrity',
    {
      title: 'Verificar la integridad de la auditoría',
      description:
        'Recorre la cadena hash del registro de auditoría de la empresa y ' +
        'dice si es íntegra. Devuelve `integra`; si no lo es, también ' +
        '`primerPuntoRoto` con la secuencia, el motivo y el detalle. ' +
        'Requiere un token con rol admin (otros roles reciben 403).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      ejecutar(async () => {
        const r = await pedir<AuditIntegrityReportDto>(
          '/audit/verify-integrity',
        );
        if (r.integra) {
          return {
            integra: true,
            entradasVerificadas: r.entradasVerificadas,
            ultimaSecuencia: r.ultimaSecuencia,
            verificadoEn: r.verificadoEn,
          };
        }
        return {
          integra: false,
          entradasVerificadas: r.entradasVerificadas,
          verificadoEn: r.verificadoEn,
          primerPuntoRoto: r.primerPuntoRoto
            ? {
                secuencia: r.primerPuntoRoto.sequenceNumber,
                motivo: r.primerPuntoRoto.motivo,
                detalle: r.primerPuntoRoto.detalle,
                esperado: r.primerPuntoRoto.esperado,
                encontrado: r.primerPuntoRoto.encontrado,
              }
            : null,
        };
      }),
  );
}
