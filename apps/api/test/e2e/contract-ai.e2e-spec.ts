import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authed, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * `contract-ai` (Bloque 1, ítem 2): igual que `copiloto.e2e-spec.ts`, se
 * quita `ANTHROPIC_API_KEY` del entorno explícitamente en vez de asumir que
 * no está — el `.env` de desarrollo local de este equipo sí trae una clave
 * real, así que no hay llamada de red real en ningún test de este fichero.
 */
describe('Contract AI (integración) — auditoría de contratos', () => {
  let app: INestApplication;
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

  it('POST /contract-ai/auditar responde 400 sin ANTHROPIC_API_KEY', async () => {
    const admin = await registerUser(app);

    const res = await authed(app, admin.accessToken)
      .post('/contract-ai/auditar')
      .send({ text: 'Cláusula de penalización desproporcionada...' })
      .expect(400);
    expect(res.body.message).toContain('ANTHROPIC_API_KEY');
  });

  it('exige documentId o text (400 del ZodValidationPipe, antes de llegar al servicio)', async () => {
    const admin = await registerUser(app);

    await authed(app, admin.accessToken)
      .post('/contract-ai/auditar')
      .send({})
      .expect(400);
  });

  it('lista vacío sin auditorías previas', async () => {
    const admin = await registerUser(app);

    const res = await authed(app, admin.accessToken)
      .get('/contract-ai/auditorias')
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('exige token', async () => {
    await request(app.getHttpServer())
      .post('/contract-ai/auditar')
      .send({ text: 'hola' })
      .expect(401);
  });
});
