/**
 * HardcoreCombatEngine — simulación de batalla campal con masa, colisiones, moral y formaciones.
 *
 * Unidades en METROS y SEGUNDOS. Plano del suelo X/Z, Y hacia arriba (convención Three.js).
 * Es una simulación pura y determinista (RNG con semilla): no sabe nada del render.
 *
 * Pilares:
 *  - Colisión por vectores con masa: el más pesado empuja al ligero; las cargas transfieren
 *    energía cinética (½·μ·v²) en daño, derribo y choque de moral.
 *  - Moral (0-100): cae por bajas, flanqueos, artillería, caballería cercana, fatiga y hambre;
 *    el centurión la sostiene. Por debajo de ROUT_THRESHOLD la unidad huye y arroja el escudo.
 *  - Formaciones geométricas: línea, testudo, orbis, cuneus y orden abierto.
 *  - Balística con gravedad real (9,81 m/s²) para pila, flechas y piedras de onagro.
 */
import { calcularTiroPorAngulo, calcularTiroPorVelocidad, posicionEnVuelo, type Tiro } from './Ballistics';
import { mulberry32 } from '../systems/BaseGenerator';

export const GRAVITY = 9.81;
export const ROUT_THRESHOLD = 20;
export const RALLY_THRESHOLD = 55;

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export type Faction = 'rome' | 'barbarian';
export type UnitClass =
  | 'legionary'
  | 'centurion'
  | 'velite'
  | 'eques'
  | 'warrior'
  | 'chieftain'
  | 'archer'
  | 'horseman'
  | 'onager';
export type FormationType = 'line' | 'testudo' | 'orbis' | 'cuneus' | 'loose';
export type SquadOrder = 'hold' | 'advance' | 'charge' | 'move' | 'retreat';
export type UnitState = 'formed' | 'engaged' | 'routing' | 'fled' | 'dead';
export type Weather = 'clear' | 'rain' | 'fog' | 'dusk';

export interface UnitEntity {
  id: string;
  name: string;
  faction: Faction;
  position: Vector3D;
  velocity: Vector3D;
  mass: number; // Peso físico para colisiones de carga (kg, jinete + caballo incluidos)
  hp: number;
  maxHp: number;
  armor: number; // Reducción de daño físico (lorica hamata/segmentata), 0..1
  morale: number; // 0 a 100 (si baja de ROUT_THRESHOLD, la unidad entra en pánico y huye)
  fatigue: number; // 0 a 100
  unitClass: UnitClass;
  squadId: string;
  /** Orientación en radianes alrededor de Y (0 = mira hacia +Z). */
  facing: number;
  hasShield: boolean;
  pila: number;
  state: UnitState;
  targetId: string | null;
  attackCooldown: number;
  missileCooldown: number;
  impactCooldown: number;
  stun: number;
  radius: number;
  mounted: boolean;
  /** Sangre acumulada en el arma (0..1), para el render. */
  bloodiness: number;
  /** Temporizador de animación de golpe (s). */
  attackAnim: number;
  /** Último instante en que recibió un golpe (para entrar en combate). */
  lastHitAt: number;
}

export interface MissileStats {
  kind: 'arrow' | 'javelin' | 'stone';
  range: number;
  minRange: number;
  damage: number;
  interval: number;
  speed: number;
}

export interface ClassStats {
  label: string;
  mass: number;
  hp: number;
  armor: number;
  damage: number;
  attackInterval: number;
  reach: number;
  walk: number;
  run: number;
  /** Fuerza de propulsión (N): con la masa determina la aceleración. */
  force: number;
  radius: number;
  shield: boolean;
  pila: number;
  skill: number;
  discipline: number;
  mounted: boolean;
  missile?: MissileStats;
}

export const CLASS_STATS: Record<UnitClass, ClassStats> = {
  legionary: { label: 'Legionario', mass: 100, hp: 100, armor: 0.45, damage: 14, attackInterval: 1.3, reach: 0.9, walk: 1.4, run: 3.6, force: 650, radius: 0.4, shield: true, pila: 2, skill: 0.68, discipline: 78, mounted: false },
  centurion: { label: 'Centurión', mass: 105, hp: 150, armor: 0.55, damage: 18, attackInterval: 1.1, reach: 1.0, walk: 1.4, run: 3.8, force: 700, radius: 0.42, shield: true, pila: 1, skill: 0.82, discipline: 96, mounted: false },
  velite: { label: 'Vélite', mass: 72, hp: 70, armor: 0.1, damage: 8, attackInterval: 1.2, reach: 0.9, walk: 1.6, run: 4.6, force: 520, radius: 0.38, shield: true, pila: 0, skill: 0.5, discipline: 55, mounted: false, missile: { kind: 'arrow', range: 65, minRange: 4, damage: 16, interval: 2.4, speed: 42 } },
  eques: { label: 'Eques', mass: 560, hp: 160, armor: 0.35, damage: 19, attackInterval: 1.4, reach: 1.7, walk: 2.2, run: 9.5, force: 5200, radius: 0.95, shield: true, pila: 0, skill: 0.66, discipline: 72, mounted: true },
  warrior: { label: 'Guerrero germano', mass: 88, hp: 110, armor: 0.15, damage: 16, attackInterval: 1.2, reach: 1.0, walk: 1.5, run: 4.3, force: 640, radius: 0.4, shield: true, pila: 0, skill: 0.6, discipline: 58, mounted: false },
  chieftain: { label: 'Caudillo', mass: 105, hp: 190, armor: 0.35, damage: 22, attackInterval: 1.1, reach: 1.1, walk: 1.5, run: 4.4, force: 760, radius: 0.43, shield: true, pila: 0, skill: 0.8, discipline: 88, mounted: false },
  archer: { label: 'Arquero', mass: 70, hp: 70, armor: 0.05, damage: 6, attackInterval: 1.3, reach: 0.9, walk: 1.6, run: 4.4, force: 500, radius: 0.38, shield: false, pila: 0, skill: 0.45, discipline: 40, mounted: false, missile: { kind: 'arrow', range: 75, minRange: 5, damage: 17, interval: 2.6, speed: 45 } },
  horseman: { label: 'Jinete germano', mass: 520, hp: 135, armor: 0.2, damage: 17, attackInterval: 1.3, reach: 1.7, walk: 2.2, run: 10, force: 5000, radius: 0.95, shield: true, pila: 0, skill: 0.6, discipline: 58, mounted: true },
  onager: { label: 'Onagro', mass: 2200, hp: 320, armor: 0.25, damage: 0, attackInterval: 99, reach: 0, walk: 0.6, run: 0.8, force: 4000, radius: 1.8, shield: false, pila: 0, skill: 0, discipline: 85, mounted: false, missile: { kind: 'stone', range: 170, minRange: 30, damage: 95, interval: 8, speed: 0 } },
};

export interface FormationMods {
  label: string;
  /** Multiplicador de velocidad mientras mantiene la formación. */
  speed: number;
  /** Separación entre hombres (m). */
  spacing: number;
  /** Multiplicador del daño de proyectiles recibido. */
  missileTaken: number;
  /** Suma a la probabilidad de bloqueo con escudo. */
  blockBonus: number;
  /** El escudo protege en todas direcciones (no hay flanco). */
  allDirections: boolean;
  /** Multiplicador del daño cuerpo a cuerpo recibido (densidad defensiva). */
  meleeTaken: number;
  /** Multiplicador del daño cuerpo a cuerpo infligido. */
  meleeDealt: number;
  /** Energía de impacto que inflige al cargar. */
  impactDealt: number;
  /** Energía de impacto que recibe. */
  impactTaken: number;
  /** Multiplicador extra de impacto recibido de caballería por el frente. */
  frontalCavalryTaken: number;
}

