#!/usr/bin/env node
/**
 * Servidor MCP del ERP de DINTEL.
 *
 * Expone el ERP como herramientas para un agente. Todo pasa por la API HTTP
 * (apps/api): asi el agente queda sujeto a las mismas reglas de negocio que la
 * interfaz web, y no hay una segunda copia del calculo economico que mantener.
 *
 * Transporte stdio: stdout es el canal del protocolo. Cualquier traza va a
 * stderr; un console.log aqui corrompe la sesion MCP.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BASE_URL } from './api';
import { registrarObras } from './tools/obras';
import { registrarFacturas } from './tools/facturas';
import { registrarContactos } from './tools/contactos';
import { registrarAlbaranes } from './tools/albaranes';
import { registrarPedidos } from './tools/pedidos';
import { registrarTesoreria } from './tools/tesoreria';
import { registrarCumplimiento } from './tools/cumplimiento';
import { registrarPresupuestos } from './tools/presupuestos';
import { registrarCertificaciones } from './tools/certificaciones';
import { registrarDashboard } from './tools/dashboard';
import { registrarInformes } from './tools/informes';
import { registrarDocumentos } from './tools/documentos';
import { registrarLineasCertificacion } from './tools/lineas_certificacion';
import { registrarAuditoria } from './tools/auditoria';
import { registrarSubcontratas } from './tools/subcontratas';
import { registrarContabilidad } from './tools/contabilidad';
import { registrarActivos } from './tools/activos';
import { registrarAlmacen } from './tools/almacen';
import { registrarMargenes } from './tools/margenes';
import { registrarAprobaciones } from './tools/aprobaciones';
import { registrarHolding } from './tools/holding';
import { registrarSolicitudesMaterial } from './tools/solicitudes-material';
import { registrarWip } from './tools/wip';
import { registrarAvales } from './tools/avales';
import { registrarCierre } from './tools/cierre';
import { registrarCartera } from './tools/cartera';
import { registrarCompras } from './tools/compras';
import { registrarTalonesProyecto } from './tools/talones-proyecto';
import { registrarBanca } from './tools/banca';
import { registrarEam } from './tools/eam';

async function main() {
  const server = new McpServer({
    name: 'erp-dintel',
    version: '0.3.0',
  });

  registrarObras(server);
  registrarContactos(server);
  registrarFacturas(server);
  registrarPedidos(server);
  registrarAlbaranes(server);
  registrarTesoreria(server);
  registrarCumplimiento(server);
  registrarPresupuestos(server);
  registrarCertificaciones(server);
  registrarDashboard(server);
  registrarInformes(server);
  registrarDocumentos(server);
  registrarLineasCertificacion(server);
  registrarAuditoria(server);
  registrarSubcontratas(server);
  registrarContabilidad(server);
  registrarActivos(server);
  registrarAlmacen(server);
  registrarMargenes(server);
  registrarAprobaciones(server);
  registrarHolding(server);
  registrarSolicitudesMaterial(server);
  registrarWip(server);
  registrarAvales(server);
  registrarCierre(server);
  registrarCartera(server);
  registrarCompras(server);
  registrarTalonesProyecto(server);
  registrarBanca(server);
  registrarEam(server);

  await server.connect(new StdioServerTransport());
  console.error(`[erp-mcp] conectado. API: ${BASE_URL}`);
}

main().catch((e) => {
  console.error('[erp-mcp] fallo al arrancar:', e);
  process.exit(1);
});
