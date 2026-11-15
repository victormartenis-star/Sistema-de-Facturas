import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { authed, createProject, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';
import { cadenaDe, limpiarEmpresasExtra } from './audit-test-utils';

/**
 * Servicios migrados a `audit.registrar(tx, …)` que no tenían spec propio
 * (e-signature, fleet-iot): comprueban que su auditoría llega a la cadena,
 * dentro de la transacción de negocio y con la secuencia correcta.
 */
describe('Auditoría (integración) — servicios sin spec propio', () => {
  let app: INestApplication;
  let companyId: string;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    companyId = await seedCompany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetTestDb();
    await limpiarEmpresasExtra(companyId);
    token = (await registerUser(app)).accessToken;
  });

  it('e-signature: crear, firmar y rechazar auditan en la cadena', async () => {
    const obra = await createProject(app, token);
    const c = authed(app, token);
    const creada = await c
      .post('/e-signature/requests')
      .send({
        projectId: obra.id,
        entityTipo: 'parte_diario',
        entityId: randomUUID(),
        titulo: 'Parte de prueba',
        firmantes: [{ nombre: 'Ana' }, { nombre: 'Luis' }],
      })
      .expect(201);
    const [ana, luis] = creada.body.firmantes as { id: string }[];
    await c
      .post(
        `/e-signature/requests/${creada.body.id}/firmantes/${ana.id}/firmar`,
      )
      .send({ firmaData: 'dHJhem8=' })
      .expect(201);
    await c
      .post(
        `/e-signature/requests/${creada.body.id}/firmantes/${luis.id}/rechazar`,
      )
      .send({ motivo: 'No procede' })
      .expect(201);
    const tipos = (await cadenaDe(companyId)).map((f) => f.entityType);
    expect(tipos).toEqual([
      'project',
      'signature_request',
      'signature_signer',
      'signature_signer',
    ]);
    const informe = await c.get('/audit/verify-integrity').expect(200);
    expect(informe.body.integra).toBe(true);
  });

  it('fleet-iot: la ingesta de telemetría con alerta audita lectura y alerta en una sola llamada', async () => {
    const c = authed(app, token);
    const equipo = await c
      .post('/equipos')
      .send({ nombre: 'Excavadora 1' })
      .expect(201);
    const res = await c
      .post('/fleet-iot/telemetria')
      .send({ equipoId: equipo.body.id, combustibleNivelPct: 2 })
      .expect(201);
    expect(res.body.alertas.length).toBeGreaterThan(0);
    const filas = await cadenaDe(companyId);
    const tipos = filas.map((f) => f.entityType);
    expect(tipos).toContain('equipo');
    expect(tipos).toContain('iot_alerta');
    expect(tipos[tipos.length - 1]).toBe('iot_lectura_telemetria');
    const informe = await c.get('/audit/verify-integrity').expect(200);
    expect(informe.body.integra).toBe(true);
  });
});
