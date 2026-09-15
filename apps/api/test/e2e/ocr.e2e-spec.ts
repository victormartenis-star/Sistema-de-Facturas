import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authed, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * `ocr` (Fase 11, cierre de cobertura): sin `ANTHROPIC_API_KEY` en el
 * entorno de test (`jest.setup-env.ts` no la fija), `ExtractionService.
 * enabled` es `false` de forma determinista — no hay llamada de red real
 * en ningún test de este fichero. Lo que SÍ depende de una lectura de IA
 * real (`validate()` con datos ya extraídos) no tiene ningún endpoint que
 * la simule sin pasar por Anthropic, así que solo se prueba la mitad del
 * contrato que es alcanzable por HTTP real: el guard que la rechaza sin
 * extracción todavía, y el resto del ciclo de vida (`pending`, `reject`)
 * que sí es independiente de la IA.
 */
describe('OCR (integración) — pipeline desactivado en test y bandeja de validación', () => {
  let app: INestApplication;

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

  async function uploadDocument(token: string): Promise<string> {
    const res = await authed(app, token)
      .post('/documents')
      .attach('file', Buffer.from('%PDF-1.4 factura de prueba'), {
        filename: 'factura.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    return res.body.id as string;
  }

  it('GET /ocr/estado informa que el pipeline está desactivado sin ANTHROPIC_API_KEY', async () => {
    const admin = await registerUser(app);
    const res = await authed(app, admin.accessToken)
      .get('/ocr/estado')
      .expect(200);
    expect(res.body).toEqual({ enabled: false, model: null });
  });

  it('POST /documents/:id/extraer responde 400 con el pipeline desactivado', async () => {
    const admin = await registerUser(app);
    const docId = await uploadDocument(admin.accessToken);

    const res = await authed(app, admin.accessToken)
      .post(`/documents/${docId}/extraer`)
      .expect(400);
    expect(res.body.message).toContain('ANTHROPIC_API_KEY');
  });

  it('GET /validacion no lista un documento recién subido (todavía no lo tocó la IA)', async () => {
    const admin = await registerUser(app);
    await uploadDocument(admin.accessToken);

    const res = await authed(app, admin.accessToken)
      .get('/validacion')
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('POST /validacion/:id/validar responde 400 si el documento no tiene ninguna lectura de la IA', async () => {
    const admin = await registerUser(app);
    const docId = await uploadDocument(admin.accessToken);

    const res = await authed(app, admin.accessToken)
      .post(`/validacion/${docId}/validar`)
      .send({})
      .expect(400);
    expect(res.body.message).toContain('lectura de la IA');
  });

  it('POST /validacion/:id/rechazar marca el documento como rechazado sin necesitar extracción', async () => {
    const admin = await registerUser(app);
    const docId = await uploadDocument(admin.accessToken);

    await authed(app, admin.accessToken)
      .post(`/validacion/${docId}/rechazar`)
      .expect(204);

    const doc = await authed(app, admin.accessToken)
      .get(`/documents/${docId}`)
      .expect(200);
    expect(doc.body.status).toBe('rechazado');
  });

  it('devuelve 404 al operar sobre un documento inexistente', async () => {
    const admin = await registerUser(app);
    const fakeId = '00000000-0000-4000-8000-000000000000';
    await authed(app, admin.accessToken)
      .post(`/documents/${fakeId}/extraer`)
      .expect(404);
    await authed(app, admin.accessToken)
      .post(`/validacion/${fakeId}/rechazar`)
      .expect(404);
  });

  it('exige token', async () => {
    await request(app.getHttpServer()).get('/ocr/estado').expect(401);
  });
});
