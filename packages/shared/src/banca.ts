/**
 * Bank Accounting (SAP Payment Medium Workbench / Electronic Bank Statement /
 * Cash Management, Oracle Payments / Bank Statement Reconciliation / Cash
 * Positioning):
 *
 * - Remesas SEPA: transferencias (SCT, pain.001.001.03) a proveedores y
 *   subcontratas, y adeudos directos (SDD CORE, pain.008.001.02) a clientes
 *   con mandato. XML determinista: mismas entradas → mismos bytes.
 * - Conciliación asistida: puntuación de candidatos (vencimiento, liquidación
 *   ya registrada, remesa, talón, devolución) por importe, ventana de fechas,
 *   referencia y tercero; cuadre exacto con comisión bancaria.
 * - Previsión de liquidez por horizontes a partir del saldo y de los flujos
 *   previstos, sin mutar las entradas.
 *
 * Funciones puras, sin base de datos y sin reloj (la fecha entra como
 * parámetro). Importes en céntimos con BigInt.
 */

import { z } from 'zod';
import { addDays, addMonths, comisionAval, daysBetween } from './calculo';
import { centsToNumeric, fromCents, sumCents, toCents } from './dinero';
import type { Transiciones } from './maquina-estados';

type Importe = string | number;

export class ErrorBanca extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detalle?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ErrorBanca';
  }
}

/* ───────────────────────────── remesas SEPA ───────────────────────────── */

export const TIPOS_REMESA = ['transferencia', 'adeudo'] as const;
export type TipoRemesa = (typeof TIPOS_REMESA)[number];

export const TIPO_REMESA_LABELS: Record<TipoRemesa, string> = {
  transferencia: 'Transferencias SEPA (pagos, pain.001)',
  adeudo: 'Adeudos directos SEPA CORE (cobros, pain.008)',
};

/** Dirección del vencimiento que admite cada tipo de remesa. */
export const DIRECCION_REMESA: Record<TipoRemesa, 'cobro' | 'pago'> = {
  transferencia: 'pago',
  adeudo: 'cobro',
};

export const ESTADOS_REMESA = [
  'borrador',
  'generada',
  'remitida',
  'devuelta',
  'anulada',
] as const;
export type EstadoRemesa = (typeof ESTADOS_REMESA)[number];

export const ESTADO_REMESA_LABELS: Record<EstadoRemesa, string> = {
  borrador: 'Borrador',
  generada: 'Fichero generado',
  remitida: 'Remitida al banco',
  devuelta: 'Devuelta',
  anulada: 'Anulada',
};

/**
 * borrador → generada (XML) → remitida (liquida los vencimientos). Se anula
 * antes de remitirse; una remitida solo pasa a devuelta cuando el banco
 * devuelve todas sus partidas.
 */
export const REMESA_TRANSITIONS: Transiciones<EstadoRemesa> = {
  borrador: ['generada', 'anulada'],
  generada: ['remitida', 'anulada'],
  remitida: ['devuelta'],
  devuelta: [],
  anulada: [],
};

export const ESTADOS_PARTIDA_REMESA = [
  'incluida',
  'devuelta',
  'excluida',
] as const;
export type EstadoPartidaRemesa = (typeof ESTADOS_PARTIDA_REMESA)[number];

/** Partida: incluida → devuelta (por el banco) o excluida (remesa anulada). */
export const PARTIDA_REMESA_TRANSITIONS: Transiciones<EstadoPartidaRemesa> = {
  incluida: ['devuelta', 'excluida'],
  devuelta: [],
  excluida: [],
};

export const SECUENCIAS_ADEUDO = ['FRST', 'RCUR'] as const;
export type SecuenciaAdeudo = (typeof SECUENCIAS_ADEUDO)[number];

/** Primer adeudo de un mandato (FRST) o recurrente (RCUR). */
export function secuenciaAdeudo(adeudosPreviosDelMandato: number) {
  return (adeudosPreviosDelMandato > 0 ? 'RCUR' : 'FRST') as SecuenciaAdeudo;
}

/** IBAN sin espacios y en mayúsculas. */
export function normalizarIban(iban: string | null | undefined): string {
  return (iban ?? '').replace(/\s+/g, '').toUpperCase();
}

/** Resto módulo 97 de una cadena alfanumérica (A=10 … Z=35), ISO 7064. */
function mod97(s: string): number {
  let resto = 0;
  for (const ch of s) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) resto = (resto * 10 + Number(d)) % 97;
  }
  return resto;
}

/** IBAN válido: formato y dígitos de control (ISO 13616). */
export function ibanValido(iban: string | null | undefined): boolean {
  const i = normalizarIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(i)) return false;
  if (i.startsWith('ES') && i.length !== 24) return false;
  return mod97(i.slice(4) + i.slice(0, 4)) === 1;
}

