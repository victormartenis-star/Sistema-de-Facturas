/**
 * Primitivas de dinero en céntimos enteros.
 *
 * El dinero se calcula con `BigInt` (exacto en sumas y en `importe × porcentaje`)
 * y el `BigInt` queda **confinado a este módulo y a las funciones puras que lo
 * usan por dentro**: ningún DTO ni firma pública lo expone. Entra `string`
 * (el `numeric` de Postgres) o `number`; sale `number` para los DTO
 * (`fromCents`) o `string` para Drizzle (`centsToNumeric`).
 *
 * Redondeo: siempre half-up simétrico (los medios céntimos se alejan de cero:
 * 1,005 → 1,01 y −1,005 → −1,01), de modo que una factura y su rectificativa
 * con signo cambiado netean exactamente a cero.
 *
 * Sin dependencias y sin acceso a base de datos ni reloj.
 */

const NUMERIC = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/** Potencia de 10 como BigInt. */
function pow10(exp: number): bigint {
  return 10n ** BigInt(exp);
}

/**
 * Convierte un valor decimal a entero con `scale` decimales (half-up simétrico).
 * Los `string` se parsean sin pasar por coma flotante. Los `number` se
 * normalizan a texto con `toFixed` (6 decimales de guarda) para absorber el
 * ruido binario: `0.1 + 0.2` → `0.3` y `1.005` → `1.01`.
 */
export function toScaled(value: string | number, scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`Escala no válida: ${scale}`);
  }
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Importe no finito: ${value}`);
    }
    if (Math.abs(value) >= 1e21) {
      throw new RangeError(`Importe fuera de rango: ${value}`);
    }
    text = value.toFixed(scale + 6);
  } else {
    text = value.trim();
  }
  const match = NUMERIC.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new RangeError(`Importe no válido: "${String(value)}"`);
  }
  const negative = match[1] === '-';
  const intPart = match[2] || '0';
  const fraction = match[3] ?? '';
  const kept = fraction.slice(0, scale).padEnd(scale, '0');
  let result = BigInt(intPart + kept);
  // Half-up sobre el primer decimal descartado (exacto: no hay float).
  const guard = fraction.charAt(scale);
  if (guard !== '' && guard >= '5') result += 1n;
  return negative ? -result : result;
}

/** `"1234.56"` | `1234.56` → `123456n`. Lanza si no es finito. */
export function toCents(value: string | number): bigint {
  return toScaled(value, 2);
}

/** Céntimos → `number` para los DTO. Exacto mientras |importe| < 2^53 céntimos. */
export function fromCents(cents: bigint): number {
  return Number(cents) / 100;
}

/** Céntimos → `"1234.56"` para columnas `numeric` de Drizzle. */
export function centsToNumeric(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** `a × b / divisor` con redondeo half-up simétrico (−1,005 → −1,01). */
export function mulDivRound(a: bigint, b: bigint, divisor: bigint): bigint {
  if (divisor === 0n) throw new RangeError('División por cero');
  let numerator = a * b;
  let den = divisor;
  if (den < 0n) {
    den = -den;
    numerator = -numerator;
  }
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const q = (2n * abs + den) / (2n * den);
  return negative ? -q : q;
}

/** `cents × pct / 100`, con `pct` de hasta 2 decimales. */
export function applyPct(cents: bigint, pct: string | number): bigint {
  return mulDivRound(cents, toScaled(pct, 2), pow10(4));
}

export function sumCents(values: readonly bigint[]): bigint {
  return values.reduce((s, v) => s + v, 0n);
}

/**
 * Reparte `total` (céntimos) en proporción a `pesos`; la suma del resultado es
 * exactamente `total`. Regla de resto mayor:
 *   1. Se reparte `|total|` con los pesos normalizados a suma positiva
 *      (`p_i × signo(Σp)`) y se aplica al final `signo(total)`: así
 *      `repartir(−T, p) = −repartir(T, p)` y `repartir(−T, −p) = −repartir(T, p)`,
 *      de modo que una factura y su rectificativa netean parte a parte.
 *   2. Cuota entera `floor(|total| × p_i / Σp)`; los céntimos sobrantes
 *      (siempre `< n`) van uno a uno a las partes con mayor resto.
 *   3. Desempate: a igualdad de resto, el índice más bajo (el llamador
 *      ordena las partes de forma estable).
 * Casos límite: sin pesos, `[]` si `total = 0` y `RangeError` si no; suma de
 * pesos 0 → se reintenta con `|p_i|`; si todos son 0, todo al índice 0.
 */
export function repartirCents(
  total: bigint,
  pesos: readonly bigint[],
): bigint[] {
  const n = pesos.length;
  if (n === 0) {
    if (total === 0n) return [];
    throw new RangeError('No se puede repartir un importe sin partes');
  }
  if (total === 0n) return pesos.map(() => 0n);
  let w = sumCents(pesos);
  let normalizados: bigint[];
  if (w > 0n) normalizados = [...pesos];
  else if (w < 0n) {
    normalizados = pesos.map((p) => -p);
    w = -w;
  } else {
    normalizados = pesos.map((p) => (p < 0n ? -p : p));
    w = sumCents(normalizados);
    if (w === 0n) {
      return pesos.map((_, i) => (i === 0 ? total : 0n));
    }
  }
  const negativo = total < 0n;
  const abs = negativo ? -total : total;
  const cuotas: bigint[] = [];
  const restos: bigint[] = [];
  for (const p of normalizados) {
    const num = abs * p;
    let q = num / w;
    let r = num % w;
    if (r < 0n) {
      q -= 1n;
      r += w;
    }
    cuotas.push(q);
    restos.push(r);
  }
  const sobrante = Number(abs - sumCents(cuotas));
  const orden = restos
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; k < sobrante; k++) cuotas[orden[k].i] += 1n;
  return negativo ? cuotas.map((c) => -c) : cuotas;
}

/** `precio(4) × cantidad(4)` → céntimos. Sustituye a `round2(unitPrice * quantity)`. */
export function lineAmountCents(
  unitPrice: string | number,
  quantity: string | number,
): bigint {
  return mulDivRound(toScaled(unitPrice, 4), toScaled(quantity, 4), pow10(6));
}

/** Entero escalado → texto `numeric` con `scale` decimales (`1234567n, 3` → `"1234.567"`). */
export function scaledToNumeric(value: bigint, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`Escala no válida: ${scale}`);
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const den = pow10(scale);
  const whole = abs / den;
  const frac =
    scale === 0 ? '' : `.${(abs % den).toString().padStart(scale, '0')}`;
  return `${negative ? '-' : ''}${whole}${frac}`;
}
