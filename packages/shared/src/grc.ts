/**
 * Governance, Risk & Compliance (SAP Flexible Workflow / GRC Access Control,
 * Oracle BPM Approvals / Advanced Access Controls):
 *
 * - Aprobaciones multinivel: una regla de umbral puede tener una cadena de
 *   niveles ordenados, cada uno desde un importe, con un rol mínimo o un
 *   aprobador concreto y un plazo. Sin niveles, la regla es de un solo nivel
 *   con su rol (como hasta ahora).
 * - Delegaciones (suplencias) con fechas: el delegado decide en nombre del
 *   delegante, con su rol, y queda registrado.
 * - Segregación de funciones: conflictos con política por empresa
 *   (bloquear, justificar o auditar); dos de ellos bloquean siempre.
 * - Destinatarios dirigidos de las notificaciones: los que pueden decidir
 *   el paso activo (o su delegado), nunca toda la empresa.
 *
 * Funciones puras, sin base de datos y sin reloj; importes en céntimos BigInt.
 */

import { z } from 'zod';
import { NIVEL_ROL_APROBADOR, type RolAprobador } from './calculo';
import { toCents } from './dinero';
import type { Transiciones } from './maquina-estados';

type Importe = string | number;

export class ErrorGrc extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ErrorGrc';
  }
}

const ROLES: readonly RolAprobador[] = ['administracion', 'gerente', 'admin'];
const rango = (rol: string | null | undefined) =>
  NIVEL_ROL_APROBADOR[rol as RolAprobador] ?? 0;

/** El rol de mayor rango de la lista. */
export function rolMaximo(roles: readonly RolAprobador[]): RolAprobador {
  return roles.reduce<RolAprobador>(
    (m, r) => (rango(r) > rango(m) ? r : m),
    roles[0] ?? 'administracion',
  );
}

/** Rol inmediatamente superior (escalado); null si ya es el máximo. */
export function escalarRol(rol: RolAprobador): RolAprobador | null {
  const i = ROLES.indexOf(rol);
  return i >= 0 && i < ROLES.length - 1 ? ROLES[i + 1] : null;
}

/* ───────────────────────────── niveles ───────────────────────────── */

export const MAX_NIVELES_APROBACION = 9;

export interface NivelConfigurado {
  nivel: number;
  /** Desde qué importe del documento interviene este nivel (inclusive). */
  importeMinimo: Importe;
  rolRequerido: RolAprobador;
  /** Aprobador concreto (opcional); si no, cualquiera con el rol o superior. */
  aprobadorId?: string | null;
  /** Plazo para decidir antes de escalar (horas). */
  plazoHoras?: number | null;
}

export interface NivelResuelto {
  nivel: number;
  rolRequerido: RolAprobador;
  aprobadorId: string | null;
  plazoHoras: number | null;
}

/**
 * Cadena configurada coherente: niveles consecutivos desde 1, importes y
 * roles que no bajan al subir de nivel, plazos positivos.
 */
export function validarNiveles(niveles: readonly NivelConfigurado[]): void {
  if (niveles.length > MAX_NIVELES_APROBACION) {
    throw new ErrorGrc(
      'APPROVAL_LEVELS_INVALID',
      `Como mucho ${MAX_NIVELES_APROBACION} niveles`,
    );
  }
  const orden = [...niveles].sort((a, b) => a.nivel - b.nivel);
  orden.forEach((n, i) => {
    if (n.nivel !== i + 1) {
      throw new ErrorGrc(
        'APPROVAL_LEVELS_INVALID',
        'Los niveles deben ser consecutivos desde 1',
      );
    }
    if (toCents(n.importeMinimo) < 0n) {
      throw new ErrorGrc(
        'APPROVAL_LEVELS_INVALID',
        'El importe de un nivel no puede ser negativo',
      );
    }
    if (
      n.plazoHoras !== undefined &&
      n.plazoHoras !== null &&
      (!Number.isInteger(n.plazoHoras) || n.plazoHoras < 1)
    ) {
      throw new ErrorGrc(
        'APPROVAL_LEVELS_INVALID',
        'El plazo debe ser un número entero de horas positivo',
      );
    }
    const prev = orden[i - 1];
    if (prev) {
      if (toCents(n.importeMinimo) < toCents(prev.importeMinimo)) {
        throw new ErrorGrc(
          'APPROVAL_LEVELS_INVALID',
          'El importe de un nivel no puede ser menor que el del anterior',
        );
      }
      if (rango(n.rolRequerido) < rango(prev.rolRequerido)) {
        throw new ErrorGrc(
          'APPROVAL_LEVELS_INVALID',
          'Un nivel no puede exigir menos rol que el anterior',
        );
      }
    }
  });
}