export const FORMATIONS: Record<FormationType, FormationMods> = {
  line: { label: 'Línea', speed: 1, spacing: 1.3, missileTaken: 1, blockBonus: 0, allDirections: false, meleeTaken: 1, meleeDealt: 1, impactDealt: 1, impactTaken: 1, frontalCavalryTaken: 1 },
  // Caparazón impenetrable a distancia, −50% velocidad y torpe frente a cargas de caballería pesada.
  testudo: { label: 'Testudo', speed: 0.5, spacing: 0.95, missileTaken: 0.08, blockBonus: 0.25, allDirections: false, meleeTaken: 0.85, meleeDealt: 0.7, impactDealt: 0.6, impactTaken: 1, frontalCavalryTaken: 2 },
  // Densidad defensiva +200% en todas direcciones (daño y empuje recibidos ÷3); casi estática.
  orbis: { label: 'Orbis', speed: 0.15, spacing: 1.05, missileTaken: 0.7, blockBonus: 0.15, allDirections: true, meleeTaken: 1 / 3, meleeDealt: 0.6, impactDealt: 0.8, impactTaken: 1 / 3, frontalCavalryTaken: 1 },
  // Cuña: factor de impacto de masa cinemática ×2.5.
  cuneus: { label: 'Cuneus', speed: 0.9, spacing: 1.2, missileTaken: 1.15, blockBonus: -0.1, allDirections: false, meleeTaken: 1.1, meleeDealt: 1.15, impactDealt: 2.5, impactTaken: 1, frontalCavalryTaken: 1 },
  loose: { label: 'Orden abierto', speed: 1.1, spacing: 2.4, missileTaken: 0.6, blockBonus: -0.1, allDirections: false, meleeTaken: 1.15, meleeDealt: 1, impactDealt: 0.9, impactTaken: 1.25, frontalCavalryTaken: 1 },
};

export const WEATHER: Record<Weather, { label: string; mountedSpeed: number; footSpeed: number; missileRange: number; fatigueRate: number; mud: number }> = {
  clear: { label: 'Despejado', mountedSpeed: 1, footSpeed: 1, missileRange: 1, fatigueRate: 1, mud: 0.15 },
  // Lluvia intensa: el barro reduce la velocidad de la caballería un 40%.
  rain: { label: 'Lluvia intensa', mountedSpeed: 0.6, footSpeed: 0.88, missileRange: 0.8, fatigueRate: 1.5, mud: 1 },
  fog: { label: 'Niebla del limes', mountedSpeed: 0.95, footSpeed: 1, missileRange: 0.5, fatigueRate: 1, mud: 0.4 },
  dusk: { label: 'Atardecer polvoriento', mountedSpeed: 1, footSpeed: 1, missileRange: 0.85, fatigueRate: 1.15, mud: 0.05 },
};

export interface Squad {
  id: string;
  name: string;
  faction: Faction;
  unitClass: UnitClass;
  formation: FormationType;
  order: SquadOrder;
  /** Punto de referencia de la formación (centro de la primera fila). */
  anchor: { x: number; z: number };
  facing: number;
  target: { x: number; z: number } | null;
  targetSquadId: string | null;
  memberIds: string[];
  leaderId: string | null;
  initialSize: number;
  ai: boolean;
  routed: boolean;
  /** Fase de la IA de flanqueo de caballería. */
  flankPhase: 'approach' | 'charge';
  ranks: number;
}

export interface Corpse {
  x: number;
  z: number;
  faction: Faction;
  unitClass: UnitClass;
  rotation: number;
  mounted: boolean;
  dismembered: boolean;
}

export interface Projectile {
  id: number;
  kind: MissileStats['kind'] | 'pilum';
  faction: Faction;
  shooterId: string;
  tiro: Tiro;
  t: number;
  damage: number;
  /** Altura y (m) en el instante actual (para el render). */
  y: number;
  x: number;
  z: number;
}

export type CombatEvent =
  | { type: 'hit'; x: number; y: number; z: number; damage: number; flank: boolean }
  | { type: 'block'; x: number; y: number; z: number }
  | { type: 'death'; unitId: string; x: number; z: number; dismembered: boolean; faction: Faction }
  | { type: 'impact'; x: number; z: number; energy: number }
  | { type: 'missile'; kind: Projectile['kind']; x: number; z: number }
  | { type: 'missileLand'; kind: Projectile['kind']; x: number; z: number; hit: boolean }
  | { type: 'shieldPierced'; unitId: string; x: number; z: number }
  | { type: 'shieldDropped'; unitId: string; x: number; z: number; rotation: number }
  | { type: 'rout'; squadId: string }
  | { type: 'rally'; squadId: string }
  | { type: 'leaderDown'; squadId: string }
  | { type: 'desertion'; count: number };

export interface BattleConfig {
  weather: Weather;
  /** Líneas de suministro cortadas: hambre, moral reducida y deserción. */
  starving?: Partial<Record<Faction, boolean>>;
  fieldSize?: number;
  seed?: number;
  /** Altura del terreno (m) en (x, z). */
  heightAt?: (x: number, z: number) => number;
  /** Multiplicador de velocidad por el suelo (barro, surcos) en (x, z). */
  groundSpeedAt?: (x: number, z: number) => number;
  timeLimit?: number;
}

export interface SquadSpec {
  name: string;
  faction: Faction;
  unitClass: UnitClass;
  count: number;
  center: { x: number; z: number };
  facing: number;
  formation: FormationType;
  ai: boolean;
  /** Clase del líder (centurión, caudillo) que se añade a la escuadra. */
  leader?: UnitClass;
}

export interface BattleResult {
  winner: Faction | 'draw';
  dead: Record<Faction, Partial<Record<UnitClass, number>>>;
  fled: Record<Faction, number>;
  deserted: number;
  duration: number;
}

// ───────────────────────── Geometría de formaciones ─────────────────────────

/**
 * Posiciones locales (x lateral, z hacia delante) para n hombres. La primera fila está en z=0
 * y las siguientes hacia atrás (z negativa).
 */
export function formationSlots(type: FormationType, n: number, ranksHint = 4): { x: number; z: number }[] {
  const s = FORMATIONS[type].spacing;
  const slots: { x: number; z: number }[] = [];
  if (n <= 0) return slots;
  switch (type) {
    case 'testudo': {
      const lado = Math.ceil(Math.sqrt(n));
      for (let i = 0; i < n; i++) {
        const fila = Math.floor(i / lado);
        const col = i % lado;
        slots.push({ x: (col - (lado - 1) / 2) * s, z: -fila * s });
      }
      break;
    }
    case 'orbis': {
      // Anillos concéntricos; el anillo exterior primero (los escudos mirando afuera).
      let restantes = n;
      let radio = Math.max(2, Math.sqrt(n) * s * 0.55);
      const centro = -radio;
      while (restantes > 0 && radio > 0.3) {
        const capacidad = Math.max(1, Math.floor((2 * Math.PI * radio) / s));
        const enAnillo = Math.min(restantes, capacidad);
        for (let k = 0; k < enAnillo; k++) {
          const a = (k / enAnillo) * Math.PI * 2;
          slots.push({ x: Math.sin(a) * radio, z: centro + Math.cos(a) * radio });
        }
        restantes -= enAnillo;
        radio -= s;
      }
      for (let k = 0; k < restantes; k++) slots.push({ x: (k % 3) - 1, z: centro - Math.floor(k / 3) });
      break;
    }
    case 'cuneus': {
      // Punta de cerdo: la fila r tiene r+1 hombres; la punta va delante.
      let fila = 0;
      let i = 0;
      while (i < n) {
        const enFila = Math.min(fila + 1, n - i);
        for (let k = 0; k < enFila; k++) slots.push({ x: (k - (fila) / 2) * s, z: -fila * s * 0.9 });
        i += enFila;
        fila++;
      }
      break;
    }
    case 'line':
    case 'loose': {
      const filas = Math.max(1, Math.min(ranksHint, n));
      const ancho = Math.ceil(n / filas);
      for (let i = 0; i < n; i++) {
        const fila = Math.floor(i / ancho);
        const col = i % ancho;
        // Las filas pares se desplazan media plaza (tresbolillo, como el quincunx).
        const desfase = type === 'loose' && fila % 2 ? s / 2 : 0;
        slots.push({ x: (col - (ancho - 1) / 2) * s + desfase, z: -fila * s });
      }
      break;
    }
  }
  return slots;
}

function rotar(p: { x: number; z: number }, angulo: number): { x: number; z: number } {
  const c = Math.cos(angulo);
  const s = Math.sin(angulo);
  // facing 0 mira a +Z; x local es la derecha del soldado.
  return { x: p.x * c + p.z * s, z: -p.x * s + p.z * c };
}

