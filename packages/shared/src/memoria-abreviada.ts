/**
 * Memoria abreviada (PGC, modelo abreviado) y exportación de las cuentas
 * anuales, al estilo de SAP Financial Statement / Oracle BI Publisher.
 *
 * La memoria se construye con datos ya calculados (balance, PyG, ECPN, EFE,
 * aplicación del resultado) más los movimientos del ejercicio de las masas
 * que la memoria desglosa (inmovilizado, amortización, provisiones) y las
 * garantías comprometidas con terceros (avales). Todo es puro y en céntimos
 * `BigInt`; la exportación es determinista (mismo contenido → mismo texto y
 * misma huella).
 */

import type {
  CuentasAnualesCalculo,
  EstadoFlujosEfectivo,
  FilaEcpn,
  OrigenMovimientoPn,
} from './calculo';
import { centsToNumeric, fromCents, mulDivRound, toCents } from './dinero';
import { jsonCanonico } from './json-canonico';

type Importe = string | number;

/* ───────────────────── movimientos de una masa en el ejercicio ───────────────────── */

export interface MovimientoMasa {
  /** Saldo de apertura (asiento de apertura del ejercicio). */
  inicial: number;
  /** Aumentos del ejercicio (debe en activo, haber en pasivo). */
  aumentos: number;
  /** Disminuciones del ejercicio. */
  disminuciones: number;
  final: number;
}

/**
 * Movimiento de una masa con los movimientos del ejercicio por origen (sin
 * regularización ni cierre). `naturaleza`: deudora (activo) o acreedora
 * (pasivo, amortización acumulada, provisiones).
 */
export function movimientoMasa(
  movimientos: readonly {
    cuenta: string;
    origen: OrigenMovimientoPn | 'cierre';
    debe: Importe;
    haber: Importe;
  }[],
  incluye: (cuenta: string) => boolean,
  naturaleza: 'deudora' | 'acreedora',
): MovimientoMasa {
  let inicial = 0n;
  let aumentos = 0n;
  let disminuciones = 0n;
  for (const m of movimientos) {
    if (m.origen === 'cierre' || !incluye(m.cuenta)) continue;
    const d = toCents(m.debe);
    const h = toCents(m.haber);
    if (m.origen === 'apertura') {
      inicial += naturaleza === 'deudora' ? d - h : h - d;
      continue;
    }
    aumentos += naturaleza === 'deudora' ? d : h;
    disminuciones += naturaleza === 'deudora' ? h : d;
  }
  return {
    inicial: fromCents(inicial),
    aumentos: fromCents(aumentos),
    disminuciones: fromCents(disminuciones),
    final: fromCents(inicial + aumentos - disminuciones),
  };
}

/* ───────────────────── indicadores patrimoniales ───────────────────── */

export interface IndicadoresPatrimoniales {
  /** Activo corriente − pasivo corriente. */
  fondoManiobra: number;
  /** Activo corriente / pasivo corriente (null sin pasivo corriente). */
  liquidez: number | null;
  /** (Pasivo no corriente + corriente) / patrimonio neto (null con PN ≤ 0). */
  endeudamiento: number | null;
  /** Patrimonio neto / total activo, en % (null sin activo). */
  autonomiaPct: number | null;
}

export function indicadoresPatrimoniales(
  b: CuentasAnualesCalculo['balance'],
): IndicadoresPatrimoniales {
  const ac = toCents(b.activoCorriente.total);
  const pc = toCents(b.pasivoCorriente.total);
  const pn = toCents(b.patrimonioNeto.total);
  const pasivo = toCents(b.pasivoNoCorriente.total) + pc;
  const activo = toCents(b.totalActivo);
  const ratio = (a: bigint, d: bigint) =>
    d > 0n ? Number(mulDivRound(a, 100n, d)) / 100 : null;
  return {
    fondoManiobra: fromCents(ac - pc),
    liquidez: ratio(ac, pc),
    endeudamiento: ratio(pasivo, pn),
    autonomiaPct:
      activo > 0n ? Number(mulDivRound(pn, 10_000n, activo)) / 100 : null,
  };
}

/* ───────────────────── memoria abreviada ───────────────────── */

export interface NotaMemoria {
  numero: number;
  titulo: string;
  /** Párrafos del texto de la nota. */
  texto: string[];
  /** Cifras de la nota (clave → importe), en céntimos exactos como número. */
  cifras?: Record<string, number | null>;
}