/**
 * Niveles que intervienen para un importe, renumerados 1..n. Sin cadena
 * configurada (o si ningún nivel alcanza el importe), un solo nivel con el
 * rol de la regla: el comportamiento de siempre.
 */
export function nivelesAprobacion(p: {
  rolRegla: RolAprobador;
  niveles: readonly NivelConfigurado[];
  importe: Importe;
}): NivelResuelto[] {
  const importe = toCents(p.importe);
  const aplican = [...p.niveles]
    .sort((a, b) => a.nivel - b.nivel)
    .filter((n) => importe >= toCents(n.importeMinimo));
  if (aplican.length === 0) {
    return [
      {
        nivel: 1,
        rolRequerido: p.rolRegla,
        aprobadorId: null,
        plazoHoras: null,
      },
    ];
  }
  return aplican.map((n, i) => ({
    nivel: i + 1,
    rolRequerido: n.rolRequerido,
    aprobadorId: n.aprobadorId ?? null,
    plazoHoras: n.plazoHoras ?? null,
  }));
}

/* ───────────────────────────── pasos ───────────────────────────── */

export const ESTADOS_PASO_APROBACION = [
  'en_espera',
  'activo',
  'aprobado',
  'rechazado',
  'cancelado',
] as const;
export type EstadoPasoAprobacion = (typeof ESTADOS_PASO_APROBACION)[number];

/** en espera → activo → aprobado | rechazado; se cancela si la solicitud cae. */
export const APPROVAL_STEP_TRANSITIONS: Transiciones<EstadoPasoAprobacion> = {
  en_espera: ['activo', 'cancelado'],
  activo: ['aprobado', 'rechazado', 'cancelado'],
  aprobado: [],
  rechazado: [],
  cancelado: [],
};

/** ¿Ha vencido el plazo del paso activo? (fechas ISO completas). */
export function pasoVencido(venceEl: string | null, ahora: string): boolean {
  return venceEl !== null && ahora > venceEl;
}

/* ─────────────────────────── delegaciones ─────────────────────────── */

export interface Delegacion {
  delegante: { id: string; rol: string };
  delegadoId: string;
  desde: string;
  hasta: string;
  activa: boolean;
}

/** Delegaciones vigentes hoy hacia un usuario. */
export function delegacionesVigentes(
  delegaciones: readonly Delegacion[],
  usuarioId: string,
  hoy: string,
) {
  return delegaciones.filter(
    (d) =>
      d.activa &&
      d.delegadoId === usuarioId &&
      d.desde <= hoy &&
      hoy <= d.hasta,
  );
}

