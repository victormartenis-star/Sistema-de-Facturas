import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateXML } from 'xmllint-wasm';

/**
 * Validación de un XML Facturae 3.2.2 contra el XSD oficial en los e2e. Misma
 * técnica que `packages/shared/src/test-helpers/xsd.ts` (xmllint-wasm, sin
 * red): el import de xmldsig se sustituye EN MEMORIA por el fichero local.
 */
const DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'shared',
  'test-fixtures',
  'xsd',
);
const FACTURAE = 'Facturaev3_2_2.xml';
const XMLDSIG = 'xmldsig-core-schema.xsd';
const XMLDSIG_URL = 'http://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd';

export async function validateFacturaeXsd(
  xml: string,
): Promise<{ valid: boolean; errors: string[] }> {
  const schema = readFileSync(join(DIR, FACTURAE), 'utf8');
  if (!schema.includes(XMLDSIG_URL)) {
    throw new Error(
      'El XSD de Facturae ya no importa xmldsig por la URL esperada',
    );
  }
  const result = await validateXML({
    xml: [{ fileName: 'factura.xml', contents: xml }],
    schema: [
      { fileName: FACTURAE, contents: schema.replace(XMLDSIG_URL, XMLDSIG) },
    ],
    preload: [
      { fileName: XMLDSIG, contents: readFileSync(join(DIR, XMLDSIG), 'utf8') },
    ],
  });
  return {
    valid: result.valid,
    errors: result.errors.map((e) => e.rawMessage),
  };
}
