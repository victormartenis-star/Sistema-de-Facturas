import { INestApplication } from '@nestjs/common';
import {
  activateBudget,
  addBudgetItem,
  authed,
  createBudget,
  createProject,
  createTestApp,
  registerUser,
} from './helpers';
import { resetTestDb, seedCompany } from './reset-db';

/**
 * `bim` (Bloque 1, ítem 1): el backend solo guarda metadatos, el original
 * `.ifc` y los vínculos elemento↔partida — el parseo/render es 100% cliente
 * (`web-ifc` + `three`), así que un buffer de texto cualquiera basta aquí.
 */
describe('BIM (integración) — modelos y vínculos', () => {
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

  it('sube un modelo, lo lista, vincula un elemento a una partida y lo borra', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const budget = await createBudget(app, admin.accessToken, project.id);
    const item = await addBudgetItem(app, admin.accessToken, budget.id);
    await activateBudget(app, admin.accessToken, budget.id);

    const uploadRes = await authed(app, admin.accessToken)
      .post('/bim/models')
      .field('projectId', project.id)
      .field('name', 'Modelo estructura')
      .attach(
        'file',
        Buffer.from(
          "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;",
        ),
        { filename: 'estructura.ifc', contentType: 'application/octet-stream' },
      )
      .expect(201);
    const modelId = uploadRes.body.id as string;
    expect(uploadRes.body.projectId).toBe(project.id);
    expect(uploadRes.body.fileName).toBe('estructura.ifc');
    expect(uploadRes.body.ifcSchema).toBe('IFC4');

    const listRes = await authed(app, admin.accessToken)
      .get(`/bim/models?projectId=${project.id}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);

    const globalId = '1a2B3c4D5e6F7g8H9i0Jkl';
    const linkRes = await authed(app, admin.accessToken)
      .put(`/bim/models/${modelId}/links/${globalId}`)
      .send({
        ifcElementName: 'Muro planta baja',
        ifcElementType: 'IfcWall',
        budgetItemId: item.id,
        notes: 'Revisar espesor',
      })
      .expect(200);
    expect(linkRes.body.budgetItemId).toBe(item.id);
    expect(linkRes.body.budgetItemCode).toBe(item.code);
    // Sin certificación facturada todavía: no hay % a origen.
    expect(linkRes.body.certifiedPct).toBeNull();

    // Actualiza el mismo vínculo (misma clave natural modelo+GlobalId): no duplica.
    const updateRes = await authed(app, admin.accessToken)
      .put(`/bim/models/${modelId}/links/${globalId}`)
      .send({ notes: 'Espesor confirmado: 20cm' })
      .expect(200);
    expect(updateRes.body.id).toBe(linkRes.body.id);
    expect(updateRes.body.notes).toBe('Espesor confirmado: 20cm');

    const linksRes = await authed(app, admin.accessToken)
      .get(`/bim/models/${modelId}/links`)
      .expect(200);
    expect(linksRes.body).toHaveLength(1);

    const fileRes = await authed(app, admin.accessToken)
      .get(`/bim/models/${modelId}/file`)
      .expect(200);
    expect(Buffer.from(fileRes.body).toString()).toContain('FILE_SCHEMA');

    await authed(app, admin.accessToken)
      .delete(`/bim/models/${modelId}`)
      .expect(204);

    const afterDelete = await authed(app, admin.accessToken)
      .get(`/bim/models?projectId=${project.id}`)
      .expect(200);
    expect(afterDelete.body).toHaveLength(0);
  });

  it('rechaza subir sin fichero y vincular a una partida de otra obra', async () => {
    const admin = await registerUser(app);
    const project = await createProject(app, admin.accessToken);
    const otherProject = await createProject(app, admin.accessToken);
    const otherBudget = await createBudget(
      app,
      admin.accessToken,
      otherProject.id,
    );
    const otherItem = await addBudgetItem(
      app,
      admin.accessToken,
      otherBudget.id,
    );

    await authed(app, admin.accessToken)
      .post('/bim/models')
      .field('projectId', project.id)
      .field('name', 'Modelo sin fichero')
      .expect(400);

    const uploadRes = await authed(app, admin.accessToken)
      .post('/bim/models')
      .field('projectId', project.id)
      .field('name', 'Modelo estructura')
      .attach('file', Buffer.from('contenido'), { filename: 'm.ifc' })
      .expect(201);

    await authed(app, admin.accessToken)
      .put(`/bim/models/${uploadRes.body.id}/links/g1`)
      .send({ budgetItemId: otherItem.id })
      .expect(400);
  });
});
