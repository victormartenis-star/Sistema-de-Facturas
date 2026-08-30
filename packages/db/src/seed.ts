import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { getDb, closeDb, companies, categories, users } from './index';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** Mismo formato que `apps/api/src/auth/password.ts`. */
async function hashPassword(password: string): Promise<string> {
  const params = { N: 16384, r: 8, p: 1 };
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, params);
  return [
    'scrypt',
    params.N,
    params.r,
    params.p,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

/** Las 8 categorías de gasto de serie (03-modulos.md, 02-base-de-datos.md §2.3). */
const SYSTEM_CATEGORIES: { slug: string; name: string }[] = [
  { slug: 'materiales', name: 'Materiales' },
  { slug: 'mano_de_obra', name: 'Mano de obra' },
  { slug: 'maquinaria', name: 'Maquinaria' },
  { slug: 'subcontratas', name: 'Subcontratas' },
  { slug: 'transporte', name: 'Transporte' },
  { slug: 'herramientas', name: 'Herramientas' },
  { slug: 'gastos_generales', name: 'Gastos generales' },
  { slug: 'otros', name: 'Otros' },
];

/**
 * Seed idempotente: empresa por defecto + categorías de sistema.
 * Puede ejecutarse tantas veces como se quiera.
 */
async function main() {
  const db = getDb();

  let [company] = await db.select().from(companies).limit(1);
  if (company) {
    console.log(`Seed: empresa existente "${company.name}".`);
  } else {
    [company] = await db
      .insert(companies)
      .values({
        name: 'Mi Empresa Constructora',
        taxId: 'B00000000',
      })
      .returning();
    console.log(`Seed: empresa creada "${company.name}" (${company.id}).`);
  }

  const inserted = await db
    .insert(categories)
    .values(
      SYSTEM_CATEGORIES.map((c) => ({
        companyId: company.id,
        name: c.name,
        slug: c.slug,
        isSystem: true,
      })),
    )
    .onConflictDoNothing()
    .returning();

  console.log(
    inserted.length > 0
      ? `Seed: ${inserted.length} categorías de gasto creadas.`
      : 'Seed: las categorías de gasto ya existían.',
  );

  /*
   * Usuario inicial de Dirección. Sin él no hay forma de entrar al sistema
   * una vez activada la autenticación. La contraseña sale de SEED_ADMIN_*, y
   * si no se define se genera una al azar y se imprime **una sola vez**: así
   * no queda una contraseña por defecto conocida en ninguna instalación.
   */
  const adminEmail = (
    process.env.SEED_ADMIN_EMAIL ?? 'direccion@empresa.local'
  ).toLowerCase();
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);

  if (existing) {
    console.log(`Seed: el usuario ${adminEmail} ya existe.`);
  } else {
    const password =
      process.env.SEED_ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
    await db.insert(users).values({
      companyId: company.id,
      email: adminEmail,
      fullName: process.env.SEED_ADMIN_NAME ?? 'Dirección',
      role: 'direccion',
      passwordHash: await hashPassword(password),
    });
    console.log(`Seed: usuario de Dirección creado → ${adminEmail}`);
    if (!process.env.SEED_ADMIN_PASSWORD) {
      console.log(`Seed: contraseña generada → ${password}`);
      console.log('Seed: anótala ahora; no vuelve a mostrarse.');
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
