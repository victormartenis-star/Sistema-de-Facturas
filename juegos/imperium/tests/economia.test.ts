import { describe, expect, it } from 'vitest';
import { EDIFICIOS, NIVELES_SENADO } from '../src/data/gameConfig';
import {
  acelerarObra, capacidad, construir, crearEstadoInicial, entrenar, limiteTropas, mejorar,
  nivelSenado, produccionPorHora, simular,
} from '../src/systems/Economy';

const H = 3_600_000;

describe('Configuración', () => {
  it('respeta la tabla del Senado del GDD', () => {
    expect(NIVELES_SENADO.map((n) => [n.coste.denarios, n.coste.marmol ?? 0, n.tiempoSeg, n.hp, n.limiteTropas])).toEqual([
      [1_000, 0, 0, 2_500, 20],
      [5_000, 2_000, 7_200, 4_000, 35],
      [25_000, 15_000, 28_800, 7_000, 60],
      [100_000, 60_000, 86_400, 12_000, 90],
      [500_000, 250_000, 259_200, 20_000, 130],
    ]);
  });
  it('cada mejora del Senado es pagable con los almacenes disponibles en el nivel anterior', () => {
    for (let n = 2; n <= 5; n++) {
      const coste = NIVELES_SENADO[n - 1].coste;
      for (const r of ['denarios', 'marmol'] as const) {
        const almacen = r === 'denarios' ? EDIFICIOS.aerarium : EDIFICIOS.lapidarium;
        const nivelMax = Math.max(...almacen.niveles.filter((l) => l.senadoRequerido <= n - 1).map((l) => l.nivel));
        const copias = almacen.maxPorSenado[n - 2];
        const total = copias * almacen.niveles[nivelMax - 1].capacidad! + NIVELES_SENADO[n - 2].almacen;
        expect(total, `Senado ${n} – ${r}`).toBeGreaterThanOrEqual(coste[r] ?? 0);
      }
    }
  });
});

describe('Economía', () => {
  it('produce en tiempo real y respeta la capacidad', () => {
    const e = crearEstadoInicial(0);
    e.ejercito.legionario = 0;
    e.ejercito.velite = 0;
    const antes = e.recursos.denarios;
    simular(e, H);
    expect(e.recursos.denarios).toBeCloseTo(antes + produccionPorHora(e, 'denarios'));
    simular(e, 1000 * H);
    expect(e.recursos.denarios).toBe(capacidad(e, 'denarios'));
  });

  it('simulación offline exacta: una mejora terminada a mitad de la ausencia cambia la producción desde ese instante', () => {
    const e = crearEstadoInicial(0);
    e.ejercito.legionario = 0;
    e.ejercito.velite = 0;
    e.recursos.marmol = 10_000;
    e.recursos.denarios = 0;
    const foro = e.edificios.find((b) => b.tipo === 'foro')!;
    expect(mejorar(e, foro.id, 0).ok).toBe(true); // nivel 2 tarda 5 min
    simular(e, H);
    const n1 = EDIFICIOS.foro.niveles[0].produccionHora!;
    const n2 = EDIFICIOS.foro.niveles[1].produccionHora!;
    const esperado = (n1 * 5) / 60 + (n2 * 55) / 60;
    expect(foro.nivel).toBe(2);
    expect(e.recursos.denarios).toBeCloseTo(esperado, 6);
    // El mismo resultado simulando en pasos pequeños (en tiempo real).
    const f = crearEstadoInicial(0);
    f.ejercito.legionario = 0;
    f.ejercito.velite = 0;
    f.recursos.marmol = 10_000;
    f.recursos.denarios = 0;
    mejorar(f, f.edificios.find((b) => b.tipo === 'foro')!.id, 0);
    for (let t = 16; t <= H; t += 16_000) simular(f, t);
    simular(f, H);
    expect(f.recursos.denarios).toBeCloseTo(esperado, 6);
  });

  it('el ejército consume trigo y nunca baja de cero', () => {
    const e = crearEstadoInicial(0);
    for (const b of e.edificios) if (b.tipo === 'latifundio') b.nivel = 0;
    e.recursos.trigo = 10;
    simular(e, 100 * H);
    expect(e.recursos.trigo).toBe(0);
  });

  it('entrena tropas en cola secuencial y respeta el límite del Senado', () => {
    const e = crearEstadoInicial(0);
    e.recursos.trigo = 2_000;
    expect(entrenar(e, 'legionario', 0).ok).toBe(true);
    expect(entrenar(e, 'legionario', 0).ok).toBe(true);
    expect(e.colaEntrenamiento[1].finEn).toBe(40_000);
    simular(e, 41_000);
    expect(e.ejercito.legionario).toBe(8);
    while (entrenar(e, 'legionario', 41_000).ok);
    expect(e.ejercito.legionario + e.ejercito.velite + e.colaEntrenamiento.length).toBe(limiteTropas(e));
  });

  it('valida colocación, requisitos y fabri; acelera con áureos', () => {
    const e = crearEstadoInicial(0);
    e.recursos = { denarios: 1e6, marmol: 1e6, trigo: 0, favor: 0, aureos: 1_000 };
    expect(construir(e, 'torre', 18, 18, 0).ok).toBe(false); // encima del Senado
    expect(construir(e, 'balista', 5, 5, 0)).toEqual({ ok: false, motivo: 'Límite alcanzado para Senado nivel 1' });
    const senado = e.edificios.find((b) => b.tipo === 'senado')!;
    expect(mejorar(e, senado.id, 0).ok).toBe(true);
    expect(construir(e, 'muralla', 5, 5, 0).ok).toBe(true); // instantánea: no ocupa fabri
    const foro = e.edificios.find((b) => b.tipo === 'foro')!;
    const cantera = e.edificios.find((b) => b.tipo === 'cantera')!;
    expect(mejorar(e, foro.id, 0).ok).toBe(true);
    expect(mejorar(e, cantera.id, 0)).toEqual({ ok: false, motivo: 'Todos los fabri están ocupados' });
    expect(acelerarObra(e, senado.id, 1000).ok).toBe(true);
    expect(nivelSenado(e)).toBe(2);
    expect(e.recursos.aureos).toBe(1_000 - Math.ceil(7_199 / 120));
  });
});
