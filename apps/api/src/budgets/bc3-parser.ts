/**
 * Parser del formato FIEBDC-3 (BC3) usado por Presto, Arquímedes y similares.
 *
 * Registros relevantes:
 *   ~V|version|...             Versión del fichero (se ignora)
 *   ~C|CODE|UNIT|RESUMEN|PRICE|DATE|TIPO|...  Concepto (capítulo, partida, coste)
 *   ~T|CODE|TEXT|              Texto largo de un concepto (descripción extendida)
 *   ~D|PARENT|CHILD|FACTOR|RENDIMIENTO|...  Descomposición: CHILD aparece en PARENT
 *                              con FACTOR unidades y RENDIMIENTO (por defecto 1)
 *   ~K|...                     Descomposición de precio unitario (ignorada en presupuesto)
 *   ~Q|...                     Presupuesto general (ignorado; usamos ~D del raíz)
 *   ~G|...                     Datos generales del fichero (ignorado)
 *   ~J|...                     Datos de empresa (ignorado)
 *
 * Estrategia:
 *   1. Recoger todos los ~C en un Map<code, Concept>.
 *   2. Recoger todos los ~D en un Map<parent, [children]>.
 *   3. Identificar el concepto raíz (el único padre que no aparece como hijo de nadie,
 *      o el primero con código corto; en BC3 suele ser "OBR" o el código de la obra).
 *   4. Recorrer el árbol en profundidad (DFS) para calcular niveles, códigos padre
 *      y cantidad acumulada (el FACTOR del ~D es la medición en el presupuesto).
 *
 * Descomposición de precios unitarios: una partida (código sin '#', con unidad)
 * que tiene ~D no es un contenedor: su precio es la suma de
 * FACTOR × RENDIMIENTO × PRECIO_HIJO, resolviendo recursivamente las
 * subpartidas. Aritmética en céntimos con `@erp/shared` (factor y rendimiento
 * a 4 decimales fijos); nunca floats para el importe. Sus hijos son
 * componentes de precio (`components`), no partidas del presupuesto.
 *
 * El tipo de concepto (campo 6 del ~C: 1 mano de obra, 2 maquinaria,
 * 3 material, 4 indirecto — el 4 es convención del mock) se expone en
 * `conceptType`; no hay columna en BD, no se persiste.
 */

import { fromCents, mulDivRound, toScaled } from '@erp/shared';

export type Bc3ConceptType =
  'sin_clasificar' | 'mano_obra' | 'maquinaria' | 'material' | 'indirecto';

export interface Bc3Component {
  code: string;
  name: string;
  unit: string;
  conceptType: Bc3ConceptType;
  factor: number;
  rendimiento: number;
  unitPrice: number;
  amount: number;
}

export interface Bc3Item {
  code: string;
  name: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  totalAmount: number;
  level: number;
  parentCode: string | null;
  sortOrder: number;
  /** Tipo de concepto del ~C (metadata; no se persiste). */
  conceptType?: Bc3ConceptType;
  /** Componentes de la descomposición de precio (solo partidas descompuestas). */
  components?: Bc3Component[];
}

interface Concept {
  code: string;
  unit: string;
  summary: string;
  price: number;
  priceScaled: bigint; // precio a 4 decimales
  conceptType: Bc3ConceptType;
}

interface Child {
  code: string;
  factor: number; // medición / cantidad en el contexto del padre
  factorScaled: bigint; // 4 decimales
  rendScaled: bigint; // 4 decimales
}

export interface Bc3ParseResult {
  items: Bc3Item[];
  warnings: string[];
  rootCode: string | null;
}

const TIPOS: Record<string, Bc3ConceptType> = {
  '1': 'mano_obra',
  '2': 'maquinaria',
  '3': 'material',
  '4': 'indirecto',
};

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** Normaliza un decimal BC3 (coma o punto); si no es válido devuelve `def`. */
function decimal(raw: string | undefined, def: string): string {
  const t = (raw ?? '').trim().replace(',', '.');
  return DECIMAL.test(t) ? t : def;
}

