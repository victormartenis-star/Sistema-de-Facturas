#!/usr/bin/env node
/**
 * Seed de datos para la suite E2E del ERP Dintel.
 *
 * Habla **solo por la API HTTP** (`apps/api`), igual que el servidor MCP:
 * nunca contra Postgres directamente. Así los datos nacen con las mismas
 * validaciones, numeración y cálculo económico que un usuario real, y
 * `apps/e2e` no depende de los internos de `apps/api` (separación estricta).
 *
 * Requiere la API arrancada (`npm run dev:api`, o el `webServer` de
 * Playwright en CI) y la empresa por defecto ya sembrada
 * (`npm run db:migrate && npm run db:seed`): `POST /auth/register` cuelga
 * siempre de esa empresa (el sistema es mono-empresa, ver `auth.service.ts`).
 *
 * Idempotente: se puede ejecutar tantas veces como se quiera. Cada entidad
 * se busca por su clave natural (email, código, NIF, número de factura)
 * antes de crearla.
 *
 * Uso: `npm run seed:e2e` (raíz) o `npm run seed:e2e -w @erp/e2e`.
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const ADMIN_EMAIL = process.env.E2E_EMAIL ?? 'test@dintel.es';
const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? 'Test1234!';

interface AuthTokens {
  accessToken: string;
}

interface UserRow {
  id: string;
  email: string;
  role: string;
}

interface ProjectRow {
  id: string;
  code: string;
}

interface ContactRow {
  id: string;
  legalName: string;
  taxId: string | null;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  status: string;
}

/** Cliente HTTP mínimo. Mensaje explícito si la API no está arrancada. */
async function pedir<T>(
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(
      `No se pudo conectar con la API en ${API_URL}. ¿Está arrancada? (npm run dev:api)`,
    );
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'message' in body
        ? body.message
        : res.statusText;
    throw new Error(
      `${init?.method ?? 'GET'} ${path} → ${res.status}: ${JSON.stringify(msg)}`,
    );
  }
  return body as T;
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** El primer usuario de la empresa es siempre `admin` (regla de `AuthService.register`). */
async function ensureAdmin(): Promise<string> {
  try {
    const tokens = await pedir<AuthTokens>('/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    console.log(
      `Seed E2E: admin "${ADMIN_EMAIL}" ya existía, sesión iniciada.`,
    );
    return tokens.accessToken;
  } catch {
    const tokens = await pedir<AuthTokens>('/auth/register', null, {
      method: 'POST',
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        fullName: 'Usuario de Pruebas E2E',
      }),
    });
    console.log(`Seed E2E: admin "${ADMIN_EMAIL}" creado.`);
    return tokens.accessToken;
  }
}

/**
 * Roles reales del sistema: `admin | gerente | administracion | obra`.
 * No existe un rol "oficina" — se usa `administracion`, el más cercano al
 * perfil de oficina técnica (facturas, contactos, documentos, tesorería).
 */
