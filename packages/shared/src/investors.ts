import { z } from 'zod';
import { round2 } from './calculo';

/**
 * Inversores y cuentas en participación (real estate): una cuenta agrupa a
 * los inversores que financian una obra/promoción (o la empresa en general,
 * con `projectId` nulo); cada inversor tiene un % de participación y una
 * serie de movimientos (aportaciones y repartos) sobre la que se calculan
 * TIR y VAN con `computeIrr`/`computeNpv` de `./calculo`.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha esperado: AAAA-MM-DD');

export const INVESTOR_KINDS = ['persona_fisica', 'persona_juridica'] as const;
export type InvestorKind = (typeof INVESTOR_KINDS)[number];

export const INVESTOR_KIND_LABELS: Record<InvestorKind, string> = {
  persona_fisica: 'Persona física',
  persona_juridica: 'Persona jurídica',
};

export const investorCreateSchema = z.object({
  kind: z.enum(INVESTOR_KINDS).default('persona_fisica'),
  legalName: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  taxId: z.string().trim().toUpperCase().max(20).nullish(),
  email: z.string().trim().email('Email no válido').max(200).nullish(),
  phone: z.string().trim().max(30).nullish(),
  iban: z.string().trim().max(34).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const investorUpdateSchema = investorCreateSchema.partial();

export type InvestorCreateInput = z.input<typeof investorCreateSchema>;
export type InvestorUpdateInput = z.input<typeof investorUpdateSchema>;

export interface InvestorDto {
  id: string;
  kind: InvestorKind;
  legalName: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  iban: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export const INVESTMENT_ACCOUNT_STATUSES = ['activa', 'cerrada'] as const;
export type InvestmentAccountStatus =
  (typeof INVESTMENT_ACCOUNT_STATUSES)[number];

export const INVESTMENT_ACCOUNT_STATUS_LABELS: Record<
  InvestmentAccountStatus,
  string
> = {
  activa: 'Activa',
  cerrada: 'Cerrada',
};

export const investmentAccountCreateSchema = z.object({
  projectId: z.string().uuid('Obra no válida').nullish(),
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  status: z.enum(INVESTMENT_ACCOUNT_STATUSES).default('activa'),
  committedAmount: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .default(0),
  currentValuationAmount: z
    .number()
    .nonnegative('No puede ser negativo')
    .nullish(),
  startDate: isoDate,
  notes: z.string().trim().max(2000).nullish(),
});

export const investmentAccountUpdateSchema =
  investmentAccountCreateSchema.partial();

export type InvestmentAccountCreateInput = z.input<
  typeof investmentAccountCreateSchema
>;
export type InvestmentAccountUpdateInput = z.input<
  typeof investmentAccountUpdateSchema
>;

export interface InvestmentAccountDto {
  id: string;
  projectId: string | null;
  projectCode: string | null;
  name: string;
  status: InvestmentAccountStatus;
  committedAmount: number;
  currentValuationAmount: number | null;
  startDate: string;
  notes: string | null;
  /** Suma de `participationPct` de los inversores dados de alta; debería tender a 100. */
  totalParticipationPct: number;
  createdAt: string;
  updatedAt: string;
}

export const participationCreateSchema = z.object({
  investorId: z.string().uuid('Inversor no válido'),
  participationPct: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .positive('Debe ser mayor que 0')
    .max(100, 'No puede superar el 100 %'),
  committedAmount: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .nonnegative('No puede ser negativo')
    .default(0),
  joinedAt: isoDate,
});

export const participationUpdateSchema = participationCreateSchema
  .omit({ investorId: true })
  .partial();

export type ParticipationCreateInput = z.input<
  typeof participationCreateSchema
>;
export type ParticipationUpdateInput = z.input<
  typeof participationUpdateSchema
>;

export interface ParticipationDto {
  id: string;
  accountId: string;
  investorId: string;
  investorName: string;
  participationPct: number;
  committedAmount: number;
  joinedAt: string;
}

