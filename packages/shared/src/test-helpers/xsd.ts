/**
 * Utilidad SOLO de tests: valida un XML contra el XSD oficial de Facturae
 * 3.2.2 con `xmllint-wasm` (libxml2 en WebAssembly, sin red ni binarios
 * nativos). Excluida del build (`tsconfig.build.json`) y de la cobertura.
 *
 * Los esquemas viven en `test-fixtures/xsd/` y su sha256 se comprueba en
 * `xsd.test.ts`:
 * - `Facturaev3_2_2.xml`: XSD oficial, descargado de
 *   https://www.facturae.gob.es/content/dam/facturae/formato/versiones/Facturaev3_2_2.xml
 * - `xmldsig-core-schema.xsd`: esquema XMLDSig del W3C
 *   (http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd).
 *
 * El XSD de Facturae importa xmldsig por URL http. Como xmllint-wasm no hace
 * peticiones de red, se sustituye EN MEMORIA ese `schemaLocation` por el
 * nombre del fichero local y se pasa xmldsig como `preload`. El fichero del
 * repo no se modifica (así su sha256 sigue siendo el del original).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateXML } from 'xmllint-wasm';

export const XSD_DIR = join(__dirname, '..', '..', 'test-fixtures', 'xsd');
export const FACTURAE_XSD_FILE = 'Facturaev3_2_2.xml';
export const XMLDSIG_XSD_FILE = 'xmldsig-core-schema.xsd';

const XMLDSIG_HTTP_LOCATION =
  'http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd';

export function readXsdFile(name: string): string {
  return readFileSync(join(XSD_DIR, name), 'utf8');
}

export function sha256OfXsdFile(name: string): string {
  return createHash('sha256')
    .update(readFileSync(join(XSD_DIR, name)))
    .digest('hex');
}

/** Contenido del XSD de Facturae con el import de xmldsig apuntando al fichero local. */
export function facturaeSchemaForOffline(): string {
  const original = readXsdFile(FACTURAE_XSD_FILE);
  if (!original.includes(XMLDSIG_HTTP_LOCATION)) {
    throw new Error(
      'El XSD de Facturae ya no importa xmldsig por la URL esperada',
    );
  }
  return original.replace(XMLDSIG_HTTP_LOCATION, XMLDSIG_XSD_FILE);
}

export interface XsdValidationResult {
  valid: boolean;
  errors: string[];
}

/** Valida `xml` contra el XSD de Facturae 3.2.2. `errors` vacío ⇔ válido. */
export async function validateFacturaeXsd(
  xml: string,
): Promise<XsdValidationResult> {
  const result = await validateXML({
    xml: [{ fileName: 'factura.xml', contents: xml }],
    schema: [
      { fileName: FACTURAE_XSD_FILE, contents: facturaeSchemaForOffline() },
    ],
    preload: [
      { fileName: XMLDSIG_XSD_FILE, contents: readXsdFile(XMLDSIG_XSD_FILE) },
    ],
  });
  return {
    valid: result.valid,
    errors: result.errors.map((e) => e.rawMessage),
  };
}