/** Una delegación no se solapa con otra del mismo delegante. */
export function validarDelegacion(
  nueva: {
    delegadoId: string;
    deleganteId: string;
    desde: string;
    hasta: string;
  },
  existentes: readonly { desde: string; hasta: string; activa: boolean }[],
): void {
  if (nueva.delegadoId === nueva.deleganteId) {
    throw new ErrorGrc(
      'APPROVAL_DELEGATION_INVALID',
      'No se puede delegar en uno mismo',
    );
  }
  if (nueva.hasta < nueva.desde) {
    throw new ErrorGrc(
      'APPROVAL_DELEGATION_INVALID',
      'El fin de la delegación es anterior al inicio',
    );
  }
  if (
    existentes.some(
      (e) => e.activa && e.desde <= nueva.hasta && nueva.desde <= e.hasta,
    )
  ) {
    throw new ErrorGrc(
      'APPROVAL_DELEGATION_OVERLAP',
      'Ya hay una delegación vigente en esas fechas',
    );
  }
}

/* ─────────────────────── segregación de funciones ─────────────────────── */

export const CONFLICTOS_SOD = [
  'solicitante_aprueba',
  'mismo_aprobador_niveles',
  'creador_aprueba',
  'aprobador_paga',
] as const;
export type ConflictoSod = (typeof CONFLICTOS_SOD)[number];

export const CONFLICTO_SOD_LABELS: Record<ConflictoSod, string> = {
  solicitante_aprueba: 'Quien solicita la aprobación la decide',
  mismo_aprobador_niveles: 'La misma persona aprueba dos niveles de la cadena',
  creador_aprueba: 'Quien creó el documento lo aprueba',
  aprobador_paga:
    'Quien aprobó la factura de compra registra su pago o la remesa',
};

export const MODOS_SOD = ['bloquear', 'justificar', 'auditar'] as const;
export type ModoSod = (typeof MODOS_SOD)[number];

/** Política por defecto (sin configurar). Los dos primeros no se relajan. */
export const POLITICA_SOD_DEFECTO: Record<ConflictoSod, ModoSod> = {
  solicitante_aprueba: 'bloquear',
  mismo_aprobador_niveles: 'bloquear',
  creador_aprueba: 'auditar',
  aprobador_paga: 'auditar',
};

export const CONFLICTOS_SOD_FIJOS: readonly ConflictoSod[] = [
  'solicitante_aprueba',
  'mismo_aprobador_niveles',
];

/** Una política no puede relajar un conflicto fijo. */
export function validarPoliticaSod(
  conflicto: ConflictoSod,
  modo: ModoSod,
): void {
  if (CONFLICTOS_SOD_FIJOS.includes(conflicto) && modo !== 'bloquear') {
    throw new ErrorGrc(
      'SOD_POLICY_LOCKED',
      `«${CONFLICTO_SOD_LABELS[conflicto]}» siempre se bloquea`,
    );
  }
}

export interface ResultadoSod {
  /** Código si hay que impedir la operación. */
  bloqueo: 'SOD_CONFLICT' | 'SOD_JUSTIFICATION_REQUIRED' | null;
  conflictos: { conflicto: ConflictoSod; modo: ModoSod }[];
  /** Conflictos permitidos que deben quedar en la auditoría. */
  excepciones: {
    conflicto: ConflictoSod;
    modo: ModoSod;
    justificacion: string | null;
  }[];
}

/**
 * Aplica la política a los conflictos detectados: cualquier `bloquear`
 * impide; un `justificar` sin justificación (≥ 10 caracteres) impide; el
 * resto se permite y se audita como excepción.
 */
export function evaluarSod(p: {
  detectados: readonly ConflictoSod[];
  politica: Partial<Record<ConflictoSod, ModoSod>>;
  justificacion?: string | null;
}): ResultadoSod {
  const conflictos = [...new Set(p.detectados)].map((c) => ({
    conflicto: c,
    modo: CONFLICTOS_SOD_FIJOS.includes(c)
      ? 'bloquear'
      : (p.politica[c] ?? POLITICA_SOD_DEFECTO[c]),
  })) as { conflicto: ConflictoSod; modo: ModoSod }[];
  const justificacion = p.justificacion?.trim() ?? '';
  if (conflictos.some((c) => c.modo === 'bloquear')) {
    return { bloqueo: 'SOD_CONFLICT', conflictos, excepciones: [] };
  }
  if (
    conflictos.some((c) => c.modo === 'justificar') &&
    justificacion.length < 10
  ) {
    return {
      bloqueo: 'SOD_JUSTIFICATION_REQUIRED',
      conflictos,
      excepciones: [],
    };
  }
  return {
    bloqueo: null,
    conflictos,
    excepciones: conflictos.map((c) => ({
      ...c,
      justificacion: justificacion || null,
    })),
  };
}

