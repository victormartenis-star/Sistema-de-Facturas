/**
 * Motor isométrico 2.5D: conversión cartesiano ↔ isométrico y orden de profundidad (Z-sorting).
 *
 * Convención: la casilla (cx, cy) cubre el área [cx, cx+1) × [cy, cy+1) del plano cartesiano.
 * El vértice superior del rombo de la casilla está en cartesianToIsometric(cx, cy).
 */

export interface Vector2D {
  x: number;
  y: number;
}

export class IsoRenderer {
  public readonly tileWidth: number;
  public readonly tileHeight: number;

  constructor(tileWidth = 64, tileHeight = 32) {
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
  }

  public cartesianToIsometric(cartX: number, cartY: number): Vector2D {
    return {
      x: (cartX - cartY) * (this.tileWidth / 2),
      y: (cartX + cartY) * (this.tileHeight / 2),
    };
  }

  /** Devuelve la casilla (entera) que contiene el punto de pantalla. */
  public isometricToCartesian(screenX: number, screenY: number): Vector2D {
    const exacto = this.isometricToCartesianExact(screenX, screenY);
    return { x: Math.floor(exacto.x), y: Math.floor(exacto.y) };
  }

  /** Inversa exacta (sin redondear): útil para desplegar unidades en posiciones fraccionarias. */
  public isometricToCartesianExact(screenX: number, screenY: number): Vector2D {
    const cx = screenX / (this.tileWidth / 2);
    const cy = screenY / (this.tileHeight / 2);
    return { x: (cy + cx) / 2, y: (cy - cx) / 2 };
  }
}

export interface EntidadOrdenable {
  cartX: number;
  cartY: number;
  width: number;
  height: number;
  /** Desempate para entidades a la misma profundidad (p. ej. proyectiles sobre unidades). */
  capa?: number;
}

/**
 * Clave de profundidad: suma de coordenadas del CENTRO de la huella.
 *
 * Nota de diseño: usar la esquina frontal (x+w+y+h) hace que una unidad situada justo delante
 * de una cara lateral de un edificio grande se dibuje detrás de él. Con el centro, cualquier
 * punto fuera de la huella y en su lado frontal queda siempre por delante.
 */
export function claveProfundidad(e: EntidadOrdenable): number {
  return e.cartX + e.width / 2 + (e.cartY + e.height / 2);
}

/** Ordena (sin mutar la entrada) de atrás hacia delante para el algoritmo del pintor. */
export function sortEntitiesByDepth<T extends EntidadOrdenable>(entities: readonly T[]): T[] {
  return [...entities].sort((a, b) => claveProfundidad(a) - claveProfundidad(b) || (a.capa ?? 0) - (b.capa ?? 0));
}

export function distancia(a: Vector2D, b: Vector2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distancia de un punto a un rectángulo de casillas [x, x+w) × [y, y+h). */
export function distanciaARectangulo(p: Vector2D, x: number, y: number, w: number, h: number): number {
  const dx = Math.max(x - p.x, 0, p.x - (x + w));
  const dy = Math.max(y - p.y, 0, p.y - (y + h));
  return Math.hypot(dx, dy);
}
