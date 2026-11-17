import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getDb, invoices } from '@erp/db';
import { authed, createContact, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';
import { validateFacturaeXsd } from './xsd-facturae';

/**
 * Estado `no_valido` de la validación XSD de Facturae 3.2.2.
 *
 * El XML no conforme se provoca por un camino real, no con un mock: la razón
 * social de un contacto admite hasta 200 caracteres (`contactCreateSchema`),
 * pero `CorporateName` en el XSD oficial es `TextMax80Type`. El Facturae que
 * se genera para ese cliente es, por tanto, rechazado por el esquema.
 *
 * Lo que se comprueba (ver `FacturaeService.persistirValidacionXsd`):
 * - la descarga NO se bloquea (200 con el XML): el estado es un metadato;
 * - `facturae_xsd_status = 'no_valido'` y `facturae_xsd_errors` con el motivo;
 * - el DTO de `GET /invoices/:id` y del listado expone `no_valido`;
 * - la huella VeriFactu se persiste igualmente y la siguiente factura (válida)
 *   encadena con ella: el rechazo XSD no rompe el flujo transaccional.
 */
describe('Facturae — validación XSD con resultado no_valido (integración)', () => {
  let app: INestApplication;

  const RAZON_SOCIAL_LARGA =
    'Constructora de Infraestructuras y Rehabilitación Integral del Mediterráneo Sociedad Limitada Unipersonal';

  beforeAll(async () => {
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  async function crearFacturaVentaAprobada(
    token: string,
    contactId: string,
    issueDate: string,
  ): Promise<string> {
    const res = await authed(app, token)
      .post('/invoices')
      .send({
        kind: 'venta',
        contactId,
        // Facturae limita InvoiceNumber a 20 caracteres.
        invoiceNumber: `FX-${Math.random().toString(36).slice(2, 10)}`,
        issueDate,
        lines: [
          {
            description: 'Certificación mensual',
            baseAmount: 1000,
            vatPct: 21,
          },
        ],
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    await authed(app, token).post(`/invoices/${id}/aprobar`).expect(201);
    return id;
  }

  it('el validador rechaza XML corrupto o no conforme con el XSD', async () => {
    expect(RAZON_SOCIAL_LARGA.length).toBeGreaterThan(80);

    // Raíz desconocida en el espacio de nombres de Facturae.
    const ajeno = await validateFacturaeXsd(
      '<?xml version="1.0" encoding="UTF-8"?><fe:Factura xmlns:fe="http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml"/>',
    );
    expect(ajeno.valid).toBe(false);
    expect(ajeno.errors.length).toBeGreaterThan(0);

    // Raíz correcta pero sin ninguno de los bloques obligatorios.
    const vacio = await validateFacturaeXsd(
      '<?xml version="1.0" encoding="UTF-8"?><fe:Facturae xmlns:fe="http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml"/>',
    );
    expect(vacio.valid).toBe(false);
    expect(vacio.errors.join('\n')).toMatch(/FileHeader/);
  });

  it('persiste no_valido, lo expone en la API y no bloquea la descarga ni la cadena VeriFactu', async () => {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const clienteLargo = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      legalName: RAZON_SOCIAL_LARGA,
      taxId: 'B44444444',
    });
    const facturaMala = await crearFacturaVentaAprobada(
      admin.accessToken,
      clienteLargo.id,
      '2026-09-10',
    );

    const antes = await authed(app, admin.accessToken)
      .get(`/invoices/${facturaMala}`)
      .expect(200);
    expect(
      (antes.body as { facturaeXsdStatus: string | null }).facturaeXsdStatus,
    ).toBeNull();

    // La descarga sigue funcionando: el XML no conforme se entrega igual.
    const xml = await authed(app, admin.accessToken)
      .get(`/invoices/${facturaMala}/facturae`)
      .expect(200);
    expect(xml.text).toContain('<CorporateName>');
    expect((await validateFacturaeXsd(xml.text)).valid).toBe(false);

    const [fila] = await getDb()
      .select()
      .from(invoices)
      .where(eq(invoices.id, facturaMala));
    expect(fila.facturaeXsdStatus).toBe('no_valido');
    expect(fila.facturaeXsdErrors).toMatch(/CorporateName/);
    // Solo falla la razón social: el resto del documento es conforme.
    expect(fila.facturaeXsdErrors?.split('\n')).toHaveLength(1);
    // El rechazo XSD no deshace la huella VeriFactu ni el estado de la factura.
    expect(fila.verifactuHash).toHaveLength(64);
    expect(fila.status).toBe('aprobada');

    const detalle = await authed(app, admin.accessToken)
      .get(`/invoices/${facturaMala}`)
      .expect(200);
    expect(
      (detalle.body as { facturaeXsdStatus: string | null }).facturaeXsdStatus,
    ).toBe('no_valido');

    const listado = await authed(app, admin.accessToken)
      .get('/invoices')
      .expect(200);
    const filas = (
      Array.isArray(listado.body)
        ? listado.body
        : (listado.body as { items: unknown[] }).items
    ) as { id: string; facturaeXsdStatus: string | null }[];
    expect(filas.find((f) => f.id === facturaMala)?.facturaeXsdStatus).toBe(
      'no_valido',
    );

    // Una factura posterior válida sigue el flujo normal y encadena con la anterior.
    const clienteOk = await createContact(app, admin.accessToken, {
      kind: 'cliente',
      taxId: 'B55555555',
    });
    const facturaBuena = await crearFacturaVentaAprobada(
      admin.accessToken,
      clienteOk.id,
      '2026-09-11',
    );
    await authed(app, admin.accessToken)
      .get(`/invoices/${facturaBuena}/facturae`)
      .expect(200);
    const [buena] = await getDb()
      .select()
      .from(invoices)
      .where(eq(invoices.id, facturaBuena));
    expect(buena.facturaeXsdStatus).toBe('valido');
    expect(buena.facturaeXsdErrors).toBeNull();
    expect(buena.verifactuPreviousHash).toBe(fila.verifactuHash);

    // Regenerar la mala no la "arregla" por accidente: sigue no_valido.
    await authed(app, admin.accessToken)
      .get(`/invoices/${facturaMala}/facturae`)
      .expect(200);
    const [otraVez] = await getDb()
      .select()
      .from(invoices)
      .where(eq(invoices.id, facturaMala));
    expect(otraVez.facturaeXsdStatus).toBe('no_valido');
    expect(otraVez.verifactuHash).toBe(fila.verifactuHash);
  });
});