/* ─────────────────────────── decisión de un paso ─────────────────────────── */

export interface DecisionPaso {
  /** null: puede decidir (quizá con excepciones SoD auditadas). */
  impedimento:
    | 'APPROVAL_ROLE_INSUFFICIENT'
    | 'APPROVAL_NOT_ASSIGNEE'
    | 'SOD_CONFLICT'
    | 'SOD_JUSTIFICATION_REQUIRED'
    | null;
  /** Si decide como delegado, el delegante. */
  enNombreDe: string | null;
  sod: ResultadoSod;
}

/**
 * Quién puede decidir el paso activo: el aprobador asignado o, sin él,
 * cualquiera con el rol requerido o superior; también su delegado vigente
 * (con el rol del delegante). Después, la segregación de funciones.
 */
export function decidirPaso(p: {
  paso: { rolRequerido: RolAprobador; aprobadorId: string | null };
  usuario: { id: string; rol: string };
  solicitanteId: string | null;
  creadorId: string | null;
  /** Quienes ya aprobaron niveles anteriores (o en cuyo nombre se aprobó). */
  aprobadoresPrevios: readonly string[];
  delegaciones: readonly Delegacion[];
  hoy: string;
  politica: Partial<Record<ConflictoSod, ModoSod>>;
  justificacion?: string | null;
}): DecisionPaso {
  const cumple = (id: string, rol: string) =>
    p.paso.aprobadorId
      ? p.paso.aprobadorId === id
      : rango(rol) >= rango(p.paso.rolRequerido);
  let enNombreDe: string | null = null;
  if (!cumple(p.usuario.id, p.usuario.rol)) {
    const d = delegacionesVigentes(p.delegaciones, p.usuario.id, p.hoy).find(
      (x) => cumple(x.delegante.id, x.delegante.rol),
    );
    if (!d) {
      return {
        impedimento: p.paso.aprobadorId
          ? 'APPROVAL_NOT_ASSIGNEE'
          : 'APPROVAL_ROLE_INSUFFICIENT',
        enNombreDe: null,
        sod: { bloqueo: null, conflictos: [], excepciones: [] },
      };
    }
    enNombreDe = d.delegante.id;
  }
  const actores = [p.usuario.id, ...(enNombreDe ? [enNombreDe] : [])];
  const detectados: ConflictoSod[] = [];
  if (p.solicitanteId && actores.includes(p.solicitanteId))
    detectados.push('solicitante_aprueba');
  if (actores.some((a) => p.aprobadoresPrevios.includes(a)))
    detectados.push('mismo_aprobador_niveles');
  if (p.creadorId && actores.includes(p.creadorId))
    detectados.push('creador_aprueba');
  const sod = evaluarSod({
    detectados,
    politica: p.politica,
    justificacion: p.justificacion,
  });
  return { impedimento: sod.bloqueo, enNombreDe, sod };
}

/* ─────────────────────────── destinatarios ─────────────────────────── */

export interface UsuarioDestino {
  id: string;
  rol: string;
  activo: boolean;
}

/**
 * Destinatarios dirigidos del paso activo: su aprobador asignado o los
 * usuarios activos con el rol suficiente, más los delegados vigentes de
 * todos ellos; sin los excluidos (solicitante, aprobadores previos). Orden
 * estable. Nunca «toda la empresa»: lector, obra y cliente no deciden.
 */