function anguloHacia(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

function diferenciaAngular(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ───────────────────────── Rejilla espacial ─────────────────────────

class SpatialHash<T extends { position: Vector3D }> {
  private readonly celdas = new Map<number, T[]>();
  constructor(private readonly tamano: number) {}
  private clave(ix: number, iz: number): number {
    return (ix + 4096) * 8192 + (iz + 4096);
  }
  reconstruir(items: Iterable<T>): void {
    this.celdas.clear();
    for (const it of items) {
      const k = this.clave(Math.floor(it.position.x / this.tamano), Math.floor(it.position.z / this.tamano));
      let lista = this.celdas.get(k);
      if (!lista) this.celdas.set(k, (lista = []));
      lista.push(it);
    }
  }
  consultar(x: number, z: number, radio: number, visitar: (it: T) => void): void {
    const x0 = Math.floor((x - radio) / this.tamano), x1 = Math.floor((x + radio) / this.tamano);
    const z0 = Math.floor((z - radio) / this.tamano), z1 = Math.floor((z + radio) / this.tamano);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const lista = this.celdas.get(this.clave(ix, iz));
        if (lista) for (const it of lista) visitar(it);
      }
    }
  }
}

// ───────────────────────── Motor ─────────────────────────

export class HardcoreCombatEngine {
  readonly units: UnitEntity[] = [];
  readonly squads: Squad[] = [];
  readonly corpses: Corpse[] = [];
  projectiles: Projectile[] = [];
  events: CombatEvent[] = [];
  time = 0;
  result: BattleResult | null = null;
  deserted = 0;
  readonly config: Required<Omit<BattleConfig, 'heightAt' | 'groundSpeedAt' | 'starving'>> & BattleConfig;

  private readonly porId = new Map<string, UnitEntity>();
  private readonly porEscuadra = new Map<string, Squad>();
  private readonly hash = new SpatialHash<UnitEntity>(3);
  private readonly hashCadaveres = new SpatialHash<{ position: Vector3D; c: Corpse }>(2);
  private readonly rnd: () => number;
  private siguienteId = 1;
  private siguienteProyectil = 1;
  /** Plazas asignadas por escuadra en el tick actual (unitId → posición mundial). */
  private readonly plazas = new Map<string, Map<string, { x: number; z: number }>>();
  private readonly centros = new Map<string, { x: number; z: number } | null>();
  private inicializada = false;

  constructor(config: BattleConfig) {
    this.config = { fieldSize: 260, seed: 1, timeLimit: 20 * 60, ...config };
    this.rnd = mulberry32(this.config.seed);
  }

  // ───────── Montaje ─────────

  addSquad(spec: SquadSpec): Squad {
    const id = `${spec.faction}-${this.squads.length + 1}`;
    const squad: Squad = {
      id,
      name: spec.name,
      faction: spec.faction,
      unitClass: spec.unitClass,
      formation: spec.formation,
      order: 'hold',
      anchor: { ...spec.center },
      facing: spec.facing,
      target: null,
      targetSquadId: null,
      memberIds: [],
      leaderId: null,
      initialSize: 0,
      ai: spec.ai,
      routed: false,
      flankPhase: 'approach',
      ranks: CLASS_STATS[spec.unitClass].mounted ? 2 : 4,
    };
    const total = spec.count + (spec.leader ? 1 : 0);
    const slots = formationSlots(spec.formation, total, squad.ranks);
    for (let i = 0; i < total; i++) {
      const clase = spec.leader && i === 0 ? spec.leader : spec.unitClass;
      const off = rotar(slots[i], spec.facing);
      const u = this.crearUnidad(clase, spec.faction, id, spec.center.x + off.x, spec.center.z + off.z, spec.facing);
      squad.memberIds.push(u.id);
      if (spec.leader && i === 0) squad.leaderId = u.id;
    }
    squad.initialSize = squad.memberIds.length;
    this.squads.push(squad);
    this.porEscuadra.set(id, squad);
    return squad;
  }

  private crearUnidad(clase: UnitClass, faction: Faction, squadId: string, x: number, z: number, facing: number): UnitEntity {
    const st = CLASS_STATS[clase];
    const variacion = 0.92 + this.rnd() * 0.16;
    const u: UnitEntity = {
      id: `u${this.siguienteId++}`,
      name: st.label,
      faction,
      position: { x, y: this.altura(x, z), z },
      velocity: { x: 0, y: 0, z: 0 },
      mass: st.mass * variacion,
      hp: st.hp,
      maxHp: st.hp,
      armor: st.armor,
      morale: Math.min(100, st.discipline + 20),
      fatigue: 0,
      unitClass: clase,
      squadId,
      facing,
      hasShield: st.shield,
      pila: st.pila,
      state: 'formed',
      targetId: null,
      attackCooldown: this.rnd() * st.attackInterval,
      missileCooldown: this.rnd() * (st.missile?.interval ?? 1),
      impactCooldown: 0,
      stun: 0,
      radius: st.radius,
      mounted: st.mounted,
      bloodiness: 0,
      attackAnim: 0,
      lastHitAt: -99,
    };
    this.units.push(u);
    this.porId.set(u.id, u);
    return u;
  }

  unit(id: string | null): UnitEntity | undefined {
    return id ? this.porId.get(id) : undefined;
  }

  squad(id: string | null): Squad | undefined {
    return id ? this.porEscuadra.get(id) : undefined;
  }

  // ───────── Órdenes ─────────

  order(squadId: string, order: SquadOrder, target?: { x: number; z: number }): void {
    const s = this.porEscuadra.get(squadId);
    if (!s) return;
    s.order = order;
    s.target = target ? { ...target } : null;
    if (order === 'charge' || order === 'advance') {
      const enemiga = this.escuadraEnemigaMasCercana(s);
      s.targetSquadId = enemiga?.id ?? null;
    }
    if (order === 'hold' || order === 'move') {
      for (const u of this.miembros(s)) if (u.state === 'engaged' && !this.enemigoCerca(u, 3)) u.state = 'formed';
    }
  }

  setFormation(squadId: string, formation: FormationType): void {
    const s = this.porEscuadra.get(squadId);
    if (!s) return;
    if (CLASS_STATS[s.unitClass].mounted && (formation === 'testudo' || formation === 'orbis')) return;
    s.formation = formation;
  }

  /** Ordena una andanada de pila contra el enemigo más cercano a menos de 28 m. */
  throwPila(squadId: string): number {
    const s = this.porEscuadra.get(squadId);
    if (!s) return 0;
    let lanzados = 0;
    for (const u of this.miembros(s)) {
      if (u.pila <= 0 || u.state === 'routing' || u.stun > 0) continue;
      const objetivo = this.enemigoMasCercano(u, 28 * WEATHER[this.config.weather].missileRange + 4);
      if (objetivo && this.lanzarPilum(u, objetivo)) lanzados++;
    }
    return lanzados;
  }

  // ───────── Consultas ─────────

  miembros(s: Squad): UnitEntity[] {
    const r: UnitEntity[] = [];
    for (const id of s.memberIds) {
      const u = this.porId.get(id)!;
      if (u.state !== 'dead' && u.state !== 'fled') r.push(u);
    }
    return r;
  }

  centroide(s: Squad): { x: number; z: number } | null {
    const m = this.miembros(s).filter((u) => u.state !== 'routing');
    if (!m.length) return null;
    let x = 0, z = 0;
    for (const u of m) {
      x += u.position.x;
      z += u.position.z;
    }
    return { x: x / m.length, z: z / m.length };
  }

  /** Moral media de los miembros vivos (0-100). */
  moralMedia(s: Squad): number {
    const m = this.miembros(s);
    return m.length ? m.reduce((a, u) => a + u.morale, 0) / m.length : 0;
  }

  fuerza(faction: Faction): { activos: number; total: number; moral: number } {
    let activos = 0, total = 0, moral = 0;
    for (const u of this.units) {
      if (u.faction !== faction) continue;
      total++;
      if (u.state === 'formed' || u.state === 'engaged') {
        activos++;
        moral += u.morale;
      }
    }
    return { activos, total, moral: activos ? moral / activos : 0 };
  }

  private altura(x: number, z: number): number {
    return this.config.heightAt ? this.config.heightAt(x, z) : 0;
  }

  private enemigoCerca(u: UnitEntity, radio: number): boolean {
    return !!this.enemigoMasCercano(u, radio);
  }

