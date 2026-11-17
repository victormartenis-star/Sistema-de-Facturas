/**
 * A* en rejilla de 8 direcciones con montículo binario.
 * El coste de cada casilla lo decide quien llama (p. ej. murallas = caras pero atravesables).
 */
import type { Vector2D } from './IsoGrid';

export interface RejillaCostes {
  ancho: number;
  alto: number;
  /** Coste de ENTRAR en la casilla. Infinity = infranqueable. */
  coste(x: number, y: number): number;
}

export interface OpcionesRuta {
  /** ¿Es (x, y) una casilla meta? Se evalúa antes del coste (la meta puede estar "ocupada"). */
  esMeta(x: number, y: number): boolean;
  /** Heurística admisible: cota inferior del coste restante desde (x, y). */
  heuristica(x: number, y: number): number;
  /** Límite de nodos expandidos (seguridad). */
  maxNodos?: number;
}

class Monticulo {
  private datos: number[] = [];
  constructor(private readonly prioridad: Float64Array) {}
  get vacio(): boolean {
    return this.datos.length === 0;
  }
  insertar(n: number): void {
    const d = this.datos;
    d.push(n);
    let i = d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prioridad[d[p]] <= this.prioridad[d[i]]) break;
      [d[p], d[i]] = [d[i], d[p]];
      i = p;
    }
  }
  extraer(): number {
    const d = this.datos;
    const raiz = d[0];
    const ultimo = d.pop()!;
    if (d.length > 0) {
      d[0] = ultimo;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let menor = i;
        if (l < d.length && this.prioridad[d[l]] < this.prioridad[d[menor]]) menor = l;
        if (r < d.length && this.prioridad[d[r]] < this.prioridad[d[menor]]) menor = r;
        if (menor === i) break;
        [d[menor], d[i]] = [d[i], d[menor]];
        i = menor;
      }
    }
    return raiz;
  }
}

const VECINOS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Devuelve la lista de casillas (sin incluir el inicio) hasta la meta, o null si no hay ruta. */
export function buscarRuta(rejilla: RejillaCostes, inicio: Vector2D, opciones: OpcionesRuta): Vector2D[] | null {
  const { ancho, alto } = rejilla;
  const sx = Math.min(ancho - 1, Math.max(0, Math.floor(inicio.x)));
  const sy = Math.min(alto - 1, Math.max(0, Math.floor(inicio.y)));
  if (opciones.esMeta(sx, sy)) return [];

  const total = ancho * alto;
  const g = new Float64Array(total).fill(Infinity);
  const f = new Float64Array(total).fill(Infinity);
  const padre = new Int32Array(total).fill(-1);
  const cerrado = new Uint8Array(total);
  const abierta = new Monticulo(f);
  const maxNodos = opciones.maxNodos ?? total;

  const s = sy * ancho + sx;
  g[s] = 0;
  f[s] = opciones.heuristica(sx, sy);
  abierta.insertar(s);
  let expandidos = 0;

  while (!abierta.vacio && expandidos < maxNodos) {
    const actual = abierta.extraer();
    if (cerrado[actual]) continue;
    cerrado[actual] = 1;
    expandidos++;
    const cx = actual % ancho;
    const cy = (actual - cx) / ancho;

    if (opciones.esMeta(cx, cy)) {
      const ruta: Vector2D[] = [];
      let n = actual;
      while (n !== s) {
        ruta.push({ x: n % ancho, y: Math.floor(n / ancho) });
        n = padre[n];
      }
      return ruta.reverse();
    }

    for (const [dx, dy, paso] of VECINOS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
      const vecino = ny * ancho + nx;
      if (cerrado[vecino]) continue;
      const esMeta = opciones.esMeta(nx, ny);
      const c = esMeta ? 1 : rejilla.coste(nx, ny);
      if (!Number.isFinite(c)) continue;
      // Sin cortar esquinas en diagonal a través de casillas infranqueables.
      if (dx !== 0 && dy !== 0) {
        if (!Number.isFinite(rejilla.coste(cx + dx, cy)) || !Number.isFinite(rejilla.coste(cx, cy + dy))) continue;
      }
      const ng = g[actual] + paso * c;
      if (ng < g[vecino]) {
        g[vecino] = ng;
        f[vecino] = ng + opciones.heuristica(nx, ny);
        padre[vecino] = actual;
        abierta.insertar(vecino);
      }
    }
  }
  return null;
}