/** BIC de 8 u 11 caracteres. */
export function bicValido(bic: string | null | undefined): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(
    (bic ?? '').toUpperCase(),
  );
}

/**
 * Identificador de acreedor SEPA (AT-02) español: ES + dígitos de control +
 * sufijo comercial (3) + NIF. Los dígitos se calculan sobre NIF + «ES00».
 */
export function identificadorAcreedorSepa(nif: string, sufijo = '000') {
  const id = nif.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (id.length < 8) {
    throw new ErrorBanca(
      'SEPA_CREDITOR_ID_INVALID',
      'El NIF de la empresa no permite calcular el identificador de acreedor SEPA',
    );
  }
  const control = String(98 - mod97(`${id}ES00`)).padStart(2, '0');
  return `ES${control}${sufijo.padStart(3, '0').slice(0, 3)}${id}`;
}

/**
 * Texto en el juego de caracteres SEPA (latín básico): quita tildes, cambia
 * lo no admitido por espacio y recorta a `max`.
 */
export function textoSepa(s: string | null | undefined, max: number): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface PartidaSepa {
  endToEndId: string;
  importe: Importe;
  nombre: string;
  iban: string | null;
  bic?: string | null;
  concepto: string;
  /** Adeudos: mandato y su fecha de firma, y la secuencia. */
  mandato?: string | null;
  fechaMandato?: string | null;
  secuencia?: SecuenciaAdeudo;
}

export interface DatosRemesaSepa {
  tipo: TipoRemesa;
  /** Identificador único del mensaje (≤ 35): el número de la remesa. */
  mensajeId: string;
  /** Fecha y hora de creación (se guarda al generar: XML reproducible). */
  creadoEl: string;
  fechaEjecucion: string;
  ordenante: {
    nombre: string;
    nif: string;
    iban: string | null;
    bic?: string | null;
  };
  /** Adeudos: identificador de acreedor SEPA. */
  acreedorId?: string | null;
  partidas: PartidaSepa[];
}

export interface ErrorDatoSepa {
  partida: string | null;
  campo: string;
  mensaje: string;
}

/** Datos obligatorios de la remesa; lista vacía si se puede generar. */
export function validarRemesaSepa(
  d: DatosRemesaSepa,
  hoy: string,
): ErrorDatoSepa[] {
  const e: ErrorDatoSepa[] = [];
  const err = (partida: string | null, campo: string, mensaje: string) =>
    e.push({ partida, campo, mensaje });
  if (!d.mensajeId || d.mensajeId.length > 35)
    err(null, 'mensajeId', 'Identificador de mensaje vacío o de más de 35');
  if (d.fechaEjecucion < hoy)
    err(null, 'fechaEjecucion', 'La fecha de ejecución ya ha pasado');
  if (!textoSepa(d.ordenante.nombre, 70))
    err(null, 'ordenante.nombre', 'Falta el nombre de la empresa');
  if (!d.ordenante.nif)
    err(null, 'ordenante.nif', 'Falta el NIF de la empresa');
  if (!ibanValido(d.ordenante.iban))
    err(null, 'ordenante.iban', 'IBAN de la cuenta de la empresa no válido');
  if (d.ordenante.bic && !bicValido(d.ordenante.bic))
    err(null, 'ordenante.bic', 'BIC de la cuenta de la empresa no válido');
  if (
    d.tipo === 'adeudo' &&
    !/^[A-Z]{2}\d{2}[A-Z0-9]{3,31}$/.test(d.acreedorId ?? '')
  )
    err(null, 'acreedorId', 'Identificador de acreedor SEPA no válido');
  if (d.partidas.length === 0)
    err(null, 'partidas', 'La remesa no tiene partidas');
  const vistos = new Set<string>();
  for (const p of d.partidas) {
    const id = p.endToEndId;
    if (!id || id.length > 35)
      err(id, 'endToEndId', 'Referencia de la operación vacía o de más de 35');
    if (vistos.has(id)) err(id, 'endToEndId', 'Referencia repetida');
    vistos.add(id);
    if (toCents(p.importe) <= 0n)
      err(id, 'importe', 'El importe debe ser positivo');
    if (!textoSepa(p.nombre, 70))
      err(id, 'nombre', 'Falta el nombre del tercero');
    if (!ibanValido(p.iban))
      err(id, 'iban', `IBAN del tercero «${p.nombre}» ausente o no válido`);
    if (p.bic && !bicValido(p.bic)) err(id, 'bic', 'BIC del tercero no válido');
    if (d.tipo === 'adeudo') {
      if (!p.mandato || p.mandato.length > 35)
        err(id, 'mandato', `El tercero «${p.nombre}» no tiene mandato SEPA`);
      if (!p.fechaMandato || p.fechaMandato > hoy)
        err(id, 'fechaMandato', 'Fecha de firma del mandato ausente o futura');
    }
  }
  return e;
}

