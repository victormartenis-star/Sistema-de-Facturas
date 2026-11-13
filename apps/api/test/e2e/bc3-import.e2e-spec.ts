import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { authed, createProject, createTestApp, registerUser } from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

// Fixtures SIMULADOS (mock de estructura estándar, no validados contra Presto).
const fixture = (n: string) =>
  readFileSync(join(__dirname, '..', 'fixtures', 'bc3', n));

describe('Importación BC3 (integración, fixtures SIMULADOS)', () => {
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

  async function setup() {
    const admin = await registerUser(app, { email: 'admin@test.dintel.es' });
    const project = await createProject(app, admin.accessToken);
    return { token: admin.accessToken, projectId: project.id };
  }

  const subir = (
    token: string,
    projectId: string,
    file: Buffer,
    nombre: string,
  ) =>
    authed(app, token)
      .post(`/projects/${projectId}/budgets/import/bc3`)
      .field('name', nombre)
      .attach('file', file, 'SIMULADO.bc3');

  it('importa la partida descompuesta con su precio calculado', async () => {
    const { token, projectId } = await setup();
    const res = await subir(
      token,
      projectId,
      fixture('SIMULADO-partida-descompuesta.bc3'),
      'Simulado descompuesto',
    ).expect(201);
    expect(res.body.budget.totalAmount).toBe(283.5);
    const detalle = await authed(app, token)
      .get(`/budgets/${res.body.budget.id}`)
      .expect(200);
    const p = detalle.body.items.find(
      (i: { code: string }) => i.code === 'P01',
    );
    expect(Number(p.unitPrice)).toBe(28.35);
  });

  it('rollback ACID: si falla a mitad no queda presupuesto ni partidas', async () => {
    const { token, projectId } = await setup();
    // 250 partidas únicas y una repetida al final: el lote 2 (>200) viola
    // UNIQUE(budget_id, code) después de haber insertado el lote 1.
    const lineas = [
      '~C|ROOT##||Raiz|0|',
      '~C|CAP#||Cap|0|',
      '~D|ROOT##|CAP#|1|',
    ];
    for (let i = 0; i < 250; i++) {
      lineas.push(`~C|P${i}|ud|Partida ${i}|1.00|`, `~D|CAP#|P${i}|1|`);
    }
    lineas.push('~D|CAP#|P3|1|');
    const antes = await authed(app, token)
      .get(`/projects/${projectId}/budgets`)
      .expect(200);
    await subir(
      token,
      projectId,
      Buffer.from(lineas.join('\n')),
      'Roto',
    ).expect(400);
    const despues = await authed(app, token)
      .get(`/projects/${projectId}/budgets`)
      .expect(200);
    expect(despues.body).toHaveLength(antes.body.length);
    expect(despues.body).toHaveLength(0);
  });
});
