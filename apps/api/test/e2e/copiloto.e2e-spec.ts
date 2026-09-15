import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authed, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * `copiloto` (Fase 11, cierre de cobertura): `CopilotoService.query()`
 * llama a la API de Anthropic (Claude Haiku) — sin `ANTHROPIC_API_KEY` el
 * servicio lo comprueba primero y degrada con una respuesta explicativa
 * (200, no un error) en vez de llamar a la red, así que no hay llamada
 * real en ningún test de este fichero.
 */
describe('Copiloto (integración) — desactivado sin ANTHROPIC_API_KEY', () => {
  let app: INestApplication;
  // El `.env` de desarrollo local puede traer una clave real (para probar
  // el pipeline OCR/IA a mano); este fichero prueba justo el camino sin
  // clave, así que la quitamos del entorno del proceso explícitamente en
  // vez de asumir que `jest.setup-env.ts` no la fija.
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    app = await createTestApp();
    await seedCompany();
  });

  afterAll(async () => {
    await app.close();
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  it('POST /copiloto/query degrada con una respuesta explicativa sin llamar a la red', async () => {
    const admin = await registerUser(app);

    const res = await authed(app, admin.accessToken)
      .post('/copiloto/query')
      .send({ question: '¿Cuántas obras en curso tenemos?' })
      .expect(201);
    expect(res.body.answer).toContain('ANTHROPIC_API_KEY');
    expect(res.body.toolsUsed).toEqual([]);
  });

  it('valida la pregunta antes de llegar al servicio: vacía o demasiado larga es 400', async () => {
    const admin = await registerUser(app);

    await authed(app, admin.accessToken)
      .post('/copiloto/query')
      .send({ question: '' })
      .expect(400);

    await authed(app, admin.accessToken)
      .post('/copiloto/query')
      .send({ question: 'x'.repeat(2001) })
      .expect(400);
  });

  it('exige token', async () => {
    await request(app.getHttpServer())
      .post('/copiloto/query')
      .send({ question: 'hola' })
      .expect(401);
  });
});
