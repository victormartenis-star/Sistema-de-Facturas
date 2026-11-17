import { describe, expect, it } from 'vitest';
import { IsoRenderer, sortEntitiesByDepth } from '../src/engine/IsoGrid';
import { alturaMaxima, calcularTiroPorAngulo, calcularTiroPorVelocidad, posicionEnVuelo } from '../src/engine/Ballistics';
import { buscarRuta } from '../src/engine/Pathfinding';

describe('IsoRenderer', () => {
  const iso = new IsoRenderer();
  it('ida y vuelta cartesiano ↔ isométrico', () => {
    for (const [x, y] of [[0, 0], [5, 3], [17, 39], [39, 0]]) {
      const p = iso.cartesianToIsometric(x + 0.5, y + 0.5);
      expect(iso.isometricToCartesian(p.x, p.y)).toEqual({ x, y });
    }
  });
  it('ordena de atrás hacia delante sin mutar la entrada', () => {
    const entrada = [
      { cartX: 10, cartY: 10, width: 0, height: 0 },
      { cartX: 0, cartY: 0, width: 4, height: 4 },
    ];
    const salida = sortEntitiesByDepth(entrada);
    expect(salida[0].cartX).toBe(0);
    expect(entrada[0].cartX).toBe(10);
  });
  it('una unidad delante de la cara lateral de un edificio se dibuja después', () => {
    const edificio = { cartX: 10, cartY: 10, width: 4, height: 4 };
    const unidad = { cartX: 14.2, cartY: 12, width: 0, height: 0 };
    expect(sortEntitiesByDepth([unidad, edificio])[1]).toBe(unidad);
  });
});

describe('Balística', () => {
  it('el tiro por ángulo aterriza exactamente en el destino', () => {
    const tiro = calcularTiroPorAngulo({ x: 0, y: 0 }, { x: 6, y: 8 }, 50);
    const fin = posicionEnVuelo(tiro, tiro.duracion);
    expect(fin.x).toBeCloseTo(6);
    expect(fin.y).toBeCloseTo(8);
    expect(fin.z).toBeCloseTo(0, 5);
    expect(alturaMaxima(tiro)).toBeGreaterThan(1);
  });
  it('el tiro por velocidad parte de la altura de la torre y cae al suelo', () => {
    const tiro = calcularTiroPorVelocidad({ x: 0, y: 0 }, { x: 7, y: 0 }, 12, 1.5);
    expect(posicionEnVuelo(tiro, 0).z).toBeCloseTo(1.5);
    expect(posicionEnVuelo(tiro, tiro.duracion).z).toBeCloseTo(0, 5);
  });
});

describe('A*', () => {
  it('rodea un muro infranqueable y atraviesa uno de coste alto solo si compensa', () => {
    const muro = (x: number, y: number) => x === 5 && y >= 0 && y <= 8;
    const ruta = buscarRuta(
      { ancho: 10, alto: 10, coste: (x, y) => (muro(x, y) ? Infinity : 1) },
      { x: 0, y: 0 },
      { esMeta: (x, y) => x === 9 && y === 0, heuristica: (x, y) => Math.max(Math.abs(9 - x), Math.abs(y)) },
    )!;
    expect(ruta.at(-1)).toEqual({ x: 9, y: 0 });
    expect(ruta.some((p) => p.x === 5 && p.y === 9)).toBe(true);
  });
});
