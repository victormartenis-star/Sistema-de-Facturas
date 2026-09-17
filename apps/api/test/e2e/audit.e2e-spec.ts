import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authed, createObraUser, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Audit (integración) — historial y filtros', () => {
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

  it(
    'acepta como filtro todos los `entityType` que algún módulo escribe realmente ' +
      '(regresión: quedaban fuera de `AUDIT_ENTITY_TYPES` y `auditQuerySchema.parse()` los rechazaba con 400)',
    async () => {
      const admin = await registerUser(app);
      const client = authed(app, admin.accessToken);
      const recentlyAddedTypes = [
        'comparativo',
        'comparativo_oferta',
        'parte_personal',
        'parte_maquinaria',
        'bim_model',
        'esg_registro_emision',
        'investor',
        'signature_request',
      ];
      for (const entityType of recentlyAddedTypes) {
        const res = await client
          .get(`/audit?entityType=${entityType}`)
          .expect(200);
        expect(res.body).toEqual([]);
      }
    },
  );

  it('rechaza un `entityType` que ningún módulo escribe, con 400', async () => {
    const admin = await registerUser(app);
    await authed(app, admin.accessToken)
      .get('/audit?entityType=tipo_que_no_existe')
      .expect(400);
  });

  it('un rol sin `admin`/`gerente` recibe 403', async () => {
    const admin = await registerUser(app);
    const { tokens: obraTokens } = await createObraUser(
      app,
      admin.accessToken,
      [],
    );
    await authed(app, obraTokens.accessToken).get('/audit').expect(403);
  });

  it('rechaza cualquier petición sin token con 401', async () => {
    await request(app.getHttpServer()).get('/audit').expect(401);
  });
});
