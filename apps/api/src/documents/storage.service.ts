import { randomUUID } from 'node:crypto';
import { createReadStream, ReadStream } from 'node:fs';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';

/**
 * Almacenamiento de originales en disco local para desarrollo; en producción
 * esta capa se sustituye por S3/R2 (01-arquitectura.md) manteniendo la misma
 * interfaz (guardar/leer/borrar por storage_key). Los originales son
 * inmutables: nunca se sobrescriben ni se borran al eliminar el documento
 * (retención legal, 02-base-de-datos.md §5).
 */
@Injectable()
export class StorageService {
  // dist/documents/ → raíz del monorepo; STORAGE_DIR permite otra ubicación
  private readonly baseDir = process.env.STORAGE_DIR
    ? resolve(process.env.STORAGE_DIR)
    : resolve(__dirname, '../../../../storage');

  /** Guarda el contenido y devuelve la clave inmutable del original. */
  async save(
    companyId: string,
    fileName: string,
    content: Buffer,
  ): Promise<string> {
    const rawExt = extname(fileName).toLowerCase();
    const ext = /^\.[a-z0-9]{1,9}$/.test(rawExt) ? rawExt : '';
    const key = `documents/${companyId}/${randomUUID()}${ext}`;
    const absolute = this.pathFor(key);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
    return key;
  }

  read(key: string): ReadStream {
    return createReadStream(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  /** Solo para deshacer una subida fallida; los originales no se borran. */
  async discard(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      // si no llegó a escribirse no hay nada que deshacer
    }
  }

  private pathFor(key: string): string {
    return join(this.baseDir, key);
  }
}
