import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authed, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * `informes` (Fase 15, informe mensual redactado por IA): igual que
 * `copiloto.e2e-spec.ts`/`contract-ai.e2e-spec.ts`, se quita
 * `ANTHROPIC_API_KEY` del entorno explícitamente — `InformesService`
 * comprueba `enabled` antes de tocar la base de datos o llamar a Claude, así
 * que ni una obra inexistente ni una válida llegan a ejercitar esa rama en
 * ningún test de este fichero; probar la redacción real exigiría una
 * llamada de red real, fuera del control de un test determinista.
 */
describe('Informes (integración) — informe mensual redactado por IA', () => {
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

  it('POST /informes/mensual responde 400 sin ANTHROPIC_API_KEY', async () => {
    const admin = await registerUser(app);

    const res = await authed(app, admin.accessToken)
      .post('/informes/mensual?mes=2026-09')
      .expect(400);
    expect(res.body.message).toContain('ANTHROPIC_API_KEY');
  });

  it('exige el formato AAAA-MM en "mes" (400 del ZodValidationPipe, antes de llegar al servicio)', async () => {
    const admin = await registerUser(app);

    await authed(app, admin.accessToken)
      .post('/informes/mensual?mes=septiembre')
      .expect(400);

    await authed(app, admin.accessToken).post('/informes/mensual').expect(400);
  });

  it('exige token', async () => {
    await request(app.getHttpServer())
      .post('/informes/mensual?mes=2026-09')
      .expect(401);
  });

  it('POST /informes/mensual/email valida el cuerpo (destinatarios, formato de email)', async () => {
    const admin = await registerUser(app);

    await authed(app, admin.accessToken)
      .post('/informes/mensual/email')
      .send({ markdown: 'Informe', mes: '2026-09', to: [] })
      .expect(400);

    await authed(app, admin.accessToken)
      .post('/informes/mensual/email')
      .send({ markdown: 'Informe', mes: '2026-09', to: ['no-es-un-email'] })
      .expect(400);
  });

  it('POST /informes/mensual/email no falla sin SMTP configurado — degrada a sent:false', async () => {
    const admin = await registerUser(app);

    const res = await authed(app, admin.accessToken)
      .post('/informes/mensual/email')
      .send({
        markdown: '# Informe de prueba',
        mes: '2026-09',
        to: ['gerencia@dintel.es'],
      })
      .expect(201);
    expect(res.body).toEqual({ sent: false });
  });
});