async function ensureUser(
  token: string,
  input: { email: string; fullName: string; role: string; password: string },
): Promise<UserRow> {
  const existing = await pedir<UserRow[]>('/users', token);
  const found = existing.find((u) => u.email === input.email);
  if (found) return found;
  const created = await pedir<UserRow>('/users', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  console.log(`Seed E2E: usuario "${input.email}" (${input.role}) creado.`);
  return created;
}

async function ensureProject(
  token: string,
  input: Record<string, unknown> & { code: string },
): Promise<ProjectRow> {
  const existing = await pedir<ProjectRow[]>('/projects', token);
  const found = existing.find((p) => p.code === input.code);
  if (found) return found;
  const created = await pedir<ProjectRow>('/projects', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  console.log(`Seed E2E: obra "${input.code}" creada.`);
  return created;
}

async function ensureContact(
  token: string,
  input: Record<string, unknown> & { taxId: string; legalName: string },
): Promise<ContactRow> {
  const existing = await pedir<ContactRow[]>('/contacts', token);
  const found = existing.find((c) => c.taxId === input.taxId);
  if (found) return found;
  const created = await pedir<ContactRow>('/contacts', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  console.log(`Seed E2E: contacto "${input.legalName}" creado.`);
  return created;
}

/** Sujeta al contacto a homologación y le añade documentos PRL simulados (sin fichero). */
async function ensureComplianceDocs(
  token: string,
  contact: ContactRow,
  docs: { docType: string; issuedAt: string; expiresAt: string | null }[],
): Promise<void> {
  const summary = await pedir<{ docs: unknown[] }>(
    `/contacts/${contact.id}/cumplimiento`,
    token,
  );
  if (summary.docs.length > 0) return; // ya sembrado

  await pedir(`/contacts/${contact.id}/cumplimiento/exigir`, token, {
    method: 'POST',
    body: JSON.stringify({ required: true }),
  });
  for (const doc of docs) {
    await pedir(`/contacts/${contact.id}/cumplimiento/documentos`, token, {
      method: 'POST',
      body: JSON.stringify(doc),
    });
  }
  console.log(
    `Seed E2E: ${docs.length} documento(s) PRL simulados para "${contact.legalName}".`,
  );
}

async function ensureInvoice(
  token: string,
  input: Record<string, unknown> & { invoiceNumber: string },
  approve: boolean,
): Promise<InvoiceRow> {
  const existing = await pedir<InvoiceRow[]>('/invoices', token);
  const found = existing.find((i) => i.invoiceNumber === input.invoiceNumber);
  if (found) return found;
  const created = await pedir<InvoiceRow>('/invoices', token, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  console.log(`Seed E2E: factura "${input.invoiceNumber}" creada.`);
  if (approve) {
    await pedir(`/invoices/${created.id}/aprobar`, token, { method: 'POST' });
    console.log(
      `Seed E2E: factura "${input.invoiceNumber}" aprobada (genera vencimientos).`,
    );
  }
  return created;
}

async function main(): Promise<void> {
  const admin = await ensureAdmin();

  // ── Usuarios ──────────────────────────────────────────────────────────────
  await ensureUser(admin, {
    email: 'oficina@e2e.dintel.es',
    fullName: 'Oficina Técnica E2E',
    role: 'administracion',
    password: 'Test1234!',
  });
  const obraUser = await ensureUser(admin, {
    email: 'obra@e2e.dintel.es',
    fullName: 'Jefe de Obra E2E',
    role: 'obra',
    password: 'Test1234!',
  });

  // ── Obras ─────────────────────────────────────────────────────────────────
  const obraNorte = await ensureProject(admin, {
    code: 'E2E-001',
    name: 'Edificio E2E Norte',
    status: 'en_curso',
    contractAmount: 500000,
    retentionPct: 5,
  });
  const obraSur = await ensureProject(admin, {
    code: 'E2E-002',
    name: 'Edificio E2E Sur',
    status: 'en_curso',
    contractAmount: 750000,
    retentionPct: 5,
  });

  // El usuario `obra` solo ve Edificio E2E Norte — fixture útil para probar
  // el filtro RBAC por obra (ver [[Módulo Permisos y Roles]]).
  await pedir(`/users/${obraUser.id}/acceso-obras`, admin, {
    method: 'PUT',
    body: JSON.stringify({ projectIds: [obraNorte.id] }),
  });

  // ── Contactos ─────────────────────────────────────────────────────────────
  const proveedorAlDia = await ensureContact(admin, {
    kind: 'proveedor',
    legalName: 'Materiales Construcción Sur SL',
    taxId: 'B11111111',
    paymentTermsDays: 30,
  });
  const proveedorVencido = await ensureContact(admin, {
    kind: 'proveedor',
    legalName: 'Subcontratas Levante SL',
    taxId: 'B22222222',
    paymentTermsDays: 30,
  });
  const proveedorProximo = await ensureContact(admin, {
    kind: 'proveedor',
    legalName: 'Instalaciones Eléctricas Norte SL',
    taxId: 'B33333333',
    paymentTermsDays: 30,
  });
  const clienteNorte = await ensureContact(admin, {
    kind: 'cliente',
    legalName: 'Promotora Edificio Sur SA',
    taxId: 'A44444444',
    paymentTermsDays: 60,
  });
  const clienteSur = await ensureContact(admin, {
    kind: 'cliente',
    legalName: 'Inversiones Inmobiliarias Norte SA',
    taxId: 'A55555555',
    paymentTermsDays: 60,
  });

  // Homologación: uno al día, uno vencido, uno a punto de vencer (rellenan
  // los estados que comprueba la página /homologacion/alertas).
  await ensureComplianceDocs(admin, proveedorAlDia, [
    {
      docType: 'plan_seguridad',
      issuedAt: daysFromNow(-300),
      expiresAt: daysFromNow(300),
    },
    {
      docType: 'seguro_rc',
      issuedAt: daysFromNow(-300),
      expiresAt: daysFromNow(300),
    },
  ]);
  await ensureComplianceDocs(admin, proveedorVencido, [
    {
      docType: 'plan_seguridad',
      issuedAt: daysFromNow(-400),
      expiresAt: daysFromNow(-5),
    },
  ]);
  await ensureComplianceDocs(admin, proveedorProximo, [
    {
      docType: 'plan_seguridad',
      issuedAt: daysFromNow(-350),
      expiresAt: daysFromNow(15),
    },
  ]);

  // ── Facturas ──────────────────────────────────────────────────────────────
  // Dos de venta (se aprueban → generan vencimientos de tesorería) y una de
  // compra en borrador (aprobarla exige albaranes validados, fuera de
  // alcance de este seed).
  await ensureInvoice(
    admin,
    {
      kind: 'venta',
      contactId: clienteNorte.id,
      invoiceNumber: 'V-E2E-0001',
      issueDate: daysFromNow(-10),
      isp: false,
      retentionPct: 5,
      lines: [
        {
          description: 'Certificación nº 1 — Edificio E2E Norte',
          baseAmount: 20000,
          vatPct: 21,
          projectId: obraNorte.id,
        },
      ],
      deliveryNoteIds: [],
    },
    true,
  );
  await ensureInvoice(
    admin,
    {
      kind: 'venta',
      contactId: clienteSur.id,
      invoiceNumber: 'V-E2E-0002',
      issueDate: daysFromNow(-5),
      isp: false,
      retentionPct: 5,
      lines: [
        {
          description: 'Certificación nº 1 — Edificio E2E Sur',
          baseAmount: 15000,
          vatPct: 21,
          projectId: obraSur.id,
        },
      ],
      deliveryNoteIds: [],
    },
    true,
  );
  await ensureInvoice(
    admin,
    {
      kind: 'compra',
      contactId: proveedorAlDia.id,
      invoiceNumber: 'C-E2E-0001',
      issueDate: daysFromNow(-3),
      isp: false,
      retentionPct: 0,
      lines: [
        {
          description: 'Suministro de materiales — Edificio E2E Norte',
          baseAmount: 8000,
          vatPct: 21,
          projectId: obraNorte.id,
        },
      ],
      deliveryNoteIds: [],
    },
    false,
  );

  console.log('Seed E2E: completo.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
