import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { documentsApi, offlineFieldApi } from './api';

/**
 * Cola de escritura offline de la app de obra: partes diarios, fichajes,
 * checklist PRL y fotos de avance se guardan primero en IndexedDB
 * (funciona sin red) y se envían a la API en cuanto hay conexión — a mano
 * (`flushQueue()`) o solos, al disparar el evento `online` del navegador
 * (ver `offline-sync-provider.tsx`, montado una vez en el layout raíz).
 *
 * La clave de cada item es un UUID generado **al encolar**, no al
 * sincronizar, y viaja como `clientId` en el payload de fichajes/checklist
 * — el backend lo trata como único por empresa, así que reintentar un
 * envío que en realidad ya llegó (app cerrada a media sincronización) no
 * duplica nada; ver `packages/shared/src/offline-field.ts`.
 */

export type QueueKind = 'fichaje' | 'checklist-prl' | 'foto-avance';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  payload: Record<string, unknown>;
  createdAt: string;
  status: 'pending' | 'error';
  error?: string;
}

interface OfflineDb extends DBSchema {
  queue: {
    key: string;
    value: QueueItem;
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDb>> | null = null;

function getDb(): Promise<IDBPDatabase<OfflineDb>> | null {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return null;
  dbPromise ??= openDB<OfflineDb>('erp-obra-offline', 1, {
    upgrade(db) {
      db.createObjectStore('queue', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

/** Encola un item y devuelve su id (= el `clientId` que viaja en el payload de fichajes/checklist). */
export async function enqueue(
  kind: QueueKind,
  payload: Record<string, unknown>,
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error('IndexedDB no disponible en este navegador');
  const id = crypto.randomUUID();
  await db.put('queue', {
    id,
    kind,
    payload,
    createdAt: new Date().toISOString(),
    status: 'pending',
  });
  return id;
}

export async function listQueue(): Promise<QueueItem[]> {
  const db = await getDb();
  if (!db) return [];
  return db.getAll('queue');
}

export async function queueCount(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  return db.count('queue');
}

async function removeFromQueue(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete('queue', id);
}

async function markError(id: string, message: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const item = await db.get('queue', id);
  if (item) await db.put('queue', { ...item, status: 'error', error: message });
}

async function submit(item: QueueItem): Promise<void> {
  switch (item.kind) {
    case 'fichaje':
      await offlineFieldApi.createFichaje({
        ...item.payload,
        clientId: item.id,
      } as Parameters<typeof offlineFieldApi.createFichaje>[0]);
      return;
    case 'checklist-prl':
      await offlineFieldApi.createChecklist({
        ...item.payload,
        clientId: item.id,
      } as Parameters<typeof offlineFieldApi.createChecklist>[0]);
      return;
    case 'foto-avance': {
      const { file, projectId, docType } = item.payload as {
        file: File;
        projectId?: string;
        docType?: string;
      };
      await documentsApi.upload(file, { projectId, docType });
      return;
    }
  }
}

/** Envía cada item pendiente; se detiene en el primer fallo de red (probablemente seguimos sin cobertura) pero sigue con los demás si el fallo es de otro tipo (p.ej. validación). */
export async function flushQueue(): Promise<{ ok: number; failed: number }> {
  const items = await listQueue();
  let ok = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await submit(item);
      await removeFromQueue(item.id);
      ok++;
    } catch (err) {
      failed++;
      await markError(
        item.id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return { ok, failed };
}

/** Encola si no hay red; si hay, intenta enviar directo y solo encola como red de seguridad si el envío falla. */
export async function submitOrQueue(
  kind: QueueKind,
  payload: Record<string, unknown>,
): Promise<{ queued: boolean }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await enqueue(kind, payload);
    return { queued: true };
  }
  try {
    await submit({
      id: crypto.randomUUID(),
      kind,
      payload,
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
    return { queued: false };
  } catch {
    await enqueue(kind, payload);
    return { queued: true };
  }
}