export const CASHFLOW_DIRECTIONS = ['aportacion', 'reparto'] as const;
export type InvestmentCashflowDirection = (typeof CASHFLOW_DIRECTIONS)[number];

export const CASHFLOW_DIRECTION_LABELS: Record<
  InvestmentCashflowDirection,
  string
> = {
  aportacion: 'Aportación',
  reparto: 'Reparto de dividendo',
};

export const investmentCashflowCreateSchema = z.object({
  investorId: z.string().uuid('Inversor no válido'),
  direction: z.enum(CASHFLOW_DIRECTIONS),
  flowDate: isoDate,
  amount: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .positive('El importe debe ser mayor que 0')
    .max(999_999_999_999.99),
  concept: z.string().trim().max(300).nullish(),
});

export type InvestmentCashflowCreateInput = z.input<
  typeof investmentCashflowCreateSchema
>;

export interface InvestmentCashflowDto {
  id: string;
  accountId: string;
  investorId: string;
  investorName: string;
  direction: InvestmentCashflowDirection;
  flowDate: string;
  amount: number;
  concept: string | null;
  createdAt: string;
}

/** Reparte un importe total de dividendo pro-rata entre los inversores de la cuenta. */
export const distributeDividendSchema = z.object({
  totalAmount: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .positive('El importe debe ser mayor que 0')
    .max(999_999_999_999.99),
  flowDate: isoDate,
  concept: z.string().trim().max(300).nullish(),
});

export type DistributeDividendInput = z.input<typeof distributeDividendSchema>;

export interface DistributeDividendResultDto {
  accountId: string;
  totalAmount: number;
  flowDate: string;
  created: InvestmentCashflowDto[];
}

/** Fila del informe financiero: TIR/VAN por inversor y de la cuenta en conjunto. */
export interface InvestorReturnRowDto {
  investorId: string;
  investorName: string;
  participationPct: number;
  totalAportado: number;
  totalRepartido: number;
  /** Incluye la valoración actual (si la cuenta tiene una) como último flujo positivo. */
  irr: number | null;
  /** VAN a la tasa de descuento pedida en el informe. */
  npv: number | null;
}

/**
 * Reparte `totalAmount` pro-rata entre los inversores de una cuenta según su
 * `participationPct` vigente, cuadrando céntimos: cada inversor se lleva el
 * redondeo a céntimo de su cuota proporcional, y el **último** de la lista
 * absorbe el resto de redondeo (positivo o negativo) para que la suma exacta
 * de los importes devueltos sea siempre `totalAmount` — nunca 99,99 o 100,01
 * por arrastre de decimales.
 */
export function distributeDividend(
  participations: { investorId: string; participationPct: number }[],
  totalAmount: number,
): { investorId: string; amount: number }[] {
  if (participations.length === 0) return [];

  const totalCents = Math.round(round2(totalAmount) * 100);
  const totalPct = participations.reduce(
    (sum, p) => sum + p.participationPct,
    0,
  );

  let assignedCents = 0;
  const result = participations.map((p, index) => {
    if (index === participations.length - 1) {
      const amountCents = totalCents - assignedCents;
      return { investorId: p.investorId, amount: round2(amountCents / 100) };
    }
    const share =
      totalPct > 0 ? p.participationPct / totalPct : 1 / participations.length;
    const amountCents = Math.round(totalCents * share);
    assignedCents += amountCents;
    return { investorId: p.investorId, amount: round2(amountCents / 100) };
  });

  return result;
}

export interface InvestmentAccountReportDto {
  accountId: string;
  accountName: string;
  discountRate: number;
  asOfDate: string;
  totalAportado: number;
  totalRepartido: number;
  currentValuationAmount: number | null;
  irr: number | null;
  npv: number | null;
  investors: InvestorReturnRowDto[];
}