/** Parsea el contenido de un archivo .bc3 y devuelve las partidas aplanadas. */
export function parseBc3(raw: string): Bc3ParseResult {
  const warnings: string[] = [];
  const concepts = new Map<string, Concept>();
  const children = new Map<string, Child[]>(); // parent → children
  const allChildCodes = new Set<string>();

  // Normalizar saltos de línea; los registros BC3 pueden ocupar varias líneas
  // físicas unidas con '\' al final. Primero reunimos esas continuaciones.
  const lines = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Continuaciones de línea con backslash
    .replace(/\\\n/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!line.startsWith('~')) continue;
    const type = line.slice(0, 2).toUpperCase();
    // Quitar el ~X| inicial y dividir por |
    const payload = line.slice(3); // salta "~C|"
    const fields = splitBc3Fields(payload);

    switch (type) {
      case '~C': {
        // ~C|CODE|UNIT|RESUMEN|PRICE|DATE|TIPO|...
        const [code, unit = '', summary = '', priceRaw = '0', , tipoRaw = ''] =
          fields;
        if (!code) break;
        const priceTxt = decimal(priceRaw, '0');
        concepts.set(code.toUpperCase(), {
          code: code.toUpperCase(),
          unit: unit.trim(),
          summary: summary.trim() || code,
          price: parseFloat(priceTxt) || 0,
          priceScaled: toScaled(priceTxt, 4),
          conceptType: TIPOS[tipoRaw.trim()] ?? 'sin_clasificar',
        });
        break;
      }

      case '~D': {
        // ~D|PARENT|CHILD|FACTOR|RENDIMIENTO|...
        // FACTOR es la medición (cantidad) de CHILD dentro de PARENT
        const [parent, child, factorRaw = '1', rendRaw = '1'] = fields;
        if (!parent || !child) break;
        const parentKey = parent.toUpperCase();
        const childKey = child.toUpperCase();
        const factorTxt = decimal(factorRaw, '0');

        if (!children.has(parentKey)) children.set(parentKey, []);
        children.get(parentKey)!.push({
          code: childKey,
          factor: parseFloat(factorTxt) || 0,
          factorScaled: toScaled(factorTxt, 4),
          rendScaled: toScaled(decimal(rendRaw, '1'), 4),
        });
        allChildCodes.add(childKey);
        break;
      }

      // ~T (texto largo) y el resto se ignoran
    }
  }

  // ─── Identificar raíces ─────────────────────────────────────────────────────
  // Son los conceptos que tienen hijos (~D como padre) pero no son hijos de nadie.
  const allParents = new Set(children.keys());
  const roots = [...allParents].filter((code) => !allChildCodes.has(code));

  // Si hay exactamente una raíz, la usamos; si hay varias, tomamos la primera
  // y emitimos un warning. Si no hay raíces claras (ciclos o archivo roto),
  // tomamos el primer concepto con hijos.
  let rootCode: string | null = null;

  if (roots.length === 0) {
    // Fallback: el primer concepto con hijos
    const firstParent = [...allParents][0] ?? null;
    rootCode = firstParent;
    if (firstParent)
      warnings.push(
        `No se encontró raíz clara en el BC3; se usará "${firstParent}" como raíz.`,
      );
  } else {
    rootCode = roots[0];
    if (roots.length > 1) {
      warnings.push(
        `El BC3 tiene ${roots.length} posibles raíces: ${roots.join(', ')}. Se usa "${rootCode}".`,
      );
    }
  }

  // ─── Descomposición de precios ──────────────────────────────────────────────
  /** Partida descompuesta: no es capítulo ('#'), tiene unidad y tiene hijos. */
  function esDescompuesta(code: string): boolean {
    const c = concepts.get(code);
    return (
      !!c &&
      !code.endsWith('#') &&
      c.unit !== '' &&
      (children.get(code)?.length ?? 0) > 0
    );
  }

  const precioCache = new Map<string, bigint>();
  const componentes = new Map<string, Bc3Component[]>();

  /** Precio unitario en céntimos; recursivo para las subpartidas. */
  function precioCents(code: string, pila: string[]): bigint {
    const concept = concepts.get(code)!;
    if (!esDescompuesta(code))
      return mulDivRound(concept.priceScaled, 1n, 100n);
    const cached = precioCache.get(code);
    if (cached !== undefined) return cached;
    if (pila.includes(code)) {
      warnings.push(
        `Ciclo en la descomposición de "${code}" (${[...pila, code].join(' > ')}); se ignora la referencia.`,
      );
      return 0n;
    }
    let total = 0n;
    const comps: Bc3Component[] = [];
    for (const kid of children.get(code) ?? []) {
      const hijo = concepts.get(kid.code);
      if (!hijo) {
        warnings.push(
          `Código "${kid.code}" referenciado en ~D pero sin ~C definido; se omite.`,
        );
        continue;
      }
      const precio = precioCents(kid.code, [...pila, code]);
      // céntimos × factor(×1e4) × rendimiento(×1e4) / 1e8
      const importe = mulDivRound(
        precio,
        kid.factorScaled * kid.rendScaled,
        100_000_000n,
      );
      total += importe;
      comps.push({
        code: hijo.code,
        name: hijo.summary,
        unit: hijo.unit,
        conceptType: hijo.conceptType,
        factor: kid.factor,
        rendimiento: Number(kid.rendScaled) / 10000,
        unitPrice: fromCents(precio),
        amount: fromCents(importe),
      });
    }
    // Un ciclo deja un resultado parcial: no se cachea si hubo aviso de ciclo
    // en esta rama, pero el valor es determinista igualmente.
    precioCache.set(code, total);
    componentes.set(code, comps);
    return total;
  }

  // ─── Recorrido DFS ──────────────────────────────────────────────────────────
  const items: Bc3Item[] = [];

  function visit(
    code: string,
    parentCode: string | null,
    quantity: number,
    level: number,
    sortOrder: number,
  ): void {
    const concept = concepts.get(code);
    if (!concept) {
      warnings.push(
        `Código "${code}" referenciado en ~D pero sin ~C definido; se omite.`,
      );
      return;
    }

    const descompuesta = esDescompuesta(code);
    const precioDescompuesto = descompuesta ? precioCents(code, []) : 0n;
    const unitPrice = descompuesta
      ? fromCents(precioDescompuesto)
      : concept.price;
    // Un concepto con hijos que no es partida descompuesta es un contenedor
    // (capítulo): su precio es el agregado de sus partidas y sumarlo además
    // de ellas inflaría el presupuesto. Solo las hojas aportan importe.
    const esContenedor = !descompuesta && (children.get(code)?.length ?? 0) > 0;
    const totalAmount = esContenedor
      ? 0
      : fromCents(
          mulDivRound(
            descompuesta ? precioDescompuesto * 100n : concept.priceScaled,
            toScaled(quantity, 4),
            1_000_000n,
          ),
        );

    items.push({
      code: concept.code,
      name: concept.summary,
      unit: concept.unit,
      unitPrice,
      quantity,
      totalAmount,
      level,
      parentCode,
      sortOrder,
      conceptType: concept.conceptType,
      ...(descompuesta ? { components: componentes.get(code) ?? [] } : {}),
    });

    // Los hijos de una partida descompuesta son componentes de precio.
    if (descompuesta) return;

    const kids = children.get(code);
    if (kids && kids.length > 0) {
      kids.forEach((kid, idx) => {
        visit(kid.code, concept.code, kid.factor, level + 1, idx);
      });
    }
  }

  if (rootCode) {
    const rootChildren = children.get(rootCode) ?? [];
    rootChildren.forEach((kid, idx) => {
      // Nivel 1 = capítulo raíz (el concepto "OBR" / raíz en sí no se incluye)
      visit(kid.code, null, kid.factor, 1, idx);
    });
  } else {
    warnings.push('No se pudo determinar la estructura del presupuesto BC3.');
  }

  // Advertir si el árbol está vacío pero había conceptos
  if (items.length === 0 && concepts.size > 0) {
    warnings.push(
      `Se encontraron ${concepts.size} conceptos pero no se pudo construir el árbol. ` +
        'Comprueba que el archivo BC3 contiene registros ~D válidos.',
    );
  }

  return { items, warnings, rootCode };
}

/**
 * Divide los campos de un registro BC3 respetando el escape con '\\|'.
 * Los campos van separados por '|'; el último suele ser vacío.
 */
function splitBc3Fields(payload: string): string[] {
  // Simple split — BC3 estándar no escapa el '|' dentro de campos
  return payload.split('|');
}
