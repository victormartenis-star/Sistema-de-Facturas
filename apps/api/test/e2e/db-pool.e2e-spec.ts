import type { Pool } from 'pg';
import { closeDb, getDb } from '@erp/db';

/**
 * 2.1: un error en un cliente inactivo del pool (reinicio de Postgres, corte
 * de red) emite 'error' en el Pool; sin manejador, Node lo trata como
 * excepción no capturada y tumba la API.
 */
describe('Pool de Postgres', () => {
  afterAll(async () => {
    await closeDb();
  });

  it("un evento 'error' del pool no lanza excepción y el pool tiene límites", () => {
    const pool = (getDb() as unknown as { $client: Pool }).$client;
    expect(() =>
      pool.emit('error', new Error('conexión inactiva caída')),
    ).not.toThrow();
    expect(pool.options.max).toBe(10);
    expect(pool.options.connectionTimeoutMillis).toBe(5000);
  });
});