export function destinatariosPaso(p: {
  paso: { rolRequerido: RolAprobador; aprobadorId: string | null };
  usuarios: readonly UsuarioDestino[];
  delegaciones: readonly Delegacion[];
  hoy: string;
  excluir?: readonly string[];
}): string[] {
  const excluir = new Set(p.excluir ?? []);
  const titulares = p.usuarios
    .filter((u) => u.activo)
    .filter((u) =>
      p.paso.aprobadorId
        ? u.id === p.paso.aprobadorId
        : rango(u.rol) >= rango(p.paso.rolRequerido),
    );
  const ids = new Set(titulares.map((u) => u.id));
  for (const d of p.delegaciones) {
    if (
      d.activa &&
      d.desde <= p.hoy &&
      p.hoy <= d.hasta &&
      ids.has(d.delegante.id)
    ) {
      if (p.usuarios.some((u) => u.id === d.delegadoId && u.activo))
        ids.add(d.delegadoId);
    }
  }
  return [...ids].filter((id) => !excluir.has(id)).sort();
}

/* ──────────────────────────── contratos (Zod) ──────────────────────────── */

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
const ROLES_ENUM = ['administracion', 'gerente', 'admin'] as const;

export const nivelAprobacionSchema = z.object({
  importeMinimo: z.number().min(0).max(999_999_999_999.99).default(0),
  rolRequerido: z.enum(ROLES_ENUM),
  aprobadorId: z.string().uuid().nullish(),
  plazoHoras: z
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .nullish(),
});
export type NivelAprobacionInput = z.input<typeof nivelAprobacionSchema>;

export const nivelesReglaSchema = z.object({
  niveles: z.array(nivelAprobacionSchema).max(MAX_NIVELES_APROBACION),
});
export type NivelesReglaInput = z.input<typeof nivelesReglaSchema>;

export const delegacionCreateSchema = z.object({
  delegadoId: z.string().uuid(),
  desde: fecha,
  hasta: fecha,
  motivo: z.string().trim().min(3).max(240),
});
export type DelegacionCreateInput = z.input<typeof delegacionCreateSchema>;

export const reasignarPasoSchema = z.object({
  aprobadorId: z.string().uuid(),
  motivo: z.string().trim().min(3).max(240),
});
export type ReasignarPasoInput = z.input<typeof reasignarPasoSchema>;

export const politicaSodSchema = z.object({
  modo: z.enum(MODOS_SOD),
});

export const comprobarSodSchema = z.object({
  conflicto: z.enum(CONFLICTOS_SOD),
  usuarioId: z.string().uuid().optional(),
});

/* ─────────────────────────────── DTO ─────────────────────────────── */

export interface NivelAprobacionDto {
  nivel: number;
  importeMinimo: number;
  rolRequerido: RolAprobador;
  aprobadorId: string | null;
  aprobadorNombre: string | null;
  plazoHoras: number | null;
}

export interface PasoAprobacionDto {
  id: string;
  nivel: number;
  rolRequerido: RolAprobador;
  aprobadorId: string | null;
  aprobadorNombre: string | null;
  estado: EstadoPasoAprobacion;
  activadoEn: string | null;
  venceEl: string | null;
  escalado: boolean;
  decididoPor: string | null;
  decididoPorNombre: string | null;
  enNombreDe: string | null;
  decididoEn: string | null;
  comentario: string | null;
  version: number;
}

export interface DelegacionDto {
  id: string;
  deleganteId: string;
  deleganteNombre: string;
  delegadoId: string;
  delegadoNombre: string;
  desde: string;
  hasta: string;
  motivo: string;
  activa: boolean;
  version: number;
}

export interface PoliticaSodDto {
  conflicto: ConflictoSod;
  descripcion: string;
  modo: ModoSod;
  fija: boolean;
  configurada: boolean;
  version: number;
}

export interface ComprobacionSodDto {
  conflicto: ConflictoSod;
  modo: ModoSod;
  descripcion: string;
}
