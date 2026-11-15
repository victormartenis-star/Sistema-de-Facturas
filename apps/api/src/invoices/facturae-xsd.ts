import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateXML } from 'xmllint-wasm';

/**
 * Validación de un XML Facturae 3.2.2 contra el XSD oficial con
 * `xmllint-wasm` (libxml2 en WebAssembly, sin red ni binarios nativos).
 *
 * Los esquemas se reutilizan de `packages/shared/test-fixtures/xsd` (los
 * mismos que usan los tests de `@erp/shared`; su sha256 se comprueba allí).
 * El XSD de Facturae importa xmldsig por URL http; como xmllint-wasm no hace
 * peticiones de red, se sustituye EN MEMORIA ese `schemaLocation` por el
 * fichero local y xmldsig se pasa como `preload`.
 */
const FACTURAE_XSD = 'Facturaev3_2_2.xml';
const XMLDSIG_XSD = 'xmldsig-core-schema.xsd';
const XMLDSIG_URL = 'http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd';

export interface ResultadoXsd {
  valid: boolean;
  errors: string[];
}

let esquemas: { facturae: string; xmldsig: string } | undefined;

function cargarEsquemas() {
  if (!esquemas) {
    const dir = join(
      dirname(require.resolve('@erp/shared/package.json')),
      'test-fixtures',
      'xsd',
    );
    const original = readFileSync(join(dir, FACTURAE_XSD), 'utf8');
    if (!original.includes(XMLDSIG_URL)) {
      throw new Error(
        'El XSD de Facturae ya no importa xmldsig por la URL esperada',
      );
    }
    esquemas = {
      facturae: original.replace(XMLDSIG_URL, XMLDSIG_XSD),
      xmldsig: readFileSync(join(dir, XMLDSIG_XSD), 'utf8'),
    };
  }
  return esquemas;
}

export async function validarFacturaeXsd(xml: string): Promise<ResultadoXsd> {
  const { facturae, xmldsig } = cargarEsquemas();
  const result = await validateXML({
    xml: [{ fileName: 'factura.xml', contents: xml }],
    schema: [{ fileName: FACTURAE_XSD, contents: facturae }],
    preload: [{ fileName: XMLDSIG_XSD, contents: xmldsig }],
  });
  return {
    valid: result.valid,
    errors: result.errors.map((e) => e.rawMessage),
  };
}