/** Total exacto de las partidas (céntimos). */
export function totalRemesa(partidas: readonly { importe: Importe }[]): bigint {
  return sumCents(partidas.map((p) => toCents(p.importe)));
}

function agente(bic: string | null | undefined, sangria: string): string {
  return bic
    ? `${sangria}<FinInstnId><BIC>${xml(bic.toUpperCase())}</BIC></FinInstnId>`
    : `${sangria}<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>`;
}

/**
 * XML SEPA de la remesa. Determinista: las partidas se ordenan por su
 * referencia y la fecha de creación entra como dato. Lanza
 * `SEPA_DATA_INVALID` con la lista de errores si faltan datos.
 */
export function generarSepaXml(d: DatosRemesaSepa, hoy: string): string {
  const errores = validarRemesaSepa(d, hoy);
  if (errores.length > 0) {
    throw new ErrorBanca(
      'SEPA_DATA_INVALID',
      `La remesa tiene ${errores.length} dato(s) no válidos: ${errores
        .slice(0, 3)
        .map((x) => x.mensaje)
        .join('; ')}`,
      { errores },
    );
  }
  const partidas = [...d.partidas].sort((a, b) =>
    a.endToEndId < b.endToEndId ? -1 : a.endToEndId > b.endToEndId ? 1 : 0,
  );
  const imp = (x: Importe | bigint) =>
    centsToNumeric(typeof x === 'bigint' ? x : toCents(x));
  const total = totalRemesa(partidas);
  const nombre = xml(textoSepa(d.ordenante.nombre, 70));
  const ibanOrd = normalizarIban(d.ordenante.iban);
  const creado = d.creadoEl.slice(0, 19);
  const L: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const cabecera = (n: number) => [
    '    <GrpHdr>',
    `      <MsgId>${xml(d.mensajeId)}</MsgId>`,
    `      <CreDtTm>${creado}</CreDtTm>`,
    `      <NbOfTxs>${n}</NbOfTxs>`,
    `      <CtrlSum>${imp(total)}</CtrlSum>`,
    '      <InitgPty>',
    `        <Nm>${nombre}</Nm>`,
    `        <Id><OrgId><Othr><Id>${xml(d.ordenante.nif.toUpperCase())}</Id></Othr></OrgId></Id>`,
    '      </InitgPty>',
    '    </GrpHdr>',
  ];
  if (d.tipo === 'transferencia') {
    L.push(
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
      '  <CstmrCdtTrfInitn>',
      ...cabecera(partidas.length),
      '    <PmtInf>',
      `      <PmtInfId>${xml(d.mensajeId)}-1</PmtInfId>`,
      '      <PmtMtd>TRF</PmtMtd>',
      '      <BtchBookg>true</BtchBookg>',
      `      <NbOfTxs>${partidas.length}</NbOfTxs>`,
      `      <CtrlSum>${imp(total)}</CtrlSum>`,
      '      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>',
      `      <ReqdExctnDt>${d.fechaEjecucion}</ReqdExctnDt>`,
      `      <Dbtr><Nm>${nombre}</Nm></Dbtr>`,
      `      <DbtrAcct><Id><IBAN>${ibanOrd}</IBAN></Id></DbtrAcct>`,
      '      <DbtrAgt>',
      agente(d.ordenante.bic, '        '),
      '      </DbtrAgt>',
      '      <ChrgBr>SLEV</ChrgBr>',
    );
    for (const p of partidas) {
      L.push(
        '      <CdtTrfTxInf>',
        `        <PmtId><EndToEndId>${xml(p.endToEndId)}</EndToEndId></PmtId>`,
        `        <Amt><InstdAmt Ccy="EUR">${imp(p.importe)}</InstdAmt></Amt>`,
        ...(p.bic
          ? [
              '        <CdtrAgt>',
              agente(p.bic, '          '),
              '        </CdtrAgt>',
            ]
          : []),
        `        <Cdtr><Nm>${xml(textoSepa(p.nombre, 70))}</Nm></Cdtr>`,
        `        <CdtrAcct><Id><IBAN>${normalizarIban(p.iban)}</IBAN></Id></CdtrAcct>`,
        `        <RmtInf><Ustrd>${xml(textoSepa(p.concepto, 140))}</Ustrd></RmtInf>`,
        '      </CdtTrfTxInf>',
      );
    }
    L.push('    </PmtInf>', '  </CstmrCdtTrfInitn>', '</Document>');
    return `${L.join('\n')}\n`;
  }

  // Adeudos: un bloque de pago por secuencia (FRST antes que RCUR).
  L.push(
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <CstmrDrctDbtInitn>',
    ...cabecera(partidas.length),
  );
  for (const seq of SECUENCIAS_ADEUDO) {
    const grupo = partidas.filter((p) => (p.secuencia ?? 'RCUR') === seq);
    if (grupo.length === 0) continue;
    L.push(
      '    <PmtInf>',
      `      <PmtInfId>${xml(d.mensajeId)}-${seq}</PmtInfId>`,
      '      <PmtMtd>DD</PmtMtd>',
      '      <BtchBookg>true</BtchBookg>',
      `      <NbOfTxs>${grupo.length}</NbOfTxs>`,
      `      <CtrlSum>${imp(totalRemesa(grupo))}</CtrlSum>`,
      `      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>${seq}</SeqTp></PmtTpInf>`,
      `      <ReqdColltnDt>${d.fechaEjecucion}</ReqdColltnDt>`,
      `      <Cdtr><Nm>${nombre}</Nm></Cdtr>`,
      `      <CdtrAcct><Id><IBAN>${ibanOrd}</IBAN></Id></CdtrAcct>`,
      '      <CdtrAgt>',
      agente(d.ordenante.bic, '        '),
      '      </CdtrAgt>',
      '      <ChrgBr>SLEV</ChrgBr>',
      `      <CdtrSchmeId><Id><PrvtId><Othr><Id>${xml(d.acreedorId ?? '')}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>`,
    );
    for (const p of grupo) {
      L.push(
        '      <DrctDbtTxInf>',
        `        <PmtId><EndToEndId>${xml(p.endToEndId)}</EndToEndId></PmtId>`,
        `        <InstdAmt Ccy="EUR">${imp(p.importe)}</InstdAmt>`,
        `        <DrctDbtTx><MndtRltdInf><MndtId>${xml(p.mandato ?? '')}</MndtId><DtOfSgntr>${p.fechaMandato}</DtOfSgntr></MndtRltdInf></DrctDbtTx>`,
        '        <DbtrAgt>',
        agente(p.bic, '          '),
        '        </DbtrAgt>',
        `        <Dbtr><Nm>${xml(textoSepa(p.nombre, 70))}</Nm></Dbtr>`,
        `        <DbtrAcct><Id><IBAN>${normalizarIban(p.iban)}</IBAN></Id></DbtrAcct>`,
        `        <RmtInf><Ustrd>${xml(textoSepa(p.concepto, 140))}</Ustrd></RmtInf>`,
        '      </DrctDbtTxInf>',
      );
    }
    L.push('    </PmtInf>');
  }
  L.push('  </CstmrDrctDbtInitn>', '</Document>');
  return `${L.join('\n')}\n`;
}

