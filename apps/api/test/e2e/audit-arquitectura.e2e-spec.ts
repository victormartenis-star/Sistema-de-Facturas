import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Regla de arquitectura de la cadena de auditoría: toda escritura de
 * auditoría va dentro de la transacción de negocio (`audit.registrar(tx, …)`).
 * El antiguo `void this.audit.log(...)` (fuera de la transacción, fire-and-forget
 * y con `catch {}` vacío) no puede volver a aparecer. No arranca la aplicación:
 * lee el código fuente.
 */
function ficherosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...ficherosTs(ruta));
    else if (ruta.endsWith('.ts')) salida.push(ruta);
  }
  return salida;
}

describe('Auditoría (arquitectura) — sin escrituras fuera de la transacción', () => {
  const SRC = join(__dirname, '..', '..', 'src');
  const fuentes = ficherosTs(SRC).map((ruta) => ({
    ruta: relative(SRC, ruta).split(sep).join('/'),
    texto: readFileSync(ruta, 'utf8'),
  }));

  it('54. no queda ningún `audit.log(` ni `void this.audit.` en apps/api/src', () => {
    const infractores = fuentes
      .filter(
        (f) =>
          /\baudit\.log\(/.test(f.texto) || /void this\.audit\./.test(f.texto),
      )
      .map((f) => f.ruta);
    expect(infractores).toEqual([]);
  });

  it('AuditService ya no expone `log()` y su `registrar()` no traga errores', () => {
    const servicio = fuentes.find((f) => f.ruta === 'audit/audit.service.ts');
    expect(servicio).toBeDefined();
    expect(servicio!.texto).not.toMatch(/async log\(/);
    expect(servicio!.texto).not.toMatch(/catch\s*\{\s*(\/\/[^\n]*\n\s*)?\}/);
  });

  it('todo `audit.registrar(` recibe una transacción (`tx`/`trx`) como primer argumento', () => {
    const infractores: string[] = [];
    for (const f of fuentes) {
      for (const m of f.texto.matchAll(
        /this\.audit\.registrar\(\s*([^,\s)]+)/g,
      )) {
        if (!/^(tx|trx)$/.test(m[1])) infractores.push(`${f.ruta}: ${m[1]}`);
      }
    }
    expect(infractores).toEqual([]);
  });
});
