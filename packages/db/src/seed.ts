import { getDb, closeDb, companies } from './index';

/**
 * Seed idempotente: crea la empresa por defecto si no existe ninguna.
 * (MVP monoempresa; ver 01-arquitectura.md §2 "Multi-empresa preparado".)
 */
async function main() {
  const db = getDb();

  const existing = await db.select().from(companies).limit(1);
  if (existing.length > 0) {
    console.log(`Seed: ya existe la empresa "${existing[0].name}", nada que hacer.`);
    return;
  }

  const [company] = await db
    .insert(companies)
    .values({
      name: 'Mi Empresa Constructora',
      taxId: 'B00000000',
    })
    .returning();

  console.log(`Seed: empresa creada "${company.name}" (${company.id}).`);
  console.log('Puedes cambiar el nombre y CIF desde la base de datos o, más adelante, desde Configuración.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
