# 04 · Flujos de Trabajo

Los cuatro circuitos operativos que cubren el día a día de una constructora, más los procesos automáticos de fondo.

## F1 · Circuito de gasto (factura de compra)

```mermaid
flowchart LR
    A["📥 Entrada<br/>(web · foto móvil · email · API)"] --> B["🤖 OCR + IA<br/>extracción y clasificación"]
    B --> C{"¿Avisos?<br/>duplicado · descuadre · NIF"}
    C -- sí --> D["⚠️ Bandeja con avisos<br/>revisión obligatoria"]
    C -- no --> E["📋 Bandeja de validación"]
    D --> E
    E --> F["👤 Administración valida<br/>(corrige campos, asigna obra y categoría)"]
    F --> G["🧾 Factura contabilizada<br/>+ vencimientos generados"]
    G --> H["🔗 Cuadre con albaranes/pedidos<br/>(3-way match)"]
    G --> I["📊 Coste imputado a obra<br/>margen actualizado en tiempo real"]
    G --> J["💰 Pago (manual o conciliado<br/>con extracto bancario)"]
    J --> K["✅ Pagada"]
```

Reglas:
- Un documento nunca se convierte en apunte económico sin validación humana (salvo que el usuario active auto-validación para extracciones con confianza > 98% y sin avisos).
- La factura vencida sin pagar pasa automáticamente a `vencida` y genera alerta.
- El rol `obra` puede subir la foto del ticket/albarán; la validación económica queda siempre en `administracion`/`gerente`.

## F2 · Circuito de ingreso (presupuesto → certificación → cobro)

```mermaid
flowchart LR
    A["📐 Presupuesto<br/>(capítulos y partidas, import BC3)"] --> B{"¿Aprobado<br/>por el cliente?"}
    B -- no --> A2["Nueva versión"] --> A
    B -- sí --> C["🏗️ Obra en curso<br/>(presupuesto = línea base de coste)"]
    C --> D["📏 Certificación mensual<br/>(avance a origen por partida)"]
    D --> E{"¿Aprobada por<br/>dirección facultativa?"}
    E -- no --> D
    E -- sí --> F["🧾 Factura de venta generada<br/>(con retención de garantía)"]
    F --> G["📤 Envío al cliente<br/>+ vencimiento de cobro"]
    G --> H{"¿Cobrada al<br/>vencimiento?"}
    H -- sí --> I["✅ Cobro conciliado"]
    H -- no --> J["⚠️ Alerta de cobro vencido<br/>+ reclamación"]
    J --> H
    I --> K["🔓 Devolución de retenciones<br/>al fin de garantía (aviso automático)"]
```

## F3 · Circuito de compras (pedido → albarán → factura)

```mermaid
flowchart LR
    A["🛒 Pedido<br/>(desde oficina o móvil en obra)"] --> B["📧 Enviado al proveedor"]
    B --> C["🚚 Entrega en obra"]
    C --> D["📸 Albarán fotografiado<br/>por el encargado (rol obra)"]
    D --> E["🤖 OCR: líneas y cantidades<br/>casadas contra el pedido"]
    E --> F{"¿Cantidades y precios<br/>coinciden?"}
    F -- no --> G["⚠️ Incidencia de recepción<br/>(falta material / precio distinto)"]
    F -- sí --> H["✅ Recepción confirmada"]
    G --> H
    H --> I["🧾 Llega la factura del proveedor"]
    I --> J["🔗 3-way match automático<br/>pedido ↔ albaranes ↔ factura"]
    J --> K{"¿Cuadra?"}
    K -- sí --> L["Validación exprés"]
    K -- no --> M["⚠️ Bloqueada: diferencia detectada<br/>(se reclama abono al proveedor)"]
```

## F4 · Ciclo mensual de gestión

| Día | Proceso | Automático / Manual |
|---|---|---|
| Continuo | Entrada y validación de documentos; conciliación bancaria diaria | Mixto |
| Día 1 | Refresco de cierre del mes anterior; **informe mensual automático** (P&L, IVA, obras) enviado a gerencia | Automático |
| Días 1-5 | Certificaciones de obra del mes anterior → facturas de venta | Manual asistido |
| Día 5 | Aviso de vencimientos de la semana + previsión de caja a 30/60/90 | Automático |
| Días 15/20 | Revisión de desviaciones presupuesto vs. real por obra (alertas si > umbral) | Automático |
| Trimestre | Export libro de IVA + facturas para la asesoría (Excel/PDF) | Automático programable |

## F5 · Procesos automáticos de fondo (workers)

| Worker | Disparo | Acción |
|---|---|---|
| `ocr-extraction` | Evento `documento.subido` | OCR + extracción + clasificación + dedupe |
| `alerts-due` | Cron diario 07:00 | Vencidos e impagados → alertas + email |
| `cashflow-forecast` | Cron diario + al registrar pagos | Recalcula proyección de caja; alerta si < umbral |
| `bank-sync` | Cron cada 6h | Descarga movimientos PSD2 y propone conciliaciones |
| `budget-deviation` | Al imputar coste a obra | Recalcula desviación por capítulo; alerta si > X% |
| `monthly-report` | Cron día 1 | Genera y envía informe de cierre (PDF/Excel) |
| `backup-verify` | Cron semanal | Comprueba integridad de backups y restauración de muestra |
| `retention-reminder` | Cron diario | Avisa de retenciones de garantía recuperables |

## F6 · Estados y transiciones clave

```mermaid
stateDiagram-v2
    direction LR
    state "Documento" as doc {
        [*] --> subido
        subido --> procesando
        procesando --> extraido
        procesando --> error
        extraido --> validado
        extraido --> rechazado
        error --> procesando : reintento
    }
```

```mermaid
stateDiagram-v2
    direction LR
    state "Factura" as inv {
        [*] --> pendiente_validacion
        pendiente_validacion --> validada
        validada --> parcialmente_pagada
        validada --> vencida : vence sin pago
        vencida --> parcialmente_pagada
        parcialmente_pagada --> pagada
        validada --> pagada
        pendiente_validacion --> anulada
        validada --> anulada : rectificativa
    }
```