  private enemigoMasCercano(u: UnitEntity, radio: number): UnitEntity | undefined {
    let mejor: UnitEntity | undefined;
    let mejorD = radio * radio;
    this.hash.consultar(u.position.x, u.position.z, radio, (o) => {
      if (o.faction === u.faction || o.state === 'dead' || o.state === 'fled') return;
      const dx = o.position.x - u.position.x, dz = o.position.z - u.position.z;
      const d = dx * dx + dz * dz;
      if (d < mejorD) {
        mejorD = d;
        mejor = o;
      }
    });
    return mejor;
  }

  /** Enemigo más cercano buscando en todo el campo (para ataques a distancia y IA). */
  private enemigoGlobal(u: UnitEntity, maxD: number, preferirNoHuyendo = true): UnitEntity | undefined {
    let mejor: UnitEntity | undefined;
    let mejorD = maxD * maxD;
    for (const o of this.units) {
      if (o.faction === u.faction || o.state === 'dead' || o.state === 'fled') continue;
      if (preferirNoHuyendo && o.state === 'routing') continue;
      const dx = o.position.x - u.position.x, dz = o.position.z - u.position.z;
      const d = dx * dx + dz * dz;
      if (d < mejorD) {
        mejorD = d;
        mejor = o;
      }
    }
    return mejor;
  }

  private escuadraEnemigaMasCercana(s: Squad): Squad | undefined {
    const c = this.centroide(s) ?? s.anchor;
    let mejor: Squad | undefined;
    let mejorD = Infinity;
    for (const o of this.squads) {
      if (o.faction === s.faction || o.routed) continue;
      const oc = this.centroide(o);
      if (!oc) continue;
      const d = Math.hypot(oc.x - c.x, oc.z - c.z);
      if (d < mejorD) {
        mejorD = d;
        mejor = o;
      }
    }
    return mejor;
  }

  // ───────── Bucle ─────────

  step(dt: number): void {
    if (this.result) return;
    if (!this.inicializada) this.inicializar();
    this.time += dt;
    const vivos = this.units.filter((u) => u.state !== 'dead' && u.state !== 'fled');
    this.hash.reconstruir(vivos);

    for (const s of this.squads) this.actualizarEscuadra(s, dt);
    for (const u of vivos) this.actualizarUnidad(u, dt);
    this.resolverColisiones(vivos);
    for (const u of vivos) this.integrar(u, dt);
    this.actualizarProyectiles(dt);
    for (const u of vivos) this.actualizarMoral(u, dt);
    for (const s of this.squads) this.revisarDesbandada(s);
    this.comprobarFin();
  }

  /** Deserción por hambre al inicio de la batalla. */
  private inicializar(): void {
    this.inicializada = true;
    for (const faction of ['rome', 'barbarian'] as Faction[]) {
      if (!this.config.starving?.[faction]) continue;
      let desertores = 0;
      for (const u of this.units) {
        if (u.faction !== faction) continue;
        u.morale -= 30;
        const esLider = this.squads.some((s) => s.leaderId === u.id);
        if (!esLider && u.unitClass !== 'onager' && this.rnd() < 0.15) {
          u.state = 'fled';
          desertores++;
        }
      }
      if (faction === 'rome') this.deserted += desertores;
      this.events.push({ type: 'desertion', count: desertores });
    }
  }

  // ───────── IA de escuadra y movimiento del ancla ─────────

  private actualizarEscuadra(s: Squad, dt: number): void {
    this.moverAncla(s, dt);
    // Las plazas se recalculan con los vivos para cerrar huecos (las filas se compactan).
    const formados = this.miembros(s).filter((m) => m.state !== 'routing');
    const slots = formationSlots(s.formation, formados.length, s.ranks);
    const mapa = new Map<string, { x: number; z: number }>();
    formados.forEach((u, i) => {
      const off = rotar(slots[i], s.facing);
      mapa.set(u.id, { x: s.anchor.x + off.x, z: s.anchor.z + off.z });
    });
    this.plazas.set(s.id, mapa);
    this.centros.set(s.id, this.centroide(s));
  }

  private moverAncla(s: Squad, dt: number): void {
    const miembros = this.miembros(s);
    if (!miembros.length) return;
    const centro = this.centroide(s);
    if (s.ai) this.decidirIA(s, centro);

    const enemiga = this.squad(s.targetSquadId);
    const enemigaCentro = enemiga ? this.centroide(enemiga) : null;
    if ((s.order === 'advance' || s.order === 'charge') && (!enemiga || enemiga.routed || !enemigaCentro)) {
      const nueva = this.escuadraEnemigaMasCercana(s);
      s.targetSquadId = nueva?.id ?? null;
    }
    let destino: { x: number; z: number } | null = s.target;
    if ((s.order === 'advance' || s.order === 'charge') && enemigaCentro) destino = enemigaCentro;
    if (s.order === 'retreat') {
      const borde = (this.config.fieldSize / 2) * (s.faction === 'rome' ? -1 : 1) * 0.85;
      destino = { x: s.anchor.x, z: borde };
    }
    if (!destino || s.order === 'hold') return;

    const dx = destino.x - s.anchor.x;
    const dz = destino.z - s.anchor.z;
    const d = Math.hypot(dx, dz);
    // En avance, el ancla se detiene a una distancia de choque y deja que los hombres cierren.
    const parada = s.order === 'advance' ? 6 : s.order === 'charge' ? 0 : 0.5;
    if (d <= parada) return;
    const st = CLASS_STATS[s.unitClass];
    const fatigaMedia = miembros.reduce((a, u) => a + u.fatigue, 0) / miembros.length;
    let v = (s.order === 'charge' ? st.run : st.walk) * FORMATIONS[s.formation].speed * (1 - fatigaMedia / 250);
    v *= st.mounted ? WEATHER[this.config.weather].mountedSpeed : WEATHER[this.config.weather].footSpeed;
    // El ancla no se adelanta a sus hombres más de unos metros (cohesión).
    if (centro && Math.hypot(centro.x - s.anchor.x, centro.z - s.anchor.z) > 6) v *= 0.3;
    const paso = Math.min(d - parada, v * dt);
    s.anchor.x += (dx / d) * paso;
    s.anchor.z += (dz / d) * paso;
    const objetivoFacing = s.order === 'retreat' ? anguloHacia(-dx, -dz) : anguloHacia(dx, dz);
    const giro = diferenciaAngular(objetivoFacing, s.facing);
    s.facing += Math.sign(giro) * Math.min(Math.abs(giro), 0.8 * dt);
  }

  private decidirIA(s: Squad, centro: { x: number; z: number } | null): void {
    if (!centro) return;
    const enemiga = this.escuadraEnemigaMasCercana(s);
    if (!enemiga) {
      s.order = 'hold';
      return;
    }
    const ec = this.centroide(enemiga)!;
    const d = Math.hypot(ec.x - centro.x, ec.z - centro.z);
    const clase = s.unitClass;
    if (clase === 'archer' || clase === 'velite' || clase === 'onager') {
      const alcance = (CLASS_STATS[clase].missile?.range ?? 50) * WEATHER[this.config.weather].missileRange;
      if (d > alcance * 0.85) {
        s.order = 'move';
        s.target = { x: ec.x + (centro.x - ec.x) * ((alcance * 0.7) / d), z: ec.z + (centro.z - ec.z) * ((alcance * 0.7) / d) };
      } else s.order = 'hold';
      return;
    }
    if (clase === 'horseman' || clase === 'eques') {
      // Flanqueo: rodear por el costado hasta la retaguardia del enemigo y cargar.
      if (s.flankPhase === 'approach') {
        const ef = enemiga.facing;
        const lado = Math.sign(centro.x - ec.x) || 1;
        const punto = { x: ec.x - Math.sin(ef) * 28 + Math.cos(ef) * 40 * lado, z: ec.z - Math.cos(ef) * 28 - Math.sin(ef) * 40 * lado * -1 };
        const dp = Math.hypot(punto.x - centro.x, punto.z - centro.z);
        s.order = 'move';
        s.target = punto;
        if (dp < 14 || d < 22) {
          s.flankPhase = 'charge';
          s.targetSquadId = enemiga.id;
        }
      } else {
        s.order = 'charge';
        s.targetSquadId = enemiga.id;
      }
      return;
    }
    // Infantería: avanza en orden y carga a corta distancia (los romanos, tras lanzar los pila).
    const conPila = this.miembros(s).some((u) => u.pila > 0);
    if (d < (s.faction === 'rome' && conPila ? 16 : 40)) {
      s.order = 'charge';
      s.targetSquadId = enemiga.id;
    } else {
      s.order = 'advance';
      s.targetSquadId = enemiga.id;
    }
  }