/** Referencia de cada partida (EndToEndId ≤ 35): remesa + orden. */
export function referenciaPartida(numeroRemesa: string, orden: number) {
  return `${numeroRemesa}-${String(orden).padStart(4, '0')}`.slice(0, 35);
}

/* ─────────────────────── conciliación asistida ─────────────────────── */

export const TIPOS_CONCILIACION = [
  'vencimiento',
  'liquidacion',
  'remesa',
  'devolucion',
  'talon',
  'comision',
] as const;
export type TipoConciliacion = (typeof TIPOS_CONCILIACION)[number];

export const TIPO_CONCILIACION_LABELS: Record<TipoConciliacion, string> = {
  vencimiento: 'Cobro o pago de un vencimiento',
  liquidacion: 'Cobro o pago ya registrado',
  remesa: 'Cargo o abono de una remesa SEPA',
  devolucion: 'Devolución de una partida de remesa',
  talon: 'Compensación de un talón',
  comision: 'Comisión o gasto bancario',
};

export interface CandidatoConciliacion {
  tipo: Exclude<TipoConciliacion, 'comision'>;
  id: string;
  /** Importe esperado (positivo). En un vencimiento, el saldo vivo. */
  importe: Importe;
  /** Signo esperado del movimiento: +1 abono, −1 cargo. */
  signo: 1 | -1;
  fecha: string;
  /** Referencias que pueden aparecer en el concepto (factura, remesa, talón…). */
  referencias: string[];
  tercero?: string | null;
  descripcion: string;
}

export type ConfianzaConciliacion = 'alta' | 'media' | 'baja';

export interface SugerenciaConciliacion extends Omit<
  CandidatoConciliacion,
  'importe'
> {
  importe: number;
  puntuacion: number;
  confianza: ConfianzaConciliacion;
  motivos: string[];
  /** Comisión implícita (≥ 0) si el importe no cuadra exacto. */
  comision: number;
  diasDiferencia: number;
}

