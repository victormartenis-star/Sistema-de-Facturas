import { describe, expect, it } from 'vitest';
import {
  CLASS_STATS, FORMATIONS, HardcoreCombatEngine, ROUT_THRESHOLD, formationSlots, type CombatEvent, type SquadSpec,
} from '../src/engine/HardcoreCombatEngine';

const correr = (e: HardcoreCombatEngine, s: number, alPaso?: (ev: CombatEvent[]) => void) => {
  for (let t = 0; t < s && !e.result; t += 1 / 20) {
    e.step(1 / 20);
    alPaso?.(e.consumeEvents());
  }
};
const escuadra = (o: Partial<SquadSpec> & Pick<SquadSpec, 'faction' | 'unitClass' | 'count'>): SquadSpec => ({
  name: 'x', center: { x: 0, z: 0 }, facing: 0, formation: 'line', ai: false, ...o,
});

describe('Formaciones', () => {
  it('generan una plaza por hombre sin solaparse', () => {
    for (const f of ['line', 'testudo', 'orbis', 'cuneus', 'loose'] as const) {
      const p = formationSlots(f, 40);
      expect(p).toHaveLength(40);
      for (let i = 0; i < p.length; i++)
        for (let j = i + 1; j < p.length; j++)
          expect(Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z), f).toBeGreaterThan(0.5);
    }
  });
  it('la cuña tiene un solo hombre en la punta, delante de todos', () => {
    const p = formationSlots('cuneus', 15);
    expect(p.filter((s) => Math.abs(s.z) < 1e-9)).toHaveLength(1);
    expect(Math.max(...p.map((s) => s.z))).toBeCloseTo(0);
  });
  it('testudo: −50% velocidad; orbis: +200% densidad defensiva', () => {
    expect(FORMATIONS.testudo.speed).toBe(0.5);
    expect(1 / FORMATIONS.orbis.meleeTaken - 1).toBeCloseTo(2);
  });
});

describe('Física de masas', () => {
  it('una carga de caballería derriba y daña a la infantería mucho más que al revés', () => {
    const e = new HardcoreCombatEngine({ weather: 'clear', seed: 3 });
    const inf = e.addSquad(escuadra({ faction: 'barbarian', unitClass: 'warrior', count: 1, center: { x: 0, z: 0 }, facing: Math.PI }));
    const cab = e.addSquad(escuadra({ faction: 'rome', unitClass: 'eques', count: 1, center: { x: 0, z: -2.5 } }));
    const jinete = e.miembros(cab)[0];
    const guerrero = e.miembros(inf)[0];
    jinete.velocity.z = 9;
    e.order(cab.id, 'charge');
    const eventos: CombatEvent[] = [];
    correr(e, 0.3, (ev) => eventos.push(...ev));
    const impacto = eventos.find((x) => x.type === 'impact');
    expect(impacto).toBeDefined();
    expect(guerrero.maxHp - guerrero.hp).toBeGreaterThan(5 * (jinete.maxHp - jinete.hp));
    expect(guerrero.position.z).toBeGreaterThan(0.2); // empujado hacia atrás
  });

  it('el cuneus multiplica la energía de impacto ×2.5', () => {
    const dano = (formacion: 'line' | 'cuneus') => {
      const e = new HardcoreCombatEngine({ weather: 'clear', seed: 5 });
      const d = e.addSquad(escuadra({ faction: 'barbarian', unitClass: 'warrior', count: 1, facing: Math.PI }));
      const a = e.addSquad(escuadra({ faction: 'rome', unitClass: 'legionary', count: 1, center: { x: 0, z: -0.9 }, formation: formacion }));
      e.miembros(a)[0].velocity.z = 4.5;
      e.order(a.id, 'charge');
      e.miembros(a)[0].attackCooldown = 99;
      e.miembros(d)[0].attackCooldown = 99;
      let energia = 0;
      correr(e, 0.1, (ev) => ev.forEach((x) => x.type === 'impact' && (energia = Math.max(energia, x.energy))));
      return energia;
    };
    expect(dano('cuneus') / dano('line')).toBeCloseTo(2.5, 1);
  });
});

describe('Proyectiles y formaciones', () => {
  const lluviaDeFlechas = (formacion: 'line' | 'testudo') => {
    const e = new HardcoreCombatEngine({ weather: 'clear', seed: 11 });
    const r = e.addSquad(escuadra({ faction: 'rome', unitClass: 'legionary', count: 24, formation: formacion, center: { x: 0, z: 0 }, facing: 0 }));
    for (const u of e.miembros(r)) u.pila = 0;
    e.addSquad(escuadra({ faction: 'barbarian', unitClass: 'archer', count: 20, center: { x: 0, z: 55 }, facing: Math.PI }));
    correr(e, 40);
    return e.miembros(r).reduce((a, u) => a + (u.maxHp - u.hp), 0) + e.corpses.filter((c) => c.faction === 'rome').length * 100;
  };
  it('el testudo es casi impenetrable a distancia', () => {
    expect(lluviaDeFlechas('testudo')).toBeLessThan(lluviaDeFlechas('line') * 0.2);
  });

  it('los pila inutilizan escudos enemigos a 20 m', () => {
    const e = new HardcoreCombatEngine({ weather: 'clear', seed: 2 });
    e.addSquad(escuadra({ faction: 'rome', unitClass: 'legionary', count: 20, facing: 0 }));
    const b = e.addSquad(escuadra({ faction: 'barbarian', unitClass: 'warrior', count: 20, center: { x: 0, z: 16 }, facing: Math.PI }));
    const eventos: CombatEvent[] = [];
    correr(e, 4, (ev) => eventos.push(...ev));
    expect(eventos.filter((x) => x.type === 'missile' && x.kind === 'pilum').length).toBeGreaterThan(10);
    expect(eventos.some((x) => x.type === 'shieldPierced')).toBe(true);
    expect(e.miembros(b).some((u) => !u.hasShield)).toBe(true);
  });

  it('el onagro desmiembra, derriba y siembra el pánico', () => {
    const e = new HardcoreCombatEngine({ weather: 'clear', seed: 4 });
    e.addSquad(escuadra({ faction: 'rome', unitClass: 'onager', count: 1, center: { x: 0, z: -60 } }));
    const b = e.addSquad(escuadra({ faction: 'barbarian', unitClass: 'warrior', count: 40, center: { x: 0, z: 40 }, facing: Math.PI, formation: 'testudo' }));
    const moral0 = e.moralMedia(b);
    correr(e, 40);
    expect(e.corpses.length).toBeGreaterThan(0);
    expect(e.moralMedia(b)).toBeLessThan(moral0);
  });
});

