import { describe, expect, it } from 'vitest';
import {
  buildXadesObjectXml,
  buildXadesSignedPropertiesXml,
  type XadesObjectInput,
} from './xades';

const baseInput: XadesObjectInput = {
  objectId: 'XadesObject',
  signatureTargetUri: '#Signature',
  signedPropertiesId: 'SignedProperties',
  signingTime: '2026-09-16T12:00:00+02:00',
  certDigestSha256Base64: 'ZGlnZXN0Zml4dHVyZQ==',
  certIssuerName: 'CN=Test ERP Dintel,O=Empresa de Pruebas,C=ES',
  certSerialNumber: '123456789',
};

describe('buildXadesSignedPropertiesXml', () => {
  it('incluye SigningTime y el digest del certificado', () => {
    const xml = buildXadesSignedPropertiesXml(baseInput);
    expect(xml).toContain('Id="SignedProperties"');
    expect(xml).toContain(
      '<xades:SigningTime>2026-09-16T12:00:00+02:00</xades:SigningTime>',
    );
    expect(xml).toContain(
      '<ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">ZGlnZXN0Zml4dHVyZQ==</ds:DigestValue>',
    );
    expect(xml).toContain('<ds:X509SerialNumber');
  });

  it('escapa el nombre del emisor si trae caracteres especiales', () => {
    const xml = buildXadesSignedPropertiesXml({
      ...baseInput,
      certIssuerName: 'CN=Test & Co "ES"',
    });
    expect(xml).toContain('CN=Test &amp; Co &quot;ES&quot;');
  });
});

describe('buildXadesObjectXml', () => {
  it('envuelve las SignedProperties en un ds:Object con QualifyingProperties apuntando a la firma', () => {
    const xml = buildXadesObjectXml(baseInput);
    expect(xml).toContain('<ds:Object');
    expect(xml).toContain('Id="XadesObject"');
    expect(xml).toContain('<xades:QualifyingProperties');
    expect(xml).toContain('Target="#Signature"');
    expect(xml).toContain('<xades:SignedProperties');
  });
});
