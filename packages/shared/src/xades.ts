/**
 * XAdES-BES (Fase 14): las propiedades firmadas que distinguen una firma
 * XAdES de un XML-DSig genérico — `SigningTime` y el resumen (digest) del
 * certificado del firmante, vinculados criptográficamente a la firma
 * porque `SignedProperties` se referencia como un segundo `<Reference>`
 * firmado, igual que el documento en sí.
 *
 * **Alcance**: implementa las dos propiedades obligatorias de XAdES-BES
 * (`SigningCertificate`, `SigningTime`) contra la disposición publicada en
 * ETSI EN 319 132-1. No incluye `SignaturePolicyIdentifier` (opcional en
 * BES) ni se ha validado con un verificador XAdES oficial — mismo criterio
 * de honestidad que `verifactu.ts`: revisar antes de un uso legal real.
 */

export interface XadesSignedPropertiesInput {
  /** Id del elemento `SignedProperties` — lo referencia el `<Reference>` correspondiente. */
  signedPropertiesId: string;
  /** ISO 8601, con offset. */
  signingTime: string;
  /** SHA-256 del certificado (DER), en base64 — no el PEM completo. */
  certDigestSha256Base64: string;
  /** Nombre distinguido del emisor del certificado (`cert.issuer` de Node), tal cual. */
  certIssuerName: string;
  certSerialNumber: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** `SignedProperties` de XAdES-BES. Función pura. */
export function buildXadesSignedPropertiesXml(
  input: XadesSignedPropertiesInput,
): string {
  return `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="${escapeXml(input.signedPropertiesId)}">
        <xades:SignedSignatureProperties>
          <xades:SigningTime>${escapeXml(input.signingTime)}</xades:SigningTime>
          <xades:SigningCertificate>
            <xades:Cert>
              <xades:CertDigest>
                <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256" />
                <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${escapeXml(input.certDigestSha256Base64)}</ds:DigestValue>
              </xades:CertDigest>
              <xades:IssuerSerial>
                <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${escapeXml(input.certIssuerName)}</ds:X509IssuerName>
                <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${escapeXml(input.certSerialNumber)}</ds:X509SerialNumber>
              </xades:IssuerSerial>
            </xades:Cert>
          </xades:SigningCertificate>
        </xades:SignedSignatureProperties>
      </xades:SignedProperties>`;
}

export interface XadesObjectInput extends XadesSignedPropertiesInput {
  /** Id del `<ds:Object>` que envuelve las QualifyingProperties. */
  objectId: string;
  /** `#<Id del Signature>` al que se refieren estas propiedades. */
  signatureTargetUri: string;
}

/** `<ds:Object>` completo con `QualifyingProperties/SignedProperties`, listo para insertarse en el documento antes de firmar. Función pura. */
export function buildXadesObjectXml(input: XadesObjectInput): string {
  const signedProperties = buildXadesSignedPropertiesXml(input);
  return `<ds:Object xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="${escapeXml(input.objectId)}"><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="${escapeXml(input.signatureTargetUri)}">${signedProperties}</xades:QualifyingProperties></ds:Object>`;
}
