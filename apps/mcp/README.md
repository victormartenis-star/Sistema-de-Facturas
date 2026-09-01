# @erp/mcp — servidor MCP del ERP

Expone el ERP como herramientas para un agente (Claude Code, Claude Desktop o
cualquier cliente MCP). 26 herramientas sobre obras, contactos, facturas,
pedidos, albaranes, tesorería y cumplimiento.

## Por qué pasa por la API y no por la base de datos

Todas las herramientas llaman a la API HTTP de `apps/api`. Es más lento que ir a
Postgres directamente, y es deliberado: por la API pasan las validaciones, la
numeración y el cálculo económico. Dos ejemplos reales de la prueba de
aceptación:

```
aprobar_factura -> [409] No se puede aprobar: la factura de compra no tiene
                   albaranes asociados. Vincula los albaranes validados.

validar_albaran -> [422] Pendiente de validación. Falta número de pedido.
```

Con acceso directo a la base ninguna de las dos reglas se habría aplicado, y el
agente habría dejado el ERP en un estado que la interfaz web considera inválido.

Por el mismo motivo los esquemas de entrada se importan de `@erp/shared` en vez
de reescribirse aquí (`invoiceCreateSchema`, `purchaseOrderCreateSchema`, ...).
Los mensajes de validación que ve el agente son los mismos que ve el usuario en
la web, y cuando cambie un DTO el `typecheck` de este paquete falla en vez de
quedarse desincronizado en silencio.

## Uso

Requiere la API levantada y la base migrada:

```bash
npm run db:migrate
npm run db:seed        # la API falla sin una empresa creada
npm run build -w @erp/api && npm run start -w @erp/api
```

Compilar y arrancar el MCP:

```bash
npm run build -w @erp/mcp
npm run start -w @erp/mcp
```

En Claude Code no hace falta arrancarlo a mano: el `.mcp.json` de la raíz lo
lanza solo al abrir el proyecto.

## Configuración

| Variable      | Por defecto             | Para qué                 |
| ------------- | ----------------------- | ------------------------ |
| `ERP_API_URL` | `http://localhost:3001` | Base de la API del ERP   |

## Herramientas

**Obras** · `buscar_obras` · `obra_detalle` (obra + partidas + desviación en una
llamada) · `crear_obra`

**Contactos** · `buscar_contactos` · `crear_contacto` · `listar_categorias`

**Facturas** · `listar_facturas` · `factura_detalle` · `crear_factura` ·
`aprobar_factura` · `pagar_factura` · `anular_factura`

**Pedidos** · `listar_pedidos` · `pedido_detalle` · `crear_pedido` ·
`cerrar_pedido` · `anular_pedido` · `trazabilidad`

**Albaranes** · `listar_albaranes` · `crear_albaran` · `validar_albaran`

**Tesorería** · `vencimientos` · `prevision_caja` · `marcar_vencimiento_pagado`

**Cumplimiento** · `cumplimiento_subcontratas` · `cumplimiento_contacto`

### Lo que el agente no decide

Los importes no se envían: `crear_factura` recibe las líneas y la API calcula
base, IVA, retención y líquido. Con `isp: true` la cuota de IVA es cero y aplica
la leyenda del art. 84.Uno.2º.f).

El número de pedido tampoco se envía: la API asigna el correlativo propio de cada
obra (`OBR-045-PED-0001`), de modo que el número dice a qué obra pertenece sin
consultarlo en otro sitio.

## Nota sobre el transporte

Es stdio: **stdout es el canal del protocolo**. Cualquier traza va a `stderr`.
Un `console.log` en este paquete corrompe la sesión MCP.
