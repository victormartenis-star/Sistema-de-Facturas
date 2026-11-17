/**
 * Física balística de artillería: trayectorias parabólicas reales (gravedad constante).
 * Unidades: casillas y segundos. La altura z se mide en casillas sobre el suelo.
 */
import type { Vector2D } from './IsoGrid';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

/** Gravedad del mundo de juego (casillas/s²). Exagerada para que los tiros sean legibles. */
export const GRAVEDAD = 20;

export interface Tiro {
  origen: Vector2D;
  destino: Vector2D;
  /** Altura de salida (p. ej. lo alto de una torre), en casillas. */
  alturaInicial: number;
  duracion: number;
  /** Velocidad vertical inicial. */
  vz0: number;
  gravedad: number;
}

/**
 * Tiro con ángulo de elevación fijo (onagro). Resuelve la velocidad necesaria con la
 * ecuación de alcance R = v² · sin(2θ) / g, y el tiempo de vuelo T = 2 · v · sin(θ) / g.
 */
export function calcularTiroPorAngulo(
  origen: Vector2D,
  destino: Vector2D,
  anguloGrados: number,
  gravedad = GRAVEDAD,
): Tiro {
  const alcance = Math.hypot(destino.x - origen.x, destino.y - origen.y);
  const theta = (anguloGrados * Math.PI) / 180;
  if (alcance < 1e-6) {
    return { origen, destino, alturaInicial: 0, duracion: 0.2, vz0: (gravedad * 0.2) / 2, gravedad };
  }
  const v = Math.sqrt((alcance * gravedad) / Math.sin(2 * theta));
  const duracion = (2 * v * Math.sin(theta)) / gravedad;
  return { origen, destino, alturaInicial: 0, duracion, vz0: v * Math.sin(theta), gravedad };
}

/**
 * Tiro con velocidad horizontal fija (flechas, virotes). Calcula la vz0 que hace que el
 * proyectil, saliendo a `alturaInicial`, llegue al suelo justo en el destino.
 * z(T) = h0 + vz0·T − g·T²/2 = 0  ⇒  vz0 = (g·T²/2 − h0) / T
 */
export function calcularTiroPorVelocidad(
  origen: Vector2D,
  destino: Vector2D,
  velocidadHorizontal: number,
  alturaInicial = 0,
  gravedad = GRAVEDAD,
): Tiro {
  const alcance = Math.hypot(destino.x - origen.x, destino.y - origen.y);
  const duracion = Math.max(0.12, alcance / velocidadHorizontal);
  const vz0 = ((gravedad * duracion * duracion) / 2 - alturaInicial) / duracion;
  return { origen, destino, alturaInicial, duracion, vz0, gravedad };
}

/** Posición del proyectil en el instante t (segundos desde el disparo). */
export function posicionEnVuelo(tiro: Tiro, t: number): Vector3D {
  const k = Math.min(1, Math.max(0, t / tiro.duracion));
  const tc = k * tiro.duracion;
  const z = tiro.alturaInicial + tiro.vz0 * tc - (tiro.gravedad * tc * tc) / 2;
  return {
    x: tiro.origen.x + (tiro.destino.x - tiro.origen.x) * k,
    y: tiro.origen.y + (tiro.destino.y - tiro.origen.y) * k,
    z: Math.max(0, z),
  };
}

/** Altura máxima alcanzada (vértice de la parábola). */
export function alturaMaxima(tiro: Tiro): number {
  const tApice = Math.min(tiro.duracion, Math.max(0, tiro.vz0 / tiro.gravedad));
  return posicionEnVuelo(tiro, tApice).z;
}

/** Redirige un tiro en vuelo hacia un objetivo móvil conservando el tiempo restante. */
export function reorientarTiro(tiro: Tiro, nuevoDestino: Vector2D): void {
  tiro.destino = { x: nuevoDestino.x, y: nuevoDestino.y };
}
