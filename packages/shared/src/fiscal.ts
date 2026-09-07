/**
 * Validación de NIF, NIE y CIF.
 *
 * El NIF es la clave con la que se cruza todo lo demás: el Registro de
 * Empresas Acreditadas, los certificados de estar al corriente, el modelo 347
 * y la propia factura. Un dígito mal no se nota al teclearlo y aparece meses
 * después, cuando el certificado de la Seguridad Social «no encuentra» a una
 * empresa que sí existe, o cuando Hacienda devuelve el 347 entero.
 *
 * La letra de control existe precisamente para que un error de tecleo se
 * detecte en el momento. No comprobarla es tirar esa red de seguridad.
 */

export const TAX_ID_KINDS = ['nif', 'nie', 'cif', 'extranjero'] as const;
export type TaxIdKind = (typeof TAX_ID_KINDS)[number];

export const TAX_ID_KIND_LABELS: Record<TaxIdKind, string> = {
  nif: 'NIF de persona física',
  nie: 'NIE',
  cif: 'NIF de persona jurídica',
  extranjero: 'Identificación extranjera',
};

/** Letras del DNI, en el orden que fija el resto de dividir entre 23. */
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** Letras de control del CIF, indexadas por el dígito de control. */
const CIF_LETTERS = 'JABCDEFGHI';

/** Tipos de entidad cuyo carácter de control es siempre una letra. */
const CIF_LETTER_ONLY = 'KPQRSNW';

/** Tipos cuyo carácter de control es siempre un dígito. */
const CIF_DIGIT_ONLY = 'ABEH';

/** Primera letra válida de un CIF, por forma jurídica. */
const CIF_PREFIXES = 'ABCDEFGHJKLMNPQRSUVW';

export interface TaxIdCheck {
  /** El identificador normalizado: mayúsculas, sin espacios ni guiones. */
  normalized: string;
  kind: TaxIdKind | null;
  valid: boolean;
  /**
   * ¿Se ha podido comprobar la letra de control?
   *
   * Un identificador extranjero se acepta pero no se verifica: no hay
   * algoritmo común, y rechazarlo dejaría fuera a proveedores legítimos. Se
   * marca para que no se confunda con uno comprobado.
   */
  verified: boolean;
  /** Motivo por el que no es válido; null si lo es. */
  reason: string | null;
}

export function normalizeTaxId(value: string): string {
  return value.toUpperCase().replace(/[\s.\-/]/g, '');
}

/** Letra que le corresponde a un DNI o NIE por su parte numérica. */
export function dniLetter(number: number): string {
  return DNI_LETTERS[number % 23];
}

/** Carácter de control que le corresponde a un CIF. */
export function cifControl(prefix: string, digits: string): string {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 1) {
      // Posiciones pares del identificador: se suman tal cual.
      sum += d;
    } else {
      // Posiciones impares: se duplican y se suman las cifras del resultado.
      const doubled = d * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    }
  }
  const digit = (10 - (sum % 10)) % 10;
  return CIF_DIGIT_ONLY.includes(prefix)
    ? String(digit)
    : CIF_LETTER_ONLY.includes(prefix)
      ? CIF_LETTERS[digit]
      : String(digit);
}

/**
 * Comprueba un NIF, NIE o CIF español.
 *
 * Lo que no encaja con ninguno de los tres formatos españoles **no se
 * rechaza**: se devuelve como extranjero y sin verificar. Bloquear ahí dejaría
 * fuera a un proveedor portugués o a un VAT intracomunitario perfectamente
 * válidos, y ese sí sería un error caro. Lo que se rechaza es el que tiene
 * forma española y la letra no cuadra, porque eso solo puede ser un tecleo.
 */
export function checkTaxId(value: string): TaxIdCheck {
  const normalized = normalizeTaxId(value);

  if (normalized === '') {
    return {
      normalized,
      kind: null,
      valid: false,
      verified: false,
      reason: 'El NIF está vacío',
    };
  }

  // NIF de persona física: 8 dígitos y letra.
  const nif = /^(\d{8})([A-Z])$/.exec(normalized);
  if (nif) {
    const esperada = dniLetter(Number(nif[1]));
    return {
      normalized,
      kind: 'nif',
      valid: nif[2] === esperada,
      verified: true,
      reason:
        nif[2] === esperada
          ? null
          : `La letra del NIF no cuadra: a ${nif[1]} le corresponde la ${esperada}, no la ${nif[2]}`,
    };
  }

  // NIE: X, Y o Z, 7 dígitos y letra. La inicial vale 0, 1 o 2.
  const nie = /^([XYZ])(\d{7})([A-Z])$/.exec(normalized);
  if (nie) {
    const numero = Number(`${'XYZ'.indexOf(nie[1])}${nie[2]}`);
    const esperada = dniLetter(numero);
    return {
      normalized,
      kind: 'nie',
      valid: nie[3] === esperada,
      verified: true,
      reason:
        nie[3] === esperada
          ? null
          : `La letra del NIE no cuadra: le corresponde la ${esperada}, no la ${nie[3]}`,
    };
  }

  // CIF: letra de forma jurídica, 7 dígitos y carácter de control.
  const cif = /^([A-Z])(\d{7})([0-9A-Z])$/.exec(normalized);
  if (cif && CIF_PREFIXES.includes(cif[1])) {
    const esperado = cifControl(cif[1], cif[2]);
    // Los tipos que admiten ambos formatos aceptan el dígito o su letra.
    const alternativo = CIF_LETTERS[Number(esperado)] ?? null;
    const admiteAmbos =
      !CIF_DIGIT_ONLY.includes(cif[1]) && !CIF_LETTER_ONLY.includes(cif[1]);
    const ok = cif[3] === esperado || (admiteAmbos && alternativo === cif[3]);
    return {
      normalized,
      kind: 'cif',
      valid: ok,
      verified: true,
      reason: ok
        ? null
        : `El carácter de control del CIF no cuadra: a ${cif[1]}${cif[2]} le corresponde ${esperado}, no ${cif[3]}`,
    };
  }

  return {
    normalized,
    kind: 'extranjero',
    valid: true,
    verified: false,
    reason: null,
  };
}

/** ¿Es un identificador español con la letra correcta? */
export function isValidTaxId(value: string): boolean {
  return checkTaxId(value).valid;
}

/**
 * Aviso para un identificador ya guardado.
 *
 * Los contactos dados de alta antes de que hubiera validación pueden llevar un
 * NIF mal. No se corrigen solos ni se pueden corregir sin preguntar —a saber
 * cuál era el bueno—, así que se señalan donde se usan.
 */
export function taxIdWarning(value: string | null): string | null {
  if (value === null || value.trim() === '') {
    return 'Sin NIF: no se puede cruzar con el REA ni con los certificados de estar al corriente.';
  }
  const check = checkTaxId(value);
  if (!check.valid) {
    return `NIF incorrecto (${check.normalized}). ${check.reason}.`;
  }
  if (!check.verified) {
    return `El identificador ${check.normalized} no tiene formato español: no se ha podido comprobar. Verifícalo a mano si la empresa opera en España.`;
  }
  return null;
}
