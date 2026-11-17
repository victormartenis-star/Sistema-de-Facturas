import { describe, expect, it } from 'vitest';
import { generarBaseEnemiga, type BaseEnemiga } from '../src/systems/BaseGenerator';
import { Batalla } from '../src/systems/Combat';
import { EDIFICIOS } from '../src/data/gameConfig';

const sinTropas = { legionario: 0, velite: 0, equites: 0, ariete: 0, onagro: 0 };

function correr(b: Batalla, segundos: number) {
  for (let t = 0; t < segundos && !b.resultado; t += 1 / 30) b.actualizar(1 / 30);
}

describe('Generador de bases', () => {
  it('es determinista y sin solapamientos', () => {
    const a = generarBaseEnemiga(3, 42);
    expect(generarBaseEnemiga(3, 42)).toEqual(a);
    const ocupadas = new Set<string>();
    for (const e of a.edificios) {
      const def = EDIFICIOS[e.tipo];
      for (let i = 0; i < def.ancho; i++) for (let j = 0; j < def.alto; j++) {
        const k = `${e.x + i},${e.y + j}`;
        expect(ocupadas.has(k)).toBe(false);
        ocupadas.add(k);
      }
    }
  });
});

describe('Batalla', () => {
  const baseSimple: BaseEnemiga = {
    nombre: 'Prueba', caudillo: 'Nadie', nivelSenado: 1, semilla: 0,
    edificios: [
      { tipo: 'aerarium', nivel: 1, x: 20, y: 20, botin: { denarios: 1000 } },
      { tipo: 'foro', nivel: 1, x: 10, y: 20, botin: {} },
    ],
  };

  it('no se puede desplegar junto a edificios y el reloj no corre hasta desplegar', () => {
    const b = new Batalla(baseSimple, { ...sinTropas, legionario: 1 });
    expect(b.desplegar('legionario', 21, 19.5)).toBe(false);
    correr(b, 5);
    expect(b.tiempo).toBe(0);
  });

  it('los equites priorizan almacenes con daño x2.5 y saquean de forma proporcional', () => {
    const b = new Batalla(baseSimple, { ...sinTropas, equites: 1 });
    expect(b.desplegar('equites', 5.5, 21.5)).toBe(true); // más cerca del foro
    const aerarium = b.edificios.find((e) => e.tipo === 'aerarium')!;
    const foro = b.edificios.find((e) => e.tipo === 'foro')!;
    for (let t = 0; t < 60 && !aerarium.destruido; t += 1 / 30) b.actualizar(1 / 30);
    expect(aerarium.destruido).toBe(true);
    // 700 PV / (55 DPS × 2.5) ≈ 5.1 s de ataque.
    expect(b.tiempo).toBeLessThan(15);
    expect(foro.hp).toBe(foro.hpMax); // ignoró el foro aunque estaba más cerca
    expect(b.botin.denarios).toBeCloseTo(1000, 3);
  });

  it('el ariete derriba murallas (x40) y las tropas rodean o rompen el muro', () => {
    const muro: BaseEnemiga = {
      ...baseSimple,
      edificios: [
        { tipo: 'senado', nivel: 1, x: 20, y: 20, botin: {} },
        ...Array.from({ length: 12 }, (_, i) => ({ tipo: 'muralla' as const, nivel: 5, x: 18, y: 16 + i, botin: {} })),
      ],
    };
    const b = new Batalla(muro, { ...sinTropas, ariete: 1 });
    b.desplegar('ariete', 10.5, 22.5);
    correr(b, 20);
    expect(b.edificios.filter((e) => e.tipo === 'muralla' && e.destruido).length).toBeGreaterThan(0);
  });

  it('Testudo: 4 legionarios juntos reciben un 70% menos de daño de flechas', () => {
    const torre: BaseEnemiga = { ...baseSimple, edificios: [{ tipo: 'torre', nivel: 1, x: 20, y: 20, botin: {} }] };
    const solo = new Batalla(torre, { ...sinTropas, legionario: 1 });
    solo.desplegar('legionario', 14.5, 21);
    const grupo = new Batalla(torre, { ...sinTropas, legionario: 4 });
    for (const dy of [0, 0.4, 0.8, 1.2]) grupo.desplegar('legionario', 14.5, 20.6 + dy);
    correr(solo, 3);
    correr(grupo, 3);
    const danoSolo = solo.unidades[0].hpMax - solo.unidades[0].hp;
    const danoGrupo = grupo.unidades.reduce((s, u) => s + (u.hpMax - u.hp), 0);
    expect(grupo.unidades.every((u) => u.enTestudo)).toBe(true);
    expect(danoGrupo).toBeCloseTo(danoSolo * 0.3, 0);
  });

  it('el onagro respeta la zona muerta y hace daño en área', () => {
    const b = new Batalla(
      { ...baseSimple, edificios: [
        { tipo: 'lapidarium', nivel: 1, x: 20, y: 20, botin: {} },
        { tipo: 'horreum', nivel: 1, x: 23, y: 20, botin: {} },
      ] },
      { ...sinTropas, onagro: 1 },
    );
    b.desplegar('onagro', 8.5, 21.5);
    correr(b, 25);
    const o = b.unidades[0];
    const [a, c] = b.edificios;
    expect(a.hp).toBeLessThan(a.hpMax);
    expect(c.hp).toBeLessThan(c.hpMax); // salpicadura
    expect(Math.abs(o.x - 20)).toBeGreaterThanOrEqual(2.9);
  });

  it('calcula estrellas: 50%, Senado y 100%', () => {
    const base = generarBaseEnemiga(1, 7);
    const b = new Batalla(base, { ...sinTropas, legionario: 20 });
    for (let i = 0; i < 20; i++) b.desplegar('legionario', 1.5, 1.5 + i * 0.3);
    correr(b, 180);
    expect(b.resultado).not.toBeNull();
    const r = b.resultado!;
    const senado = b.edificios.find((e) => e.tipo === 'senado')!;
    expect(r.estrellas).toBe((r.destruccion >= 50 ? 1 : 0) + (senado.destruido ? 1 : 0) + (r.destruccion >= 100 ? 1 : 0));
  });
});
