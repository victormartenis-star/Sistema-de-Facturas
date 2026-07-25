import { getDb, closeDb, companies, categories } from './index';

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
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
