import { Injectable } from '@nestjs/common';
import { notifications, type DbOrTx } from '@erp/db';
import type { TipoNotificacion } from '@erp/shared';

export interface NuevaNotificacion {
  companyId: string;
  tipo: TipoNotificacion;
  titulo: string;
  cuerpo: string;
  /** Ruta del frontend a la que lleva (p. ej. `/aprobaciones`). */
  enlace: string | null;
  /** Identifica el hecho: la misma clave no se notifica dos veces. */
  clave: string;
}

/**
 * Notificaciones por evento en la bandeja in-app (la misma que la campana y
 * las alertas programadas). Sin dependencias de otros módulos de negocio, así
 * que aprobaciones y control presupuestario la usan sin ciclos.
 *
 * Se escribe con el ejecutor de la operación: dentro de su transacción, una
 * operación que se deshace no deja notificación. La clave deduplica.
 */
@Injectable()
export class NotificacionesService {
  async notificar(ex: DbOrTx, n: NuevaNotificacion): Promise<void> {
    await ex
      .insert(notifications)
      .values({
        companyId: n.companyId,
        type: n.tipo,
        title: n.titulo.slice(0, 200),
        body: n.cuerpo,
        link: n.enlace,
        dedupeKey: n.clave,
      })
      .onConflictDoNothing();
  }
}