export interface ComprobacionMemoria {
  clave: string;
  descripcion: string;
  ok: boolean;
}

export interface MemoriaAbreviada {
  notas: NotaMemoria[];
  indicadores: IndicadoresPatrimoniales;
  comprobaciones: ComprobacionMemoria[];
  /** Todas las comprobaciones de coherencia se cumplen. */
  coherente: boolean;
}

export interface GarantiasMemoria {
  emitidosNumero: number;
  emitidosSaldoVivo: Importe;
  recibidosNumero: number;
  recibidosSaldoVivo: Importe;
  comisionesDevengadas: Importe;
}

const eur = (v: number) =>
  `${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function memoriaAbreviada(p: {
  empresa: string;
  ejercicio: number;
  cuentas: CuentasAnualesCalculo;
  ecpn: { saldoFinal: FilaEcpn };
  efe: EstadoFlujosEfectivo;
  aplicacion: {
    estado: string;
    fecha: string;
    acuerdo: string;
    reparto: { cuenta: string; nombre: string; importe: number }[];
  } | null;
  inmovilizado: MovimientoMasa;
  amortizacionAcumulada: MovimientoMasa;
  provisiones: MovimientoMasa;
  garantias: GarantiasMemoria;
  capital: Importe;
}): MemoriaAbreviada {
  const { balance, pyg } = p.cuentas;
  const indicadores = indicadoresPatrimoniales(balance);
  const pn = toCents(balance.patrimonioNeto.total);
  const capital = toCents(p.capital);
  const notas: NotaMemoria[] = [
    {
      numero: 1,
      titulo: 'Actividad de la empresa',
      texto: [
        `${p.empresa} desarrolla la actividad de construcción y promoción de obras. Las cuentas anuales corresponden al ejercicio ${p.ejercicio} (1 de enero a 31 de diciembre).`,
      ],
    },
    {
      numero: 2,
      titulo: 'Bases de presentación',
      texto: [
        'Las cuentas anuales se han formulado a partir de los registros contables según el Plan General de Contabilidad (RD 1514/2007) en su modelo abreviado, para mostrar la imagen fiel del patrimonio, la situación financiera y los resultados.',
        'Los importes se expresan en euros con dos decimales; todos los cálculos se realizan en céntimos exactos.',
        'Los saldos se presentan antes de los asientos de regularización y cierre del ejercicio.',
      ],
    },
    {
      numero: 3,
      titulo: 'Aplicación de resultados',
      texto: p.aplicacion
        ? [
            `Resultado del ejercicio: ${eur(pyg.resultado)}. Aplicación ${p.aplicacion.estado} el ${p.aplicacion.fecha} (${p.aplicacion.acuerdo}):`,
            ...p.aplicacion.reparto.map(
              (r) => `${r.cuenta} ${r.nombre}: ${eur(r.importe)}`,
            ),
          ]
        : [
            `Resultado del ejercicio: ${eur(pyg.resultado)}. Pendiente de la propuesta y aprobación de su aplicación por la junta general.`,
          ],
      cifras: { resultado: pyg.resultado },
    },
    {
      numero: 4,
      titulo: 'Normas de registro y valoración',
      texto: [
        'Inmovilizado material: a coste de adquisición, amortizado linealmente según su vida útil desde la puesta en servicio (cuotas mensuales).',
        'Existencias: a precio medio ponderado (PMP), imputadas a la obra en su consumo.',
        'Contratos de construcción: ingresos por grado de avance (producción certificada); la obra ejecutada pendiente de facturar o facturada por anticipado se regulariza en 4309 / 4389.',
        'Contratos onerosos: la pérdida prevista se provisiona entera (4994) en cuanto se estima, descontada la ya reconocida por el grado de avance.',
        'Avales y garantías: riesgos contingentes sin reflejo en el balance; sus comisiones se devengan mes a mes por tramos de saldo y tasa.',
      ],
    },
    {
      numero: 5,
      titulo: 'Inmovilizado material',
      texto: [
        `Coste: saldo inicial ${eur(p.inmovilizado.inicial)}, altas ${eur(p.inmovilizado.aumentos)}, bajas ${eur(p.inmovilizado.disminuciones)}, saldo final ${eur(p.inmovilizado.final)}.`,
        `Amortización acumulada: saldo inicial ${eur(p.amortizacionAcumulada.inicial)}, dotaciones ${eur(p.amortizacionAcumulada.aumentos)}, bajas ${eur(p.amortizacionAcumulada.disminuciones)}, saldo final ${eur(p.amortizacionAcumulada.final)}.`,
      ],
      cifras: {
        costeFinal: p.inmovilizado.final,
        amortizacionFinal: p.amortizacionAcumulada.final,
        valorNeto: fromCents(
          toCents(p.inmovilizado.final) -
            toCents(p.amortizacionAcumulada.final),
        ),
      },
    },
    {
      numero: 6,
      titulo: 'Provisiones',
      texto: [
        `Provisiones (contratos onerosos y otras): saldo inicial ${eur(p.provisiones.inicial)}, dotaciones ${eur(p.provisiones.aumentos)}, aplicaciones y excesos ${eur(p.provisiones.disminuciones)}, saldo final ${eur(p.provisiones.final)}.`,
      ],
      cifras: { final: p.provisiones.final },
    },
    {
      numero: 7,
      titulo: 'Garantías comprometidas con terceros',
      texto: [
        `Avales emitidos a nuestro cargo vivos al cierre: ${p.garantias.emitidosNumero}, por ${eur(fromCents(toCents(p.garantias.emitidosSaldoVivo)))}.`,
        `Avales recibidos de terceros vivos al cierre: ${p.garantias.recibidosNumero}, por ${eur(fromCents(toCents(p.garantias.recibidosSaldoVivo)))}.`,
        `Comisiones de aval devengadas en el ejercicio: ${eur(fromCents(toCents(p.garantias.comisionesDevengadas)))}.`,
      ],
      cifras: {
        emitidosSaldoVivo: fromCents(toCents(p.garantias.emitidosSaldoVivo)),
        recibidosSaldoVivo: fromCents(toCents(p.garantias.recibidosSaldoVivo)),
      },
    },
    {
      numero: 8,
      titulo: 'Situación patrimonial e indicadores',
      texto: [
        `Patrimonio neto ${eur(fromCents(pn))} frente a un capital social de ${eur(fromCents(capital))}${pn < capital ? ': inferior al capital (art. 273.2 LSC)' : ''}${capital > 0n && pn * 2n < capital ? '; inferior a la mitad del capital (art. 363.1.e LSC)' : ''}.`,
        `Fondo de maniobra ${eur(indicadores.fondoManiobra)}; liquidez ${indicadores.liquidez ?? '—'}; endeudamiento ${indicadores.endeudamiento ?? '—'}; autonomía financiera ${indicadores.autonomiaPct === null ? '—' : `${indicadores.autonomiaPct} %`}.`,
      ],
      cifras: { ...indicadores },
    },
    {
      numero: 9,
      titulo: 'Flujos de efectivo',
      texto: [
        `Flujos de explotación ${eur(p.efe.explotacion.total)} (clientes ${eur(p.efe.explotacion.capitalCorrienteDesglose.clientes)}, proveedores ${eur(p.efe.explotacion.capitalCorrienteDesglose.proveedores)}), de inversión ${eur(p.efe.inversion)} y de financiación ${eur(p.efe.financiacion)}; variación del efectivo ${eur(p.efe.variacionEfectivo)}.`,
      ],
      cifras: { variacionEfectivo: p.efe.variacionEfectivo },
    },
  ];
  const comprobaciones: ComprobacionMemoria[] = [
    {
      clave: 'balance_cuadra',
      descripcion: 'Activo = patrimonio neto + pasivo',
      ok: balance.cuadra,
    },
    {
      clave: 'ecpn_balance',
      descripcion: 'Saldo final del ECPN = patrimonio neto del balance',
      ok: toCents(p.ecpn.saldoFinal.total) === pn,
    },
    {
      clave: 'ecpn_pyg',
      descripcion: 'Resultado del ECPN = resultado de la PyG',
      ok: toCents(balance.resultadoEjercicio) === toCents(pyg.resultado),
    },
    {
      clave: 'efe_tesoreria',
      descripcion: 'Flujos de efectivo = variación de tesorería (57x)',
      ok: p.efe.cuadra,
    },
    {
      clave: 'efe_desglose',
      descripcion: 'Desglose del capital corriente = capital corriente',
      ok:
        Object.values(p.efe.explotacion.capitalCorrienteDesglose).reduce(
          (t, v) => t + toCents(v),
          0n,
        ) === toCents(p.efe.explotacion.capitalCorriente),
    },
  ];
  return {
    notas,
    indicadores,
    comprobaciones,
    coherente: comprobaciones.every((c) => c.ok),
  };
}

/* ───────────────────── exportación determinista ───────────────────── */

export const FORMATOS_EXPORTACION_CUENTAS = ['csv', 'json'] as const;
export type FormatoExportacionCuentas =
  (typeof FORMATOS_EXPORTACION_CUENTAS)[number];

/** Valor CSV: `;` como separador, comillas si hace falta, importes con punto. */
function celda(v: string | number | null): string {
  if (v === null) return '';
  const s = typeof v === 'number' ? centsToNumeric(toCents(v)) : v;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV de las cuentas anuales (secciones balance, PyG, ECPN, EFE y memoria):
 * filas `seccion;partida;concepto;importe`, `;` como separador y saltos
 * `\r\n`. Determinista: el orden de las filas sale del contenido.
 */
/** Versión del formato de exportación (cambia si cambian secciones o claves). */
export const VERSION_FORMATO_CUENTAS = 'erp-dintel/cuentas-anuales@2';

/** Identificación estatutaria de las cuentas anuales. */
export interface IdentificacionCuentas {
  formato: string;
  empresa: string;
  nif: string | null;
  ejercicio: number;
  fechaCierre: string;
  moneda: 'EUR';
  modelo: 'abreviado';
  marco: string;
}

/** Estado del cierre del ejercicio y evidencia de conciliación a su fecha. */
export interface EstadoCierreCuentas {
  cerrado: boolean;
  resultadoAplicado: boolean;
  conciliacion: {
    /** 31-12 del ejercicio (o hoy, si el ejercicio no ha terminado). */
    fecha: string;
    cuadra: boolean;
    descuadres: number;
    partidas: { clave: string; diferencia: number }[];
  } | null;
}

export function identificacionCuentas(p: {
  empresa: string;
  nif: string | null;
  ejercicio: number;
}): IdentificacionCuentas {
  return {
    formato: VERSION_FORMATO_CUENTAS,
    empresa: p.empresa,
    nif: p.nif,
    ejercicio: p.ejercicio,
    fechaCierre: `${p.ejercicio}-12-31`,
    moneda: 'EUR',
    modelo: 'abreviado',
    marco: 'PGC 2007 (RD 1514/2007), modelos abreviados',
  };
}

export function cuentasAnualesACsv(ca: {
  ejercicio: number;
  balance: CuentasAnualesCalculo['balance'];
  pyg: CuentasAnualesCalculo['pyg'];
  ecpn: { filas: FilaEcpn[] };
  efe: EstadoFlujosEfectivo;
  memoria: MemoriaAbreviada;
  identificacion?: IdentificacionCuentas;
  cierre?: EstadoCierreCuentas;
  aplicacion?: {
    reparto: { cuenta: string; nombre: string; importe: number }[];
  } | null;
}): string {
  const filas: (string | number | null)[][] = [
    ['seccion', 'partida', 'concepto', 'importe'],
  ];
  const id = ca.identificacion;
  if (id) {
    filas.push(['identificacion', 'formato', 'version', id.formato]);
    filas.push(['identificacion', 'empresa', 'denominacion', id.empresa]);
    filas.push(['identificacion', 'empresa', 'nif', id.nif]);
    filas.push([
      'identificacion',
      'ejercicio',
      'ejercicio',
      String(id.ejercicio),
    ]);
    filas.push(['identificacion', 'ejercicio', 'fecha_cierre', id.fechaCierre]);
    filas.push(['identificacion', 'presentacion', 'moneda', id.moneda]);
    filas.push(['identificacion', 'presentacion', 'modelo', id.modelo]);
    filas.push(['identificacion', 'presentacion', 'marco', id.marco]);
  }
  const masa = (
    seccion: string,
    nombre: string,
    m: {
      total: number;
      cuentas: { cuenta: string; nombre: string; importe: number }[];
    },
  ) => {
    for (const c of m.cuentas) {
      filas.push([seccion, nombre, `${c.cuenta} ${c.nombre}`, c.importe]);
    }
    filas.push([seccion, nombre, 'Total', m.total]);
  };
  const b = ca.balance;
  masa('balance', 'activo_no_corriente', b.activoNoCorriente);
  masa('balance', 'activo_corriente', b.activoCorriente);
  filas.push(['balance', 'total_activo', 'Total activo', b.totalActivo]);
  masa('balance', 'patrimonio_neto', b.patrimonioNeto);
  filas.push([
    'balance',
    'patrimonio_neto',
    'Resultado del ejercicio',
    b.resultadoEjercicio,
  ]);
  masa('balance', 'pasivo_no_corriente', b.pasivoNoCorriente);
  masa('balance', 'pasivo_corriente', b.pasivoCorriente);
  filas.push([
    'balance',
    'total_pn_pasivo',
    'Total patrimonio neto y pasivo',
    b.totalPatrimonioNetoYPasivo,
  ]);
  for (const x of ca.pyg.partidas)
    filas.push(['pyg', x.clave, x.etiqueta, x.importe]);
  filas.push([
    'pyg',
    'resultado_explotacion',
    'Resultado de explotación',
    ca.pyg.resultadoExplotacion,
  ]);
  filas.push([
    'pyg',
    'resultado_financiero',
    'Resultado financiero',
    ca.pyg.resultadoFinanciero,
  ]);
  filas.push(['pyg', 'resultado', 'Resultado del ejercicio', ca.pyg.resultado]);
  for (const f of ca.ecpn.filas) {
    for (const [col, v] of Object.entries(f.importes)) {
      filas.push(['ecpn', f.clave, col, v]);
    }
    filas.push(['ecpn', f.clave, 'total', f.total]);
  }
  const e = ca.efe;
  filas.push(['efe', 'explotacion', 'resultado', e.explotacion.resultado]);
  filas.push(['efe', 'explotacion', 'ajustes', e.explotacion.ajustes]);
  for (const [k, v] of Object.entries(e.explotacion.capitalCorrienteDesglose)) {
    filas.push(['efe', 'capital_corriente', k, v]);
  }
  filas.push(['efe', 'explotacion', 'total', e.explotacion.total]);
  filas.push(['efe', 'inversion', 'total', e.inversion]);
  filas.push(['efe', 'financiacion', 'total', e.financiacion]);
  filas.push(['efe', 'efectivo', 'inicial', e.efectivoInicial]);
  filas.push(['efe', 'efectivo', 'variacion', e.variacionEfectivo]);
  filas.push(['efe', 'efectivo', 'final', e.efectivoFinal]);
  for (const [k, v] of Object.entries(ca.memoria.indicadores)) {
    filas.push(['memoria', 'indicadores', k, v === null ? null : String(v)]);
  }
  for (const n of ca.memoria.notas) {
    filas.push(['memoria', `nota_${n.numero}`, 'titulo', n.titulo]);
    for (const [k, v] of Object.entries(n.cifras ?? {})) {
      filas.push(['memoria', `nota_${n.numero}`, k, v]);
    }
  }
  for (const c of ca.memoria.comprobaciones) {
    filas.push(['memoria', 'comprobacion', c.clave, c.ok ? 'ok' : 'error']);
  }
  for (const r of ca.aplicacion?.reparto ?? []) {
    filas.push(['aplicacion', r.cuenta, r.nombre, r.importe]);
  }
  const ci = ca.cierre;
  if (ci) {
    filas.push(['cierre', 'estado', 'cerrado', ci.cerrado ? 'si' : 'no']);
    filas.push([
      'cierre',
      'estado',
      'resultado_aplicado',
      ci.resultadoAplicado ? 'si' : 'no',
    ]);
    if (ci.conciliacion) {
      const k = ci.conciliacion;
      filas.push(['cierre', 'conciliacion', 'fecha', k.fecha]);
      filas.push([
        'cierre',
        'conciliacion',
        'cuadra',
        k.cuadra ? 'ok' : 'error',
      ]);
      for (const p of k.partidas) {
        filas.push(['cierre', 'conciliacion', p.clave, p.diferencia]);
      }
    }
  }
  return filas.map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
}

/** JSON canónico (claves ordenadas): misma entrada → mismo texto y huella. */
export function cuentasAnualesAJson(ca: unknown): string {
  return jsonCanonico(ca);
}