describe('Moral y logística', () => {
  it('bajo ROUT_THRESHOLD la unidad huye y arroja el escudo', () => {
    const e = new HardcoreCombatEngine({ weather: 'clear', seed: 1 });
    const s = e.addSquad(escuadra({ faction: 'barbarian', unitClass: 'warrior', count: 3, facing: Math.PI }));
    e.addSquad(escuadra({ faction: 'rome', unitClass: 'legionary', count: 3, center: { x: 0, z: -20 } }));
    const u = e.miembros(s)[0];
    u.morale = ROUT_THRESHOLD - 1;
    const eventos: CombatEvent[] = [];
    correr(e, 0.2, (ev) => eventos.push(...ev));
    expect(u.state).toBe('routing');
    expect(u.hasShield).toBe(false);
    expect(eventos.some((x) => x.type === 'shieldDropped')).toBe(true);
  });

  it('la muerte del centurión hunde la moral de su centuria', () => {
    const e = new HardcoreCombatEngine({ weather: 'clear', seed: 1 });
    const s = e.addSquad(escuadra({ faction: 'rome', unitClass: 'legionary', count: 10, leader: 'centurion' }));
    e.addSquad(escuadra({ faction: 'barbarian', unitClass: 'warrior', count: 1, center: { x: 0, z: 90 } }));
    const antes = e.moralMedia(s);
    const lider = e.unit(s.leaderId)!;
    lider.hp = 1;
    lider.armor = 0;
    // Una piedra cae sobre él.
    e.projectiles.push({ id: 1, kind: 'stone', faction: 'barbarian', shooterId: 'x', damage: 50, t: 0, x: 0, y: 0, z: 0,
      tiro: { origen: { x: lider.position.x, y: lider.position.z - 50 }, destino: { x: lider.position.x, y: lider.position.z }, alturaInicial: 0, duracion: 0.01, vz0: 0, gravedad: 9.81 } });
    correr(e, 0.1);
    expect(lider.state).toBe('dead');
    expect(e.moralMedia(s)).toBeLessThan(antes - 15);
  });

  it('líneas de suministro cortadas: deserción y moral −30', () => {
    const e = new HardcoreCombatEngine({ weather: 'clear', seed: 9, starving: { rome: true } });
    e.addSquad(escuadra({ faction: 'rome', unitClass: 'legionary', count: 100, leader: 'centurion' }));
    e.addSquad(escuadra({ faction: 'barbarian', unitClass: 'warrior', count: 5, center: { x: 0, z: 120 } }));
    correr(e, 0.05);
    expect(e.deserted).toBeGreaterThan(5);
    expect(e.units.find((u) => u.unitClass === 'legionary' && u.state === 'formed')!.morale).toBeLessThan(CLASS_STATS.legionary.discipline + 20 - 25);
  });

  it('la lluvia reduce la velocidad de la caballería un 40%', () => {
    const velocidad = (weather: 'clear' | 'rain') => {
      const e = new HardcoreCombatEngine({ weather, seed: 1 });
      const s = e.addSquad(escuadra({ faction: 'rome', unitClass: 'eques', count: 1, center: { x: 0, z: -100 } }));
      e.addSquad(escuadra({ faction: 'barbarian', unitClass: 'warrior', count: 1, center: { x: 100, z: 120 } }));
      e.order(s.id, 'move', { x: 0, z: 100 });
      correr(e, 6);
      return e.miembros(s)[0].position.z + 100;
    };
    expect(velocidad('rain') / velocidad('clear')).toBeCloseTo(0.6, 1);
  });
});

describe('Batalla completa', () => {
  it('termina con un vencedor, deja cadáveres y es rápida con ~500 hombres', () => {
    const e = new HardcoreCombatEngine({ weather: 'rain', seed: 21 });
    for (let i = 0; i < 4; i++) e.addSquad(escuadra({ faction: 'rome', unitClass: 'legionary', count: 59, leader: 'centurion', center: { x: -45 + i * 30, z: -40 }, ai: true }));
    for (let i = 0; i < 5; i++) e.addSquad(escuadra({ faction: 'barbarian', unitClass: 'warrior', count: 49, leader: 'chieftain', center: { x: -60 + i * 30, z: 40 }, facing: Math.PI, formation: 'loose', ai: true }));
    const t0 = performance.now();
    correr(e, 600);
    const ms = performance.now() - t0;
    expect(e.result).not.toBeNull();
    expect(e.corpses.length).toBeGreaterThan(30);
    expect(e.units.some((u) => u.state === 'routing' || u.state === 'fled')).toBe(true);
    console.log(`ganador ${e.result!.winner} en ${e.time.toFixed(0)} s, ${e.corpses.length} cadáveres, ${ms.toFixed(0)} ms`);
    expect(ms / (e.time * 20)).toBeLessThan(8); // < 8 ms por tick
  });
});