  // ───────── Unidades ─────────

  private velocidadMaxima(u: UnitEntity, corriendo: boolean, s: Squad, mantieneFormacion: boolean): number {
    const st = CLASS_STATS[u.unitClass];
    const w = WEATHER[this.config.weather];
    let v = corriendo ? st.run : st.walk;
    if (mantieneFormacion) v *= FORMATIONS[s.formation].speed;
    v *= 1 - u.fatigue / 200;
    v *= u.mounted ? w.mountedSpeed : w.footSpeed;
    if (this.config.groundSpeedAt) v *= this.config.groundSpeedAt(u.position.x, u.position.z);
    // Cadáveres: obstáculos que entorpecen el avance.
    let pisando = false;
    this.hashCadaveres.consultar(u.position.x, u.position.z, 0.8, (c) => {
      if (Math.hypot(c.position.x - u.position.x, c.position.z - u.position.z) < 0.8) pisando = true;
    });
    if (pisando) v *= u.mounted ? 0.75 : 0.6;
    return v;
  }

  private actualizarUnidad(u: UnitEntity, dt: number): void {
    // Puede haber muerto en este mismo tick (la lista de vivos se calcula al principio).
    if (u.state === 'dead' || u.state === 'fled') return;
    const st = CLASS_STATS[u.unitClass];
    const s = this.porEscuadra.get(u.squadId)!;
    u.attackCooldown = Math.max(0, u.attackCooldown - dt);
    u.missileCooldown = Math.max(0, u.missileCooldown - dt);
    u.impactCooldown = Math.max(0, u.impactCooldown - dt);
    u.attackAnim = Math.max(0, u.attackAnim - dt);
    const w = WEATHER[this.config.weather];

    if (u.stun > 0) {
      u.stun -= dt;
      this.frenar(u, dt, 6);
      return;
    }

    if (u.state === 'routing') {
      const amenaza = this.enemigoMasCercano(u, 30);
      const bordeZ = (this.config.fieldSize / 2) * (u.faction === 'rome' ? -1 : 1);
      let dx = 0, dz = bordeZ - u.position.z;
      if (amenaza) {
        dx += (u.position.x - amenaza.position.x) * 2;
        dz += (u.position.z - amenaza.position.z) * 2;
      }
      this.dirigir(u, dx, dz, this.velocidadMaxima(u, true, s, false), dt);
      u.fatigue = Math.min(100, u.fatigue + 2 * w.fatigueRate * dt);
      if (Math.abs(u.position.z) >= this.config.fieldSize / 2 - 1 || Math.abs(u.position.x) >= this.config.fieldSize / 2 - 1) {
        u.state = 'fled';
      }
      return;
    }

    // ── Hostigadores: se repliegan tras las líneas ante la infantería que carga ──
    if (st.missile && u.unitClass !== 'onager' && s.order !== 'charge') {
      const cuerpoACuerpo = this.enemigoMasCercano(u, 11);
      if (cuerpoACuerpo && !CLASS_STATS[cuerpoACuerpo.unitClass].missile) {
        const atras = u.faction === 'rome' ? -1 : 1;
        const dx = u.position.x - cuerpoACuerpo.position.x;
        const dz = u.position.z - cuerpoACuerpo.position.z + atras * 6;
        this.dirigir(u, dx, dz, this.velocidadMaxima(u, true, s, false), dt);
        u.fatigue = Math.min(100, u.fatigue + 1.6 * w.fatigueRate * dt);
        if (Math.abs(u.position.z) < this.config.fieldSize / 2 - 25) {
          // El ancla de la escuadra acompaña el repliegue para que no vuelvan a primera línea.
          s.anchor.z += atras * 0.6 * dt;
        }
        return;
      }
    }

    // ── Proyectiles (onagro, arqueros, vélites) ──
    if (st.missile) {
      const alcance = st.missile.range * w.missileRange;
      const amenaza = this.enemigoMasCercano(u, 2.5);
      if (!amenaza && u.unitClass !== 'onager' && s.order !== 'charge') {
        const obj = this.enemigoGlobal(u, alcance);
        if (obj) {
          const d = Math.hypot(obj.position.x - u.position.x, obj.position.z - u.position.z);
          if (d >= st.missile.minRange) {
            u.facing = anguloHacia(obj.position.x - u.position.x, obj.position.z - u.position.z);
            if (u.missileCooldown <= 0) this.disparar(u, obj, st.missile);
            this.seguirFormacion(u, s, dt, true);
            return;
          }
        }
      }
      if (u.unitClass === 'onager') {
        if (u.missileCooldown <= 0) {
          const obj = this.objetivoOnagro(u, alcance, st.missile.minRange);
          if (obj) this.disparar(u, obj, st.missile);
          else u.missileCooldown = 0.5;
        }
        this.seguirFormacion(u, s, dt, true);
        return;
      }
    }

    // ── Pila: lanzamiento automático a 20 m antes del cuerpo a cuerpo ──
    if (u.pila > 0 && u.state === 'formed' && u.missileCooldown <= 0 && (s.order === 'advance' || s.order === 'charge' || s.order === 'hold')) {
      const obj = this.enemigoMasCercano(u, 20 * w.missileRange);
      if (obj) {
        const d = Math.hypot(obj.position.x - u.position.x, obj.position.z - u.position.z);
        const frente = Math.abs(diferenciaAngular(anguloHacia(obj.position.x - u.position.x, obj.position.z - u.position.z), u.facing)) < 1;
        if (d > 7 && frente) this.lanzarPilum(u, obj);
      }
    }

    // ── Cuerpo a cuerpo ──
    const radioCombate = s.order === 'charge' ? 10 : s.formation === 'testudo' || s.formation === 'orbis' ? 2.2 : 4.5;
    let objetivo = this.unit(u.targetId);
    if (!objetivo || objetivo.state === 'dead' || objetivo.state === 'fled' || Math.hypot(objetivo.position.x - u.position.x, objetivo.position.z - u.position.z) > radioCombate + 4) {
      objetivo = this.enemigoMasCercano(u, radioCombate);
      if (!objetivo && s.order === 'charge') {
        const enemiga = this.squad(s.targetSquadId);
        if (enemiga) objetivo = this.masCercanoDe(u, this.miembros(enemiga));
      }
      if (!objetivo && this.time - u.lastHitAt < 2) objetivo = this.enemigoMasCercano(u, 3);
      u.targetId = objetivo?.id ?? null;
    }
    // Las formaciones cerradas no persiguen a fugitivos.
    if (objetivo && objetivo.state === 'routing' && (s.formation === 'testudo' || s.formation === 'orbis' || s.order === 'hold')) objetivo = undefined;

    if (objetivo) {
      u.state = 'engaged';
      const dx = objetivo.position.x - u.position.x;
      const dz = objetivo.position.z - u.position.z;
      const d = Math.hypot(dx, dz);
      const alcance = st.reach + u.radius + objetivo.radius;
      const rapidez = Math.hypot(u.velocity.x, u.velocity.z);
      // Carga: a la carrera no se frena al entrar en distancia de golpe, se embiste.
      const embistiendo = s.order === 'charge' && u.impactCooldown <= 0 && rapidez > (u.mounted ? 4 : 2.5);
      if (d <= alcance && embistiendo) {
        this.dirigir(u, dx, dz, this.velocidadMaxima(u, true, s, false), dt);
        if (u.attackCooldown <= 0) this.golpear(u, objetivo);
      } else if (d <= alcance) {
        u.facing = anguloHacia(dx, dz);
        this.frenar(u, dt, 8);
        if (u.attackCooldown <= 0) this.golpear(u, objetivo);
        u.fatigue = Math.min(100, u.fatigue + 1.4 * w.fatigueRate * dt);
      } else {
        const mantener = s.formation === 'testudo' || s.formation === 'orbis';
        const corre = !mantener && (s.order === 'charge' || d > 3);
        this.dirigir(u, dx, dz, this.velocidadMaxima(u, corre, s, mantener), dt);
        u.fatigue = Math.min(100, u.fatigue + (corre ? 1.8 : 0.3) * w.fatigueRate * dt);
      }
      return;
    }
    if (u.state === 'engaged') u.state = 'formed';
    this.seguirFormacion(u, s, dt, false);
  }

