import { z } from 'zod';

export const CONTACT_KINDS = ['proveedor', 'cliente', 'ambos'] as const;

export type ContactKind = (typeof CONTACT_KINDS)[number];

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  proveedor: 'Proveedor',
  cliente: 'Cliente',
  ambos: 'Ambos',
};

/** Normaliza NIF/IBAN: mayúsculas y sin espacios ni guiones. */
const normalizedId = (max: number) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
    .pipe(z.string().max(max));

export const contactCreateSchema = z.object({
  kind: z.enum(CONTACT_KINDS).default('proveedor'),
  legalName: z
    .string()
    .trim()
    .min(1, 'La razón social es obligatoria')
    .max(200, 'Máximo 200 caracteres'),
  tradeName: z.string().trim().max(200).nullish(),
  taxId: normalizedId(20).nullish(),
  email: z.string().trim().email('Email no válido').max(200).nullish(),
  phone: z.string().trim().max(30).nullish(),
  iban: normalizedId(34).nullish(),
  paymentTermsDays: z
    .number({ invalid_type_error: 'Debe ser un número' })
    .int('Debe ser un número entero')
    .min(0, 'Entre 0 y 365')
    .max(365, 'Entre 0 y 365')
    .default(30),
  defaultCategoryId: z.string().uuid().nullish(),
});

export const contactUpdateSchema = contactCreateSchema.partial();

export type ContactCreateInput = z.input<typeof contactCreateSchema>;
export type ContactUpdateInput = z.input<typeof contactUpdateSchema>;

export interface ContactDto {
  id: string;
  kind: ContactKind;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  iban: string | null;
  paymentTermsDays: number;
  defaultCategoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isSystem: boolean;
}
