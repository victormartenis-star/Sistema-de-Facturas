import { X509Certificate, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { buildXadesObjectXml } from '@erp/shared';
import { SignedXml } from 'xml-crypto';

const SIGNATURE_ID = 'Signature';
const SIGNED_PROPERTIES_ID = 'SignedProperties';
const XADES_OBJECT_ID = 'XadesObject';

/**
 * Firma XAdES-BES del XML Facturae (Fase 14).
 *
 * Mismo patrón "opt-in silencioso" que `VerifactuSubmissionService`: sin
 * `FACTURAE_CERT_PATH`/`FACTURAE_KEY_PATH`, `enabled` es `false` y
 * `FacturaeService` sigue devolviendo el XML sin firmar de siempre.
 *
 * Firma con `xml-crypto` (XML-DSig enveloped, RSA-SHA256, exc-C14N) más las
 * dos propiedades XAdES-BES obligatorias (`SigningTime` y el digest del
 * certificado del firmante, `packages/shared/src/xades.ts`) — **no** valida
 * contra ningún verificador XAdES oficial, y espera cert/clave como PEM
 * separados (`FACTURAE_KEY_PATH`), no un `.p12` combinado: un certificado
 * cualificado real (típicamente FNMT) se distribuye como `.p12` y habría
 * que convertirlo una vez con `openssl pkcs12 -in cert.p12 ...` antes de
 * usarlo aquí — deliberado, para no añadir una dependencia de parseo de
 * PKCS12 solo para un certificado de prueba autofirmado.
 *
 * **Desviación estructural conocida**: el XSD de XML-DSig define `Object`
 * como hijo de `Signature`, pero `xml-crypto` construye el nodo
 * `<Signature>` él mismo dentro de `computeSignature()` y no admite
 * inyectarle contenido propio — aquí el `<ds:Object>` con las
 * `QualifyingProperties` se inserta como **hermano** de `<ds:Signature>`
 * (ambos hijos de `fe:Facturae`), no anidado dentro. Se probó anidarlo
 * reubicándolo después de firmar, pero eso invalida la firma: la
 * transformación *enveloped-signature* del `Reference` sobre el documento
 * completo excluye todo lo que quede dentro de `<Signature>` al verificar,
 * así que un `Object` reubicado allí después deja de contar en el digest
 * que sí se calculó (con el `Object` todavía fuera) al firmar. La firma
 * **sí valida criptográficamente** con esta disposición (comprobado en
 * `facturae.e2e-spec.ts` con `SignedXml.checkSignature()`); un validador
 * estricto de esquema XAdES señalaría la posición del `Object` como no
 * conforme.
 */
@Injectable()
export class FacturaeSigningService {
  get enabled(): boolean {
    return Boolean(
      process.env.FACTURAE_CERT_PATH && process.env.FACTURAE_KEY_PATH,
    );
  }

  sign(xml: string): string {
    const certPem = readFileSync(process.env.FACTURAE_CERT_PATH!, 'utf-8');
    const keyPem = readFileSync(process.env.FACTURAE_KEY_PATH!, 'utf-8');
    const cert = new X509Certificate(certPem);
    const certDigest = createHash('sha256').update(cert.raw).digest('base64');

    const xadesObject = buildXadesObjectXml({
      objectId: XADES_OBJECT_ID,
      signatureTargetUri: `#${SIGNATURE_ID}`,
      signedPropertiesId: SIGNED_PROPERTIES_ID,
      signingTime: new Date().toISOString(),
      certDigestSha256Base64: certDigest,
      certIssuerName: cert.issuer.replace(/\n/g, ','),
      certSerialNumber: cert.serialNumber,
    });

    // Se inserta como último hijo de la raíz, antes de firmar, para poder
    // referenciarlo con un segundo `<Reference>` — `xml-crypto` no permite
    // construir a mano el `<Object>` dentro de la firma que genera él mismo.
    const withObject = xml.replace(/(<\/fe:Facturae>)\s*$/, `${xadesObject}$1`);

    const sig = new SignedXml({ privateKey: keyPem, publicCert: certPem });
    sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
    sig.signatureAlgorithm =
      'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
    sig.addReference({
      xpath: '/*',
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });
    sig.addReference({
      xpath: `//*[@Id='${SIGNED_PROPERTIES_ID}']`,
      transforms: ['http://www.w3.org/2001/10/xml-exc-c14n#'],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      uri: `#${SIGNED_PROPERTIES_ID}`,
    });

    sig.computeSignature(withObject, {
      prefix: 'ds',
      attrs: { Id: SIGNATURE_ID },
    });

    return sig.getSignedXml();
  }
}
