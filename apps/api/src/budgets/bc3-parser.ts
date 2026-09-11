/**
 * Parser del formato FIEBDC-3 (BC3) usado por Presto, Arquímedes y similares.
 *
 * Registros relevantes:
 *   ~V|version|...             Versión del fichero (se ignora)
 *   ~C|CODE|UNIT|RESUMEN|PRICE|DATE|...  Concepto (capítulo, subcapítulo o partida)
 *   ~T|CODE|TEXT|              Texto largo de un concepto (descripción extendida)
 *   ~D|PARENT|CHILD|FACTOR|... Descomposición: CHILD aparece en PARENT con FACTOR unidades
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
 */

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
}

interface Concept {
  code: string;
  unit: string;
  summary: string;
  price: number;
}

interface Child {
  code: string;
  factor: number; // medición / cantidad en el contexto del padre
}

export interface Bc3ParseResult {
  items: Bc3Item[];
  warnings: string[];
  rootCode: string | null;
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
        // ~C|CODE|UNIT|RESUMEN|PRICE|...
        const [code, unit = '', summary = '', priceRaw = '0'] = fields;
        if (!code) break;
        const price = parseFloat(priceRaw.replace(',', '.')) || 0;
        concepts.set(code.toUpperCase(), {
          code: code.toUpperCase(),
          unit: unit.trim(),
          summary: summary.trim() || code,
          price,
        });
        break;
      }

      case '~D': {
        // ~D|PARENT|CHILD|FACTOR|...
        // FACTOR es la medición (cantidad) de CHILD dentro de PARENT
        const [parent, child, factorRaw = '1'] = fields;
        if (!parent || !child) break;
        const parentKey = parent.toUpperCase();
        const childKey = child.toUpperCase();
        const factor = parseFloat(factorRaw.replace(',', '.')) || 0;

        if (!children.has(parentKey)) children.set(parentKey, []);
        children.get(parentKey)!.push({ code: childKey, factor });
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
      warnings.push(`Código "${code}" referenciado en ~D pero sin ~C definido; se omite.`);
      return;
    }

    const unitPrice = concept.price;
    const totalAmount = parseFloat((unitPrice * quantity).toFixed(2));

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
    });

    // Visitar hijos (solo si no es una partida hoja con precio — para evitar
    // bajar a la descomposición de precios unitarios)
    const kids = children.get(code);
    if (kids && kids.length > 0) {
      // Si el concepto tiene precio propio Y hijos, es un capítulo con importe
      // acumulado: sus hijos son sub-elementos, los recorremos normalmente.
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
