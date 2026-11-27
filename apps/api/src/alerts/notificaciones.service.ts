import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { notificationRecipients, notifications, type DbOrTx } from '@erp/db';
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
  /**
   * Destinatarios concretos (fase 7): la notificación solo la ven ellos, con
   * lectura por usuario. Sin esta lista es de empresa (alertas programadas).
   * Una lista vacía no notifica a nadie: nunca se cae en difundir a todos.
   */
  destinatarios?: readonly string[];
}

/**
 * Notificaciones por evento en la bandeja in-app (la misma que la campana y
 * las alertas programadas). Sin dependencias de otros módulos de negocio, así
 * que aprobaciones y control presupuestario la usan sin ciclos.
 *
 * Se escribe con el ejecutor de la operación: dentro de su transacción, una
 * operación que se deshace no deja notificación. La clave deduplica; en una
 * dirigida repetida se añaden solo los destinatarios nuevos.
 */
@Injectable()
export class NotificacionesService {
  async notificar(ex: DbOrTx, n: NuevaNotificacion): Promise<void> {
    const dirigida = n.destinatarios !== undefined;
    const destinatarios = [...new Set(n.destinatarios ?? [])];
    if (dirigida && destinatarios.length === 0) return;
    const [creada] = await ex
      .insert(notifications)
      .values({
        companyId: n.companyId,
        type: n.tipo,
        title: n.titulo.slice(0, 200),
        body: n.cuerpo,
        link: n.enlace,
        dedupeKey: n.clave,
        dirigida,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!dirigida) return;
    const id =
      creada?.id ??
      (
        await ex
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.companyId, n.companyId),
              eq(notifications.dedupeKey, n.clave),
            ),
          )
      )[0]?.id;
    if (!id) return;
    await ex
      .insert(notificationRecipients)
      .values(
        destinatarios.map((userId) => ({
          companyId: n.companyId,
          notificationId: id,
          userId,
        })),
      )
      .onConflictDoNothing();
  }
}