  private masCercanoDe(u: UnitEntity, lista: UnitEntity[]): UnitEntity | undefined {
    let mejor: UnitEntity | undefined;
    let mejorD = Infinity;
    for (const o of lista) {
      if (o.state === 'routing') continue;
      const d = Math.hypot(o.position.x - u.position.x, o.position.z - u.position.z);
      if (d < mejorD) {
        mejorD = d;
        mejor = o;
      }
    }
    return mejor;
  }

  /** El onagro prefiere masas densas de enemigos: elige el objetivo con más vecinos. */
  private objetivoOnagro(u: UnitEntity, alcance: number, minimo: number): UnitEntity | undefined {
    let mejor: UnitEntity | undefined;
    let mejorPuntos = 0;
    for (const o of this.units) {
      if (o.faction === u.faction || (o.state !== 'formed' && o.state !== 'engaged')) continue;
      const d = Math.hypot(o.position.x - u.position.x, o.position.z - u.position.z);
      if (d > alcance || d < minimo) continue;
      // No disparar sobre el combate cuerpo a cuerpo (fuego amigo).
      let amigos = 0, enemigos = 0;
      this.hash.consultar(o.position.x, o.position.z, 4, (v) => {
        if (v.state === 'dead' || v.state === 'fled') return;
        if (v.faction === u.faction) amigos++;
        else enemigos++;
      });
      if (amigos > 0) continue;
      const puntos = enemigos + this.rnd() * 0.5;
      if (puntos > mejorPuntos) {
        mejorPuntos = puntos;
        mejor = o;
      }
    }
    return mejor;
  }

  private seguirFormacion(u: UnitEntity, s: Squad, dt: number, quieto: boolean): void {
    const plaza = this.plazas.get(s.id)?.get(u.id) ?? s.anchor;
    const tx = plaza.x;
    const tz = plaza.z;
    const dx = tx - u.position.x;
    const dz = tz - u.position.z;
    const d = Math.hypot(dx, dz);
    const w = WEATHER[this.config.weather];
    if (d < 0.25 || (quieto && d < 1.5)) {
      this.frenar(u, dt, 5);
      const giro = diferenciaAngular(s.facing, u.facing);
      u.facing += Math.sign(giro) * Math.min(Math.abs(giro), 2 * dt);
      if (s.formation === 'orbis') {
        // En orbis cada hombre mira hacia fuera del círculo.
        const c = this.centros.get(s.id);
        if (c) u.facing = anguloHacia(u.position.x - c.x, u.position.z - c.z);
      }
      u.fatigue = Math.max(0, u.fatigue - 1.2 * dt);
      return;
    }
    const corre = d > 4;
    const vmax = Math.min(this.velocidadMaxima(u, corre, s, !corre), d * 2);
    this.dirigir(u, dx, dz, vmax, dt);
    u.fatigue = Math.min(100, Math.max(0, u.fatigue + (corre ? 1.5 : 0.1) * w.fatigueRate * dt - (corre ? 0 : 0.3 * dt)));
  }

  /** Acelera hacia una dirección con la aceleración limitada por fuerza/masa. */
  private dirigir(u: UnitEntity, dx: number, dz: number, vmax: number, dt: number): void {
    const d = Math.hypot(dx, dz) || 1;
    const deseadaX = (dx / d) * vmax;
    const deseadaZ = (dz / d) * vmax;
    const st = CLASS_STATS[u.unitClass];
    const maxDv = (st.force / u.mass) * dt;
    let ax = deseadaX - u.velocity.x;
    let az = deseadaZ - u.velocity.z;
    const m = Math.hypot(ax, az);
    if (m > maxDv) {
      ax = (ax / m) * maxDv;
      az = (az / m) * maxDv;
    }
    u.velocity.x += ax;
    u.velocity.z += az;
    if (Math.hypot(u.velocity.x, u.velocity.z) > 0.3) {
      const objetivo = anguloHacia(u.velocity.x, u.velocity.z);
      const giro = diferenciaAngular(objetivo, u.facing);
      u.facing += Math.sign(giro) * Math.min(Math.abs(giro), (u.mounted ? 2.5 : 5) * dt);
    }
  }

  private frenar(u: UnitEntity, dt: number, factor: number): void {
    const k = Math.max(0, 1 - factor * dt);
    u.velocity.x *= k;
    u.velocity.z *= k;
  }

  // ───────── Combate cuerpo a cuerpo ─────────

  private esFrontal(defensor: UnitEntity, atacante: { x: number; z: number }): boolean {
    const a = anguloHacia(atacante.x - defensor.position.x, atacante.z - defensor.position.z);
    return Math.abs(diferenciaAngular(a, defensor.facing)) < (75 * Math.PI) / 180;
  }

  private golpear(a: UnitEntity, d: UnitEntity): void {
    const st = CLASS_STATS[a.unitClass];
    const sa = this.porEscuadra.get(a.squadId)!;
    const sd = this.porEscuadra.get(d.squadId)!;
    const fa = FORMATIONS[sa.formation];
    const fd = FORMATIONS[sd.formation];
    a.attackCooldown = st.attackInterval * (0.85 + this.rnd() * 0.3) * (1 + a.fatigue / 200);
    a.attackAnim = 0.45;
    const pos = { x: (a.position.x + d.position.x) / 2, y: d.position.y + (d.mounted ? 1.8 : 1.2), z: (a.position.z + d.position.z) / 2 };

    const acierto = st.skill * (0.65 + 0.35 * (1 - a.fatigue / 100));
    if (this.rnd() > acierto) return;

    const frontal = fd.allDirections || this.esFrontal(d, a.position);
    const indefenso = d.stun > 0 || d.state === 'routing';
    if (d.hasShield && frontal && !indefenso) {
      let bloqueo = 0.42 + fd.blockBonus - d.fatigue / 400;
      if (a.mounted && sd.formation === 'testudo') bloqueo -= 0.2;
      if (this.rnd() < bloqueo) {
        this.events.push({ type: 'block', ...pos });
        d.fatigue = Math.min(100, d.fatigue + 1);
        return;
      }
    }
    let dano = st.damage * (0.8 + this.rnd() * 0.4) * (1 - d.armor) * fa.meleeDealt * fd.meleeTaken * (1 - a.fatigue / 250);
    const flanco = !frontal;
    if (flanco) dano *= 1.35;
    if (indefenso) dano *= 1.5;
    this.danar(d, dano, a);
    this.events.push({ type: 'hit', ...pos, damage: dano, flank: flanco });
    a.bloodiness = Math.min(1, a.bloodiness + 0.06);
    if (flanco) this.choque(d, 6);
  }

  private danar(u: UnitEntity, dano: number, atacante?: UnitEntity, desmembrar = false): void {
    if (u.state === 'dead' || u.state === 'fled') return;
    u.hp -= dano;
    u.lastHitAt = this.time;
    this.choque(u, Math.min(4, dano / 12));
    if (u.hp > 0) return;
    u.hp = 0;
    u.state = 'dead';
    u.velocity.x = u.velocity.z = 0;
    const c: Corpse = {
      x: u.position.x,
      z: u.position.z,
      faction: u.faction,
      unitClass: u.unitClass,
      rotation: this.rnd() * Math.PI * 2,
      mounted: u.mounted,
      dismembered: desmembrar,
    };
    this.corpses.push(c);
    this.hashCadaveres.reconstruir(this.corpses.map((k) => ({ position: { x: k.x, y: 0, z: k.z }, c: k })));
    this.events.push({ type: 'death', unitId: u.id, x: u.position.x, z: u.position.z, dismembered: desmembrar, faction: u.faction });
    if (atacante) atacante.bloodiness = Math.min(1, atacante.bloodiness + 0.15);
    // Bajas cercanas desmoralizan.
    this.hash.consultar(u.position.x, u.position.z, 8, (o) => {
      if (o.faction === u.faction && o !== u) this.choque(o, 1.5);
    });
    const s = this.porEscuadra.get(u.squadId)!;
    if (s.leaderId === u.id) {
      this.events.push({ type: 'leaderDown', squadId: s.id });
      for (const m of this.miembros(s)) this.choque(m, 25);
    }
  }

