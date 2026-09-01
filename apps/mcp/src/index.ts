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

async function main() {
  const server = new McpServer({
    name: 'erp-dintel',
    version: '0.1.0',
  });

  registrarObras(server);
  registrarContactos(server);
  registrarFacturas(server);
  registrarPedidos(server);
  registrarAlbaranes(server);
  registrarTesoreria(server);
  registrarCumplimiento(server);

  await server.connect(new StdioServerTransport());
  console.error(`[erp-mcp] conectado. API: ${BASE_URL}`);
}

main().catch((e) => {
  console.error('[erp-mcp] fallo al arrancar:', e);
  process.exit(1);
});
