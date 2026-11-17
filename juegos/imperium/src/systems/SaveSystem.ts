/**
 * Persistencia local. El estado guarda `ultimaActualizacion`, de modo que al volver
 * `simular(estado, Date.now())` aplica todo lo ocurrido offline.
 */
import { TIPOS_UNIDAD } from '../data/gameConfig';
import type { EstadoJuego } from './Economy';

const CLAVE = 'imperium.legions-glory.v1';

export function guardar(estado: EstadoJuego): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(estado));
  } catch {
    // Almacenamiento no disponible (modo privado, cuota…): el juego sigue en memoria.
  }
}

export function cargar(): EstadoJuego | null {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const datos = JSON.parse(crudo) as EstadoJuego;
    if (datos?.version !== 1 || !Array.isArray(datos.edificios) || !datos.recursos) return null;
    // Migración defensiva: unidades añadidas en versiones posteriores.
    for (const t of TIPOS_UNIDAD) datos.ejercito[t] ??= 0;
    return datos;
  } catch {
    return null;
  }
}

export function borrar(): void {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento */
  }
}