  /** Aplica un golpe de moral atenuado por la disciplina de la clase. */
  private choque(u: UnitEntity, cantidad: number): void {
    const disciplina = CLASS_STATS[u.unitClass].discipline;
    u.morale = Math.max(0, u.morale - cantidad * (1 - disciplina / 200));
  }

  // ───────── Colisiones con masa ─────────

  private resolverColisiones(vivos: UnitEntity[]): void {
    for (const u of vivos) {
      this.hash.consultar(u.position.x, u.position.z, u.radius + 1.2, (o) => {
        if (o === u || o.id < u.id || o.state === 'dead' || o.state === 'fled') return;
        const dx = o.position.x - u.position.x;
        const dz = o.position.z - u.position.z;
        const minD = u.radius + o.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD) return;
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d, nz = dz / d;
        const solape = minD - d;
        const mt = u.mass + o.mass;
        // Separación ponderada por masa: el pesado apenas se mueve.
        u.position.x -= nx * solape * (o.mass / mt);
        u.position.z -= nz * solape * (o.mass / mt);
        o.position.x += nx * solape * (u.mass / mt);
        o.position.z += nz * solape * (u.mass / mt);
        // Velocidad relativa a lo largo de la normal (positiva = se acercan).
        const vrel = (u.velocity.x - o.velocity.x) * nx + (u.velocity.z - o.velocity.z) * nz;
        if (vrel <= 0) return;
        const mu = (u.mass * o.mass) / mt;
        if (u.faction !== o.faction && vrel > 2.5) this.impacto(u, o, vrel, mu, nx, nz);
        const j = vrel * mu * 1.1; // casi inelástico (e = 0.1)
        u.velocity.x -= (j / u.mass) * nx;
        u.velocity.z -= (j / u.mass) * nz;
        o.velocity.x += (j / o.mass) * nx;
        o.velocity.z += (j / o.mass) * nz;
      });
      // Cadáveres: obstáculos físicos blandos.
      this.hashCadaveres.consultar(u.position.x, u.position.z, 0.9, (c) => {
        const dx = u.position.x - c.position.x;
        const dz = u.position.z - c.position.z;
        const d = Math.hypot(dx, dz);
        const minD = 0.45 + u.radius * 0.5;
        if (d > 0.001 && d < minD) {
          u.position.x += (dx / d) * (minD - d) * 0.25;
          u.position.z += (dz / d) * (minD - d) * 0.25;
        }
      });
    }
  }

  /** Carga: la energía cinética ½·μ·v² se convierte en daño, derribo y pánico. */
  private impacto(u: UnitEntity, o: UnitEntity, vrel: number, mu: number, nx: number, nz: number): void {
    if (u.impactCooldown > 0 && o.impactCooldown > 0) return;
    // El atacante es el que más velocidad lleva hacia el otro.
    const vu = u.velocity.x * nx + u.velocity.z * nz;
    const vo = -(o.velocity.x * nx + o.velocity.z * nz);
    const [atacante, defensor] = vu >= vo ? [u, o] : [o, u];
    const sa = this.porEscuadra.get(atacante.squadId)!;
    const sd = this.porEscuadra.get(defensor.squadId)!;
    let energia = 0.5 * mu * vrel * vrel * FORMATIONS[sa.formation].impactDealt * FORMATIONS[sd.formation].impactTaken;
    const frontal = this.esFrontal(defensor, atacante.position);
    if (atacante.mounted && frontal) energia *= FORMATIONS[sd.formation].frontalCavalryTaken;
    if (!frontal && !FORMATIONS[sd.formation].allDirections) energia *= 1.4;
    atacante.impactCooldown = defensor.impactCooldown = 0.8;
    const dano = (energia / 110) * (1 - defensor.armor * 0.5);
    if (dano < 1) return;
    this.events.push({ type: 'impact', x: defensor.position.x, z: defensor.position.z, energy: energia });
    if (energia > 700) defensor.stun = Math.max(defensor.stun, Math.min(2.5, energia / 1500));
    this.choque(defensor, Math.min(8, energia / 400));
    this.danar(defensor, dano, atacante);
    this.danar(atacante, dano * 0.12);
  }

  private integrar(u: UnitEntity, dt: number): void {
    if (u.state === 'dead' || u.state === 'fled') return;
    const lim = this.config.fieldSize / 2;
    u.position.x = Math.max(-lim, Math.min(lim, u.position.x + u.velocity.x * dt));
    u.position.z = Math.max(-lim, Math.min(lim, u.position.z + u.velocity.z * dt));
    u.position.y = this.altura(u.position.x, u.position.z);
  }

  // ───────── Proyectiles ─────────

  private lanzarPilum(u: UnitEntity, obj: UnitEntity): boolean {
    if (u.pila <= 0) return false;
    u.pila -= 1;
    u.missileCooldown = 1.6 + this.rnd() * 0.8;
    u.attackAnim = 0.5;
    const destino = this.dispersar(obj, Math.hypot(obj.position.x - u.position.x, obj.position.z - u.position.z) * 0.04);
    const tiro = calcularTiroPorVelocidad({ x: u.position.x, y: u.position.z }, destino, 17, 1.7, GRAVITY);
    this.projectiles.push({ id: this.siguienteProyectil++, kind: 'pilum', faction: u.faction, shooterId: u.id, tiro, t: 0, damage: 48, x: u.position.x, y: 1.7, z: u.position.z });
    this.events.push({ type: 'missile', kind: 'pilum', x: u.position.x, z: u.position.z });
    return true;
  }

  private disparar(u: UnitEntity, obj: UnitEntity, m: MissileStats): void {
    u.missileCooldown = m.interval * (0.85 + this.rnd() * 0.3);
    u.attackAnim = 0.5;
    const d = Math.hypot(obj.position.x - u.position.x, obj.position.z - u.position.z);
    // Anticipación: apunta a donde estará el objetivo.
    const tVuelo = m.kind === 'stone' ? 3.5 : d / m.speed;
    const prevision = { x: obj.position.x + obj.velocity.x * tVuelo, z: obj.position.z + obj.velocity.z * tVuelo };
    const dispersion = d * (m.kind === 'stone' ? 0.035 : 0.025) * (this.config.weather === 'fog' ? 1.8 : 1);
    const ang = this.rnd() * Math.PI * 2;
    const r = this.rnd() * dispersion;
    const destino = { x: prevision.x + Math.cos(ang) * r, y: prevision.z + Math.sin(ang) * r };
    const origen = { x: u.position.x, y: u.position.z };
    const tiro = m.kind === 'stone' ? calcularTiroPorAngulo(origen, destino, 45, GRAVITY) : calcularTiroPorVelocidad(origen, destino, m.speed, 1.5, GRAVITY);
    if (m.kind === 'stone') tiro.alturaInicial = 2.5;
    this.projectiles.push({ id: this.siguienteProyectil++, kind: m.kind, faction: u.faction, shooterId: u.id, tiro, t: 0, damage: m.damage, x: u.position.x, y: 1.5, z: u.position.z });
    this.events.push({ type: 'missile', kind: m.kind, x: u.position.x, z: u.position.z });
  }

  private dispersar(obj: UnitEntity, radio: number): { x: number; y: number } {
    const a = this.rnd() * Math.PI * 2;
    const r = this.rnd() * radio;
    return { x: obj.position.x + Math.cos(a) * r, y: obj.position.z + Math.sin(a) * r };
  }

  private actualizarProyectiles(dt: number): void {
    const restantes: Projectile[] = [];
    for (const p of this.projectiles) {
      p.t += dt;
      const pos = posicionEnVuelo(p.tiro, p.t);
      p.x = pos.x;
      p.z = pos.y;
      p.y = pos.z + this.altura(pos.x, pos.y);
      if (p.t < p.tiro.duracion) {
        restantes.push(p);
        continue;
      }
      this.aterrizar(p);
    }
    this.projectiles = restantes;
  }

  private aterrizar(p: Projectile): void {
    const x = p.tiro.destino.x;
    const z = p.tiro.destino.y;
    const dirX = p.tiro.destino.x - p.tiro.origen.x;
    const dirZ = p.tiro.destino.y - p.tiro.origen.y;
    const desde = { x: x - dirX, z: z - dirZ };

    if (p.kind === 'stone') {
      // Piedra de onagro: daño en área, derribo, desmembramiento y pánico.
      let alcanzados = 0;
      this.hash.consultar(x, z, 3.2, (u) => {
        if (u.state === 'dead' || u.state === 'fled') return;
        const d = Math.hypot(u.position.x - x, u.position.z - z);
        if (d > 3.2) return;
        alcanzados++;
        const f = 1 - d / 3.2;
        const dano = p.damage * (0.35 + 0.65 * f) * (1 - u.armor * 0.3) * (u.mounted ? 0.7 : 1);
        const desm = dano >= u.hp && f > 0.4;
        u.stun = Math.max(u.stun, 1.2 * f + 0.3);
        const k = (3 * f) / (u.mass / 100);
        u.velocity.x += ((u.position.x - x) / (d || 1)) * k;
        u.velocity.z += ((u.position.z - z) / (d || 1)) * k;
        this.danar(u, dano, this.unit(p.shooterId), desm);
      });
      this.hash.consultar(x, z, 12, (u) => {
        if (u.state === 'formed' || u.state === 'engaged') this.choque(u, u.faction === p.faction ? 6 : 14);
      });
      this.events.push({ type: 'missileLand', kind: p.kind, x, z, hit: alcanzados > 0 });
      return;
    }

    const radio = p.kind === 'pilum' ? 0.75 : 0.6;
    let objetivo: UnitEntity | undefined;
    let mejor = radio;
    this.hash.consultar(x, z, radio + 1, (u) => {
      if (u.faction === p.faction || u.state === 'dead' || u.state === 'fled') return;
      const d = Math.hypot(u.position.x - x, u.position.z - z) - u.radius * 0.5;
      if (d < mejor) {
        mejor = d;
        objetivo = u;
      }
    });
    this.events.push({ type: 'missileLand', kind: p.kind, x, z, hit: !!objetivo });
    if (!objetivo) return;
    const u = objetivo as UnitEntity;
    const s = this.porEscuadra.get(u.squadId)!;
    const f = FORMATIONS[s.formation];
    const frontal = f.allDirections || s.formation === 'testudo' || this.esFrontal(u, desde);
    const bloquea = u.hasShield && frontal && u.state !== 'routing' && this.rnd() < 0.55 + f.blockBonus;
    if (bloquea) {
      if (p.kind === 'pilum') {
        // El pilum atraviesa el escudo y dobla su punta: el escudo queda inutilizado.
        if (this.rnd() < 0.65) {
          u.hasShield = false;
          this.events.push({ type: 'shieldPierced', unitId: u.id, x: u.position.x, z: u.position.z });
          this.events.push({ type: 'shieldDropped', unitId: u.id, x: u.position.x, z: u.position.z, rotation: this.rnd() * Math.PI * 2 });
          this.choque(u, 5);
        }
        if (this.rnd() < 0.15) this.danar(u, p.damage * 0.35 * (1 - u.armor), this.unit(p.shooterId));
      }
      this.events.push({ type: 'block', x: u.position.x, y: u.position.y + 1.3, z: u.position.z });
      return;
    }
    const dano = p.damage * (1 - u.armor * 0.6) * f.missileTaken * (0.85 + this.rnd() * 0.3);
    this.danar(u, dano, this.unit(p.shooterId));
    this.events.push({ type: 'hit', x: u.position.x, y: u.position.y + 1.3, z: u.position.z, damage: dano, flank: !frontal });
    this.choque(u, 2);
  }

  // ───────── Moral ─────────

  private actualizarMoral(u: UnitEntity, dt: number): void {
    if (u.state === 'dead' || u.state === 'fled') return;
    const s = this.porEscuadra.get(u.squadId)!;
    const st = CLASS_STATS[u.unitClass];
    const lider = this.unit(s.leaderId);
    const liderCerca = !!lider && lider.state !== 'dead' && lider.state !== 'fled' && lider.state !== 'routing' && Math.hypot(lider.position.x - u.position.x, lider.position.z - u.position.z) < 25;
    let delta = 0;

    let aliados = 0, enemigos = 0, caballeria = false;
    this.hash.consultar(u.position.x, u.position.z, 15, (o) => {
      if (o.state === 'dead' || o.state === 'fled' || o === u) return;
      const d = Math.hypot(o.position.x - u.position.x, o.position.z - u.position.z);
      if (o.faction === u.faction) {
        if (d < 3.5 && o.state !== 'routing') aliados++;
      } else if (o.state !== 'routing') {
        if (d < 3.5) enemigos++;
        if (o.mounted && d < 15) caballeria = true;
      }
    });

    if (u.state === 'formed' && enemigos === 0) delta += liderCerca ? 1.6 : 0.6;
    if (u.fatigue > 80) delta -= 0.6;
    const perdidas = 1 - this.miembros(s).length / s.initialSize;
    if (perdidas > 0.5) delta -= 1.2 * perdidas;
    if (this.config.starving?.[u.faction]) delta -= 0.25;
    if (caballeria && !u.mounted && s.formation !== 'testudo' && s.formation !== 'orbis' && u.state !== 'routing') delta -= 1.4;
    if (enemigos > aliados + 1) delta -= Math.min(2, 0.4 * (enemigos - aliados - 1));
    if (delta < 0 && liderCerca) delta *= 0.5;
    if (delta < 0) delta *= 1 - st.discipline / 200;

    const techo = Math.min(100, st.discipline + 20);
    u.morale = Math.max(0, Math.min(techo, u.morale + delta * dt));

    if (u.state !== 'routing' && u.morale < ROUT_THRESHOLD && u.unitClass !== 'onager') {
      u.state = 'routing';
      u.targetId = null;
      if (u.hasShield) {
        // Huye despavorido arrojando el escudo.
        u.hasShield = false;
        this.events.push({ type: 'shieldDropped', unitId: u.id, x: u.position.x, z: u.position.z, rotation: this.rnd() * Math.PI * 2 });
      }
      // Contagio del pánico.
      this.hash.consultar(u.position.x, u.position.z, 6, (o) => {
        if (o.faction === u.faction && o !== u && o.state !== 'routing') this.choque(o, 1.5);
      });
    } else if (u.state === 'routing' && liderCerca && u.morale > RALLY_THRESHOLD && !this.enemigoCerca(u, 25)) {
      u.state = 'formed';
    } else if (u.state === 'routing' && !this.enemigoCerca(u, 30)) {
      // Lejos del peligro, el miedo amaina poco a poco.
      u.morale = Math.min(techo, u.morale + (liderCerca ? 4 : 1.5) * dt);
    }
  }

  private revisarDesbandada(s: Squad): void {
    const m = this.miembros(s);
    if (!m.length) {
      s.routed = true;
      return;
    }
    const huyendo = m.filter((u) => u.state === 'routing').length / m.length;
    if (!s.routed && huyendo > 0.6) {
      s.routed = true;
      this.events.push({ type: 'rout', squadId: s.id });
    } else if (s.routed && huyendo < 0.3) {
      s.routed = false;
      this.events.push({ type: 'rally', squadId: s.id });
    }
  }

  private comprobarFin(): void {
    const roma = this.fuerza('rome').activos;
    const barbaros = this.fuerza('barbarian').activos;
    let winner: BattleResult['winner'] | null = null;
    if (roma === 0 && barbaros === 0) winner = 'draw';
    else if (roma === 0) winner = 'barbarian';
    else if (barbaros === 0) winner = 'rome';
    else if (this.time >= this.config.timeLimit) winner = 'draw';
    if (!winner) return;
    const dead: BattleResult['dead'] = { rome: {}, barbarian: {} };
    const fled: BattleResult['fled'] = { rome: 0, barbarian: 0 };
    for (const u of this.units) {
      if (u.state === 'dead') dead[u.faction][u.unitClass] = (dead[u.faction][u.unitClass] ?? 0) + 1;
      if (u.state === 'fled') fled[u.faction]++;
    }
    this.result = { winner, dead, fled, deserted: this.deserted, duration: this.time };
  }

  consumeEvents(): CombatEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
