import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { auditLog, getDb } from '@erp/db';
import {
  calcularHashAuditoria,
  entradaDeFila,
} from '../../src/audit/audit-chain';
import { authed, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

describe('Auditoría — correlation_id (integración)', () => {
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

  it('el X-Request-Id de la petición queda en audit_log, en el hash y filtra GET /audit', async () => {
    const admin = await registerUser(app);
    const crear = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('X-Request-Id', 'abc12345')
      .send({
        code: 'OBRA-CORR',
        name: 'Obra correlacion',
        contractAmount: 1000,
      })
      .expect(201);
    const projectId = crear.body.id as string;

    const filas = await getDb()
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, projectId),
          eq(auditLog.correlationId, 'abc12345'),
        ),
      );
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(fila.correlationId).toBe('abc12345');
    // El correlationId forma parte del hash: recalcularlo desde la fila coincide...
    expect(
      calcularHashAuditoria(entradaDeFila(fila, fila.previousHash as string)),
    ).toBe(fila.entryHash);
    // ...y alterarlo lo cambia.
    expect(
      calcularHashAuditoria({
        ...entradaDeFila(fila, fila.previousHash as string),
        correlationId: 'otro-12345',
      }),
    ).not.toBe(fila.entryHash);

    const res = await authed(app, admin.accessToken)
      .get('/audit?correlationId=abc12345')
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      entityId: projectId,
      correlationId: 'abc12345',
    });
    const otra = await authed(app, admin.accessToken)
      .get('/audit?correlationId=no-existe-1')
      .expect(200);
    expect(otra.body).toEqual([]);
  });
});