/** Normaliza para comparar conceptos: sin tildes, mayúsculas, alfanumérico. */
function plano(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Comisión máxima que se admite como diferencia sugerida: 2 % y 50 €. */
const COMISION_MAX_PCT = 2n;
const COMISION_MAX_CENTS = 5_000n;

/**
 * Comisión implícita de casar un movimiento con un importe esperado: en un
 * abono el banco ingresa neto (esperado − comisión); en un cargo, cobra de
 * más (esperado + comisión). Null si no hay cuadre posible.
 */
function comisionImplicita(
  movimiento: bigint,
  esperado: bigint,
  signo: 1 | -1,
): bigint | null {
  const m = movimiento < 0n ? -movimiento : movimiento;
  const c = signo > 0 ? esperado - m : m - esperado;
  return c >= 0n ? c : null;
}

/**
 * Candidatos de conciliación de un movimiento puntuados de 0 a 100:
 * importe (50 exacto, 25 con comisión dentro de tolerancia), fecha en la
 * ventana (hasta 20), referencia en el concepto (25) y tercero (5). Solo
 * se sugieren los de sentido correcto y puntuación ≥ 40; orden estable.
 */
export function sugerirConciliacion(
  movimiento: {
    importe: Importe;
    fecha: string;
    concepto: string;
    referencia?: string | null;
  },
  candidatos: readonly CandidatoConciliacion[],
  opciones: { ventanaDias?: number; max?: number } = {},
): SugerenciaConciliacion[] {
  const ventana = opciones.ventanaDias ?? 30;
  const mov = toCents(movimiento.importe);
  const signoMov = mov >= 0n ? 1 : -1;
  const texto = ` ${plano(`${movimiento.concepto} ${movimiento.referencia ?? ''}`)} `;
  const salida: SugerenciaConciliacion[] = [];
  for (const c of candidatos) {
    if (c.signo !== signoMov) continue;
    const esperado = toCents(c.importe);
    if (esperado <= 0n) continue;
    const motivos: string[] = [];
    let puntos = 0;
    const com = comisionImplicita(mov, esperado, c.signo);
    let comision = 0n;
    let cuadra = true;
    if (com === 0n) {
      puntos += 50;
      motivos.push('importe exacto');
    } else if (
      com !== null &&
      com <= COMISION_MAX_CENTS &&
      com * 100n <= esperado * COMISION_MAX_PCT
    ) {
      puntos += 25;
      comision = com;
      motivos.push(`importe con comisión de ${centsToNumeric(com)} €`);
    } else {
      cuadra = false;
    }
    const dias = Math.abs(daysBetween(c.fecha, movimiento.fecha));
    if (dias <= ventana) {
      puntos += Math.round(20 * (1 - dias / (ventana + 1)));
      motivos.push(dias === 0 ? 'misma fecha' : `${dias} día(s) de diferencia`);
    }
    const ref = c.referencias
      .map(plano)
      .find((r) => r.length >= 4 && texto.includes(r));
    if (ref) {
      puntos += 25;
      motivos.push(`referencia ${ref} en el concepto`);
    }
    const palabras = plano(c.tercero)
      .split(' ')
      .filter((p) => p.length >= 4);
    if (palabras.some((p) => texto.includes(` ${p} `))) {
      puntos += 5;
      motivos.push('tercero en el concepto');
    }
    // Sin importe ni referencia no hay sugerencia, por cercana que sea la fecha.
    if ((!cuadra && !ref) || puntos < 40) continue;
    const puntuacion = Math.min(100, puntos);
    salida.push({
      ...c,
      importe: fromCents(esperado),
      puntuacion,
      confianza:
        puntuacion >= 75 ? 'alta' : puntuacion >= 55 ? 'media' : 'baja',
      motivos,
      comision: fromCents(comision),
      diasDiferencia: dias,
    });
  }
  return salida
    .sort(
      (a, b) =>
        b.puntuacion - a.puntuacion ||
        a.diasDiferencia - b.diasDiferencia ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, opciones.max ?? 5);
}

/**
 * Cuadre de una conciliación: el bruto que se liquida (o que debe tener el
 * documento) y la comisión. Abono: bruto = |movimiento| + comisión; cargo:
 * bruto = |movimiento| − comisión. Con `exacto`, el bruto debe coincidir
 * (remesa, talón, liquidación, devolución); sin él (vencimiento), no puede
 * superar el saldo vivo.
 */
export function planConciliacion(p: {
  movimiento: Importe;
  signoEsperado: 1 | -1;
  comision?: Importe;
  objetivo: Importe;
  exacto: boolean;
}): { bruto: bigint; comision: bigint } {
  const mov = toCents(p.movimiento);
  if ((mov >= 0n ? 1 : -1) !== p.signoEsperado || mov === 0n) {
    throw new ErrorBanca(
      'BANK_MOVEMENT_DIRECTION_MISMATCH',
      p.signoEsperado > 0
        ? 'Un cargo no puede conciliar un cobro'
        : 'Un abono no puede conciliar un pago',
    );
  }
  const comision = toCents(p.comision ?? 0);
  const m = mov < 0n ? -mov : mov;
  const bruto = p.signoEsperado > 0 ? m + comision : m - comision;
  if (comision < 0n || bruto <= 0n) {
    throw new ErrorBanca(
      'BANK_FEE_INVALID',
      'La comisión no puede ser negativa ni absorber todo el movimiento',
    );
  }
  const objetivo = toCents(p.objetivo);
  if (p.exacto ? bruto !== objetivo : bruto > objetivo) {
    throw new ErrorBanca(
      'BANK_DIFFERENCE_MISMATCH',
      `El movimiento (${centsToNumeric(m)} €) con comisión ${centsToNumeric(comision)} € no cuadra con ${centsToNumeric(objetivo)} €`,
      {
        diferencia: centsToNumeric(bruto - objetivo),
      },
    );
  }
  return { bruto, comision };
}

/** Asiento de la comisión bancaria: 6260 a 5720. */
export function asientoComisionBancaria(
  importe: Importe,
  concepto: string,
): {
  cuenta: string;
  debe: string;
  haber: string;
  projectId: null;
  concepto: string;
}[] {
  const c = toCents(importe);
  if (c <= 0n) return [];
  const imp = centsToNumeric(c);
  return [
    { cuenta: '6260', debe: imp, haber: '0.00', projectId: null, concepto },
    { cuenta: '5720', debe: '0.00', haber: imp, projectId: null, concepto },
  ];
}

/* ───────────────────────── previsión de liquidez ───────────────────────── */

export const CATEGORIAS_LIQUIDEZ = [
  'cobros',
  'pagos',
  'talones',
  'certificaciones',
  'compras',
  'avales',
] as const;
export type CategoriaLiquidez = (typeof CATEGORIAS_LIQUIDEZ)[number];

export const CATEGORIA_LIQUIDEZ_LABELS: Record<CategoriaLiquidez, string> = {
  cobros: 'Cobros de cartera',
  pagos: 'Pagos de cartera',
  talones: 'Talones en tránsito',
  certificaciones: 'Certificaciones pendientes de facturar',
  compras: 'Pedidos de compra comprometidos',
  avales: 'Comisiones de avales',
};

export const HORIZONTES_LIQUIDEZ_DEFECTO = [7, 30, 60, 90] as const;

export interface FlujoLiquidez {
  fecha: string;
  /** Con signo: + entrada, − salida. */
  importe: Importe;
  categoria: CategoriaLiquidez;
}

export interface TramoCategoria {
  entradas: number;
  salidas: number;
}

export interface HorizonteLiquidez {
  dias: number;
  hasta: string;
  entradas: number;
  salidas: number;
  neto: number;
  saldoFinal: number;
  saldoMinimo: number;
  fechaMinimo: string;
  /** El saldo cae por debajo de cero en algún día del horizonte. */
  tension: boolean;
  porCategoria: Record<CategoriaLiquidez, TramoCategoria>;
}

export interface SemanaLiquidez {
  desde: string;
  hasta: string;
  entradas: number;
  salidas: number;
  saldo: number;
}

export interface ProyeccionLiquidez {
  desde: string;
  saldoInicial: number;
  /** Flujos con fecha anterior a `desde` (atrasados): se proyectan el primer día. */
  atrasados: TramoCategoria;
  horizontes: HorizonteLiquidez[];
  semanas: SemanaLiquidez[];
}

/** Horizontes: enteros de 1 a 365, sin repetir, como mucho 8; ordenados. */
export function normalizarHorizontes(
  entrada: readonly number[] | string | null | undefined,
): number[] {
  if (entrada === null || entrada === undefined || entrada === '')
    return [...HORIZONTES_LIQUIDEZ_DEFECTO];
  const lista =
    typeof entrada === 'string'
      ? entrada.split(',').map((s) => Number(s.trim()))
      : [...entrada];
  const unicos = [...new Set(lista)].sort((a, b) => a - b);
  if (
    unicos.length === 0 ||
    unicos.length > 8 ||
    unicos.some((h) => !Number.isInteger(h) || h < 1 || h > 365)
  ) {
    throw new ErrorBanca(
      'LIQ_HORIZON_INVALID',
      'Horizontes no válidos: hasta 8 enteros de 1 a 365 días',
    );
  }
  return unicos;
}

const tramoCero = (): Record<CategoriaLiquidez, { e: bigint; s: bigint }> =>
  Object.fromEntries(
    CATEGORIAS_LIQUIDEZ.map((c) => [c, { e: 0n, s: 0n }]),
  ) as Record<CategoriaLiquidez, { e: bigint; s: bigint }>;

/**
 * Proyección de liquidez: saldo inicial más los flujos previstos, por
 * horizontes (acumulados desde `desde`) y por semanas hasta el mayor. El
 * mínimo se mide día a día. No muta las entradas.
 */
export function proyectarLiquidez(p: {
  desde: string;
  horizontes: readonly number[];
  saldoInicial: Importe;
  flujos: readonly FlujoLiquidez[];
}): ProyeccionLiquidez {
  const horizontes = normalizarHorizontes(p.horizontes);
  const maximo = horizontes[horizontes.length - 1];
  const fin = addDays(p.desde, maximo);
  const inicial = toCents(p.saldoInicial);
  const porDia = new Map<string, bigint>();
  const atrasados = { e: 0n, s: 0n };
  const flujos = p.flujos
    .map((f) => {
      const imp = toCents(f.importe);
      const fecha = f.fecha < p.desde ? p.desde : f.fecha;
      if (f.fecha < p.desde) {
        if (imp >= 0n) atrasados.e += imp;
        else atrasados.s -= imp;
      }
      return { fecha, imp, categoria: f.categoria };
    })
    .filter((f) => f.fecha <= fin && f.imp !== 0n);
  for (const f of flujos)
    porDia.set(f.fecha, (porDia.get(f.fecha) ?? 0n) + f.imp);

  const salidaHorizontes: HorizonteLiquidez[] = horizontes.map((dias) => {
    const hasta = addDays(p.desde, dias);
    const cat = tramoCero();
    let e = 0n;
    let s = 0n;
    for (const f of flujos) {
      if (f.fecha > hasta) continue;
      if (f.imp >= 0n) {
        e += f.imp;
        cat[f.categoria].e += f.imp;
      } else {
        s -= f.imp;
        cat[f.categoria].s -= f.imp;
      }
    }
    let saldo = inicial;
    let minimo = inicial;
    let fechaMinimo = p.desde;
    for (let d = 0; d <= dias; d++) {
      const dia = addDays(p.desde, d);
      saldo += porDia.get(dia) ?? 0n;
      if (saldo < minimo) {
        minimo = saldo;
        fechaMinimo = dia;
      }
    }
    return {
      dias,
      hasta,
      entradas: fromCents(e),
      salidas: fromCents(s),
      neto: fromCents(e - s),
      saldoFinal: fromCents(inicial + e - s),
      saldoMinimo: fromCents(minimo),
      fechaMinimo,
      tension: minimo < 0n,
      porCategoria: Object.fromEntries(
        CATEGORIAS_LIQUIDEZ.map((c) => [
          c,
          { entradas: fromCents(cat[c].e), salidas: fromCents(cat[c].s) },
        ]),
      ) as Record<CategoriaLiquidez, TramoCategoria>,
    };
  });

  const semanas: SemanaLiquidez[] = [];
  let saldo = inicial;
  for (let d = 0; d <= maximo; d += 7) {
    const desde = addDays(p.desde, d);
    const hasta = addDays(p.desde, Math.min(d + 6, maximo));
    let e = 0n;
    let s = 0n;
    for (const f of flujos) {
      if (f.fecha < desde || f.fecha > hasta) continue;
      if (f.imp >= 0n) e += f.imp;
      else s -= f.imp;
    }
    saldo += e - s;
    semanas.push({
      desde,
      hasta,
      entradas: fromCents(e),
      salidas: fromCents(s),
      saldo: fromCents(saldo),
    });
  }
  return {
    desde: p.desde,
    saldoInicial: fromCents(inicial),
    atrasados: {
      entradas: fromCents(atrasados.e),
      salidas: fromCents(atrasados.s),
    },
    horizontes: salidaHorizontes,
    semanas,
  };
}

/**
 * Comisiones previstas de un aval vivo entre `desde` y `hasta`: una por
 * período (cada `periodoMeses` desde la emisión, sin pasar del vencimiento),
 * por `saldo vivo × tasa × meses / 12`.
 */
export function comisionesAvalPrevistas(p: {
  emision: string;
  vencimiento: string | null;
  periodoMeses: number | null;
  tasaAnualPct: Importe | null;
  saldoVivo: Importe;
  desde: string;
  hasta: string;
}): { fecha: string; importe: number }[] {
  if (!p.periodoMeses || p.periodoMeses < 1 || !p.tasaAnualPct) return [];
  if (toCents(p.saldoVivo) <= 0n) return [];
  const importe = comisionAval({
    saldoVivo: p.saldoVivo,
    tasaAnualPct: p.tasaAnualPct,
    meses: p.periodoMeses,
  });
  if (importe <= 0) return [];
  const salida: { fecha: string; importe: number }[] = [];
  for (let k = 1; k < 1200; k++) {
    const fecha = addMonths(p.emision, k * p.periodoMeses);
    if (fecha > p.hasta) break;
    if (p.vencimiento && fecha >= p.vencimiento) break;
    if (fecha >= p.desde) salida.push({ fecha, importe });
  }
  return salida;
}

/* ──────────────────────────── contratos (Zod) ──────────────────────────── */

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');

export const remesaCreateSchema = z.object({
  bankAccountId: z.string().uuid(),
  tipo: z.enum(TIPOS_REMESA),
  fechaEjecucion: fecha,
  vencimientoIds: z.array(z.string().uuid()).min(1).max(500),
  concepto: z.string().trim().max(100).nullish(),
});
export type RemesaCreateInput = z.input<typeof remesaCreateSchema>;

export const remesaRemitirSchema = z.object({ fecha });
export const remesaAnularSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
export const remesaDevolverSchema = z.object({
  fecha,
  /** Código R de la devolución (AM04, MD06…) o texto. */
  motivo: z.string().trim().min(3).max(240),
});
export const remesasQuerySchema = z.object({
  estado: z.enum(ESTADOS_REMESA).optional(),
  tipo: z.enum(TIPOS_REMESA).optional(),
  bankAccountId: z.string().uuid().optional(),
});
export type RemesasQuery = z.infer<typeof remesasQuerySchema>;

export const conciliacionSchema = z
  .object({
    tipo: z.enum(TIPOS_CONCILIACION),
    /** Vencimiento, liquidación, remesa, partida devuelta o talón (no en comisión). */
    id: z.string().uuid().optional(),
    comision: z.number().min(0).max(1_000_000).optional(),
  })
  .refine((d) => d.tipo === 'comision' || Boolean(d.id), {
    message: 'Indica el documento que concilia el movimiento',
    path: ['id'],
  });
export type ConciliacionInput = z.input<typeof conciliacionSchema>;

export const desconciliacionSchema = z
  .object({
    /** Vencimiento conciliado: anula también la liquidación que creó. */
    anularLiquidacion: z.boolean().optional(),
    motivo: z.string().trim().max(240).optional(),
  })
  .default({});
export type DesconciliacionInput = z.input<typeof desconciliacionSchema>;

export const liquidezQuerySchema = z.object({
  desde: fecha.optional(),
  horizontes: z.string().max(60).optional(),
  bankAccountId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  plazoCobroDias: z.coerce.number().int().min(0).max(365).optional(),
  plazoPagoDias: z.coerce.number().int().min(0).max(365).optional(),
});
export type LiquidezQuery = z.infer<typeof liquidezQuerySchema>;

/* ────────────────────────────────── DTO ────────────────────────────────── */

export interface PartidaRemesaDto {
  id: string;
  orden: number;
  vencimientoId: string;
  invoiceNumber: string;
  contactId: string;
  nombre: string;
  iban: string | null;
  importe: number;
  endToEndId: string;
  mandato: string | null;
  secuencia: SecuenciaAdeudo | null;
  estado: EstadoPartidaRemesa;
  liquidacionId: string | null;
  devueltaEl: string | null;
  motivoDevolucion: string | null;
}

export interface RemesaDto {
  id: string;
  numero: string;
  tipo: TipoRemesa;
  estado: EstadoRemesa;
  bankAccountId: string;
  bankAccountNombre: string;
  fechaEjecucion: string;
  concepto: string | null;
  total: number;
  numPartidas: number;
  xmlHash: string | null;
  generadaEl: string | null;
  remitidaEl: string | null;
  motivo: string | null;
  conciliadaCon: string | null;
  version: number;
  partidas: PartidaRemesaDto[];
}

export interface SugerenciasMovimientoDto {
  transactionId: string;
  importe: number;
  fecha: string;
  concepto: string;
  sugerencias: SugerenciaConciliacion[];
}

export interface LiquidezCuentaDto {
  bankAccountId: string;
  nombre: string;
  saldo: number;
}

export interface LiquidezDto extends ProyeccionLiquidez {
  /** `contable`: 572x sin 5729; `cuenta`: saldo declarado de la cuenta; `ninguno` (obra). */
  fuenteSaldo: 'contable' | 'cuenta' | 'ninguno';
  saldoTransito5729: number;
  cuentas: LiquidezCuentaDto[];
  supuestos: { plazoCobroDias: number; plazoPagoDias: number };
}
