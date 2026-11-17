/**
 * IMPERIUM: LEGIONS & GLORY — Configuración global del juego.
 *
 * Única fuente de verdad para el equilibrio: costes, tiempos, puntos de vida,
 * producción, capacidades y estadísticas de combate. Ningún otro módulo debe
 * contener números "mágicos" de equilibrio.
 */

// ───────────────────────────── Paleta "Roman Empire" ─────────────────────────────

export const PALETA = {
  marmol: '#E8E8E6',
  marmolSombra: '#BDBDB8',
  marmolOscuro: '#9A9A94',
  purpura: '#6A0DAD',
  purpuraOscuro: '#45087A',
  terracota: '#C0392B',
  terracotaOscuro: '#8E2A1F',
  oro: '#D4AF37',
  oroOscuro: '#9C7F22',
  oliva: '#556B2F',
  olivaClaro: '#6B8A3A',
  olivaOscuro: '#3D4F20',
  trigo: '#D9B85C',
  madera: '#7A5230',
  maderaOscura: '#4F341D',
  piedra: '#8C8577',
  bronce: '#8C6A3F',
  broncoOxidado: '#4F7F6A',
  cipres: '#24371A',
  antorcha: '#FFB347',
} as const;

// ───────────────────────────── Recursos ─────────────────────────────

export type Recurso = 'denarios' | 'marmol' | 'trigo' | 'favor' | 'aureos';
export type Recursos = Record<Recurso, number>;
export type Coste = Partial<Recursos>;

export const RECURSOS: readonly Recurso[] = ['denarios', 'marmol', 'trigo', 'favor', 'aureos'];

/** Recursos que se producen y almacenan (los áureos son divisa premium sin límite). */
export const RECURSOS_ALMACENABLES: readonly Exclude<Recurso, 'aureos'>[] = [
  'denarios',
  'marmol',
  'trigo',
  'favor',
];

export const INFO_RECURSO: Record<Recurso, { nombre: string; icono: string; color: string }> = {
  denarios: { nombre: 'Denarios', icono: '🪙', color: PALETA.oro },
  marmol: { nombre: 'Mármol', icono: '🏛️', color: PALETA.marmol },
  trigo: { nombre: 'Trigo', icono: '🌾', color: PALETA.trigo },
  favor: { nombre: 'Favor de los Dioses', icono: '🌿', color: '#7FB069' },
  aureos: { nombre: 'Áureos', icono: '💎', color: '#B57EDC' },
};

export function recursosVacios(): Recursos {
  return { denarios: 0, marmol: 0, trigo: 0, favor: 0, aureos: 0 };
}

// ───────────────────────────── Constantes generales ─────────────────────────────

const MIN = 60;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

export const CONFIG_GENERAL = {
  /** Tamaño del mapa en casillas (cuadrado). */
  tamanoMapa: 40,
  /** Franja exterior no edificable (bosque de cipreses). */
  margenMapa: 2,
  /** Obras simultáneas (fabri / constructores). */
  constructores: 2,
  /** Consumo de trigo por espacio de tropa y hora (mantenimiento del ejército). */
  consumoTrigoPorEspacioHora: 2,
  /** Segundos de obra que compra un áureo al acelerar. */
  segundosPorAureo: 120,
  /** Duración de un ciclo día/noche completo en segundos reales. */
  duracionDiaSeg: 300,
  /** Duración máxima de una batalla en segundos. */
  duracionBatallaSeg: 180,
  /** Recursos iniciales de un imperio nuevo. */
  recursosIniciales: { denarios: 1500, marmol: 800, trigo: 800, favor: 0, aureos: 250 } as Recursos,
} as const;

// ───────────────────────────── Senado (Ayuntamiento) ─────────────────────────────

export interface NivelSenado {
  nivel: number;
  coste: Coste;
  tiempoSeg: number;
  hp: number;
  limiteTropas: number;
  /** Capacidad de almacén propia del Senado para denarios, mármol y trigo. */
  almacen: number;
}

export const NIVELES_SENADO: readonly NivelSenado[] = [
  { nivel: 1, coste: { denarios: 1_000 }, tiempoSeg: 0, hp: 2_500, limiteTropas: 20, almacen: 2_500 },
  { nivel: 2, coste: { denarios: 5_000, marmol: 2_000 }, tiempoSeg: 2 * HORA, hp: 4_000, limiteTropas: 35, almacen: 5_000 },
  { nivel: 3, coste: { denarios: 25_000, marmol: 15_000 }, tiempoSeg: 8 * HORA, hp: 7_000, limiteTropas: 60, almacen: 7_500 },
  { nivel: 4, coste: { denarios: 100_000, marmol: 60_000 }, tiempoSeg: 24 * HORA, hp: 12_000, limiteTropas: 90, almacen: 10_000 },
  { nivel: 5, coste: { denarios: 500_000, marmol: 250_000 }, tiempoSeg: 3 * DIA, hp: 20_000, limiteTropas: 130, almacen: 12_500 },
];

// ───────────────────────────── Edificios ─────────────────────────────

export type TipoEdificio =
  | 'senado'
  | 'foro'
  | 'cantera'
  | 'latifundio'
  | 'templo'
  | 'aerarium'
  | 'lapidarium'
  | 'horreum'
  | 'castra'
  | 'torre'
  | 'balista'
  | 'muralla';

export type CategoriaEdificio = 'gobierno' | 'recursos' | 'almacen' | 'militar' | 'defensa' | 'muralla';

export interface NivelEdificio {
  nivel: number;
  coste: Coste;
  tiempoSeg: number;
  hp: number;
  /** Nivel mínimo de Senado para construir/mejorar a este nivel. */
  senadoRequerido: number;
  produccionHora?: number;
  capacidad?: number;
  dps?: number;
}

export interface DefinicionEdificio {
  tipo: TipoEdificio;
  nombre: string;
  descripcion: string;
  categoria: CategoriaEdificio;
  ancho: number;
  alto: number;
  /** Recurso que produce o almacena (si aplica). */
  recurso?: Exclude<Recurso, 'aureos'>;
  /** Número máximo de copias por nivel de Senado (índice 0 = Senado 1). */
  maxPorSenado: readonly number[];
  niveles: readonly NivelEdificio[];
  /** Estadísticas de defensa (si aplica). */
  defensa?: { rango: number; intervaloSeg: number; proyectil: TipoProyectil; velocidadProyectil: number };
  /** Altura visual del cuerpo en píxeles (para el render 2.5D). */
  alturaVisual: number;
}

export type TipoProyectil = 'flecha' | 'virote' | 'piedra';

/** Construye la tabla de niveles a partir de columnas paralelas (más legible para equilibrar). */
function columnas(c: {
  coste: Coste[];
  tiempo: number[];
  hp: number[];
  senado: number[];
  produccion?: number[];
  capacidad?: number[];
  dps?: number[];
}): NivelEdificio[] {
  return c.hp.map((hp, i) => ({
    nivel: i + 1,
    coste: c.coste[i],
    tiempoSeg: c.tiempo[i],
    hp,
    senadoRequerido: c.senado[i],
    produccionHora: c.produccion?.[i],
    capacidad: c.capacidad?.[i],
    dps: c.dps?.[i],
  }));
}

const d = (denarios: number): Coste => ({ denarios });
const m = (marmol: number): Coste => ({ marmol });

export const EDIFICIOS: Record<TipoEdificio, DefinicionEdificio> = {
  senado: {
    tipo: 'senado',
    nombre: 'Senado',
    descripcion: 'Corazón del imperio. Su nivel desbloquea edificios, mejoras y el límite de tropas.',
    categoria: 'gobierno',
    ancho: 4,
    alto: 4,
    maxPorSenado: [1, 1, 1, 1, 1],
    alturaVisual: 46,
    niveles: NIVELES_SENADO.map((n) => ({
      nivel: n.nivel,
      coste: n.coste,
      tiempoSeg: n.tiempoSeg,
      hp: n.hp,
      // Para subir el Senado al nivel N se requiere Senado N-1.
      senadoRequerido: Math.max(1, n.nivel - 1),
      capacidad: n.almacen,
    })),
  },
  foro: {
    tipo: 'foro',
    nombre: 'Foro de Tributos',
    descripcion: 'Los recaudadores cobran impuestos y llenan el Aerarium de denarios.',
    categoria: 'recursos',
    recurso: 'denarios',
    ancho: 3,
    alto: 3,
    maxPorSenado: [1, 2, 3, 4, 5],
    alturaVisual: 18,
    niveles: columnas({
      coste: [m(150), m(600), m(2_500), m(10_000), m(40_000)],
      tiempo: [10, 5 * MIN, 30 * MIN, 2 * HORA, 6 * HORA],
      hp: [400, 550, 700, 900, 1_150],
      senado: [1, 1, 2, 3, 4],
      produccion: [200, 400, 700, 1_100, 1_600],
    }),
  },
  cantera: {
    tipo: 'cantera',
    nombre: 'Cantera de Sillar',
    descripcion: 'Extrae bloques de mármol y piedra de cantería.',
    categoria: 'recursos',
    recurso: 'marmol',
    ancho: 3,
    alto: 3,
    maxPorSenado: [1, 2, 3, 3, 4],
    alturaVisual: 14,
    niveles: columnas({
      coste: [d(150), d(600), d(2_500), d(10_000), d(40_000)],
      tiempo: [10, 5 * MIN, 30 * MIN, 2 * HORA, 6 * HORA],
      hp: [400, 550, 700, 900, 1_150],
      senado: [1, 1, 2, 3, 4],
      produccion: [150, 300, 550, 900, 1_300],
    }),
  },
  latifundio: {
    tipo: 'latifundio',
    nombre: 'Latifundio',
    descripcion: 'Campos de trigo que alimentan a las legiones.',
    categoria: 'recursos',
    recurso: 'trigo',
    ancho: 3,
    alto: 3,
    maxPorSenado: [1, 2, 3, 4, 4],
    alturaVisual: 12,
    niveles: columnas({
      coste: [d(100), d(500), d(2_000), d(8_000), d(30_000)],
      tiempo: [10, 5 * MIN, 30 * MIN, 2 * HORA, 6 * HORA],
      hp: [350, 500, 650, 850, 1_100],
      senado: [1, 1, 2, 3, 4],
      produccion: [200, 400, 700, 1_100, 1_600],
    }),
  },
  templo: {
    tipo: 'templo',
    nombre: 'Templo de Júpiter',
    descripcion: 'Las ofrendas atraen el Favor de los Dioses, necesario para las bendiciones tácticas.',
    categoria: 'recursos',
    recurso: 'favor',
    ancho: 3,
    alto: 3,
    maxPorSenado: [0, 1, 1, 2, 2],
    alturaVisual: 34,
    niveles: columnas({
      coste: [
        { denarios: 2_000, marmol: 2_000 },
        { denarios: 12_000, marmol: 12_000 },
        { denarios: 60_000, marmol: 60_000 },
      ],
      tiempo: [30 * MIN, 4 * HORA, 12 * HORA],
      hp: [900, 1_300, 1_800],
      senado: [2, 3, 4],
      produccion: [20, 40, 70],
      capacidad: [500, 1_500, 4_000],
    }),
  },
  aerarium: {
    tipo: 'aerarium',
    nombre: 'Aerarium',
    descripcion: 'Tesoro público donde se custodian los denarios.',
    categoria: 'almacen',
    recurso: 'denarios',
    ancho: 3,
    alto: 3,
    maxPorSenado: [1, 1, 2, 2, 3],
    alturaVisual: 30,
    niveles: columnas({
      coste: [m(300), m(1_200), m(5_000), m(20_000), m(80_000)],
      tiempo: [15, 10 * MIN, 1 * HORA, 4 * HORA, 12 * HORA],
      hp: [700, 950, 1_250, 1_600, 2_100],
      senado: [1, 1, 2, 3, 4],
      capacidad: [5_000, 15_000, 40_000, 150_000, 400_000],
    }),
  },
  lapidarium: {
    tipo: 'lapidarium',
    nombre: 'Lapidarium',
    descripcion: 'Depósito de sillares y bloques de mármol.',
    categoria: 'almacen',
    recurso: 'marmol',
    ancho: 3,
    alto: 3,
    maxPorSenado: [1, 1, 2, 2, 3],
    alturaVisual: 22,
    niveles: columnas({
      coste: [d(300), d(1_200), d(5_000), d(20_000), d(80_000)],
      tiempo: [15, 10 * MIN, 1 * HORA, 4 * HORA, 12 * HORA],
      hp: [700, 950, 1_250, 1_600, 2_100],
      senado: [1, 1, 2, 3, 4],
      capacidad: [3_000, 10_000, 30_000, 100_000, 250_000],
    }),
  },
  horreum: {
    tipo: 'horreum',
    nombre: 'Horreum',
    descripcion: 'Granero imperial: almacena las provisiones del ejército.',
    categoria: 'almacen',
    recurso: 'trigo',
    ancho: 3,
    alto: 3,
    maxPorSenado: [1, 1, 2, 2, 3],
    alturaVisual: 26,
    niveles: columnas({
      coste: [d(250), d(1_000), d(4_000), d(15_000), d(50_000)],
      tiempo: [15, 10 * MIN, 1 * HORA, 4 * HORA, 12 * HORA],
      hp: [650, 900, 1_200, 1_550, 2_000],
      senado: [1, 1, 2, 3, 4],
      capacidad: [2_000, 6_000, 15_000, 40_000, 100_000],
    }),
  },
  castra: {
    tipo: 'castra',
    nombre: 'Castra',
    descripcion: 'Campamento militar donde se adiestran las legiones. Su nivel desbloquea unidades.',
    categoria: 'militar',
    ancho: 3,
    alto: 3,
    maxPorSenado: [1, 1, 2, 2, 3],
    alturaVisual: 20,
    niveles: columnas({
      coste: [d(200), d(4_000), d(30_000)],
      tiempo: [10, 30 * MIN, 4 * HORA],
      hp: [500, 800, 1_200],
      senado: [1, 2, 3],
    }),
  },
  torre: {
    tipo: 'torre',
    nombre: 'Turris Sagittaria',
    descripcion: 'Torre de arqueros: dispara flechas rápidas a cualquier unidad en rango.',
    categoria: 'defensa',
    ancho: 2,
    alto: 2,
    maxPorSenado: [1, 2, 3, 4, 5],
    alturaVisual: 54,
    defensa: { rango: 7, intervaloSeg: 0.8, proyectil: 'flecha', velocidadProyectil: 12 },
    niveles: columnas({
      coste: [d(500), d(2_000), d(8_000), d(30_000), d(100_000)],
      tiempo: [30, 15 * MIN, 1 * HORA, 4 * HORA, 12 * HORA],
      hp: [500, 650, 800, 1_000, 1_250],
      senado: [1, 2, 3, 4, 5],
      dps: [20, 28, 38, 50, 65],
    }),
  },
  balista: {
    tipo: 'balista',
    nombre: 'Balista',
    descripcion: 'Arma de torsión que lanza virotes pesados a largo alcance.',
    categoria: 'defensa',
    ancho: 2,
    alto: 2,
    maxPorSenado: [0, 1, 1, 2, 3],
    alturaVisual: 16,
    defensa: { rango: 9, intervaloSeg: 2.5, proyectil: 'virote', velocidadProyectil: 18 },
    niveles: columnas({
      coste: [
        { denarios: 3_000, marmol: 1_000 },
        { denarios: 15_000, marmol: 5_000 },
        { denarios: 60_000, marmol: 20_000 },
      ],
      tiempo: [10 * MIN, 2 * HORA, 8 * HORA],
      hp: [700, 900, 1_200],
      senado: [2, 3, 4],
      dps: [60, 85, 115],
    }),
  },
  muralla: {
    tipo: 'muralla',
    nombre: 'Muralla',
    descripcion: 'Lienzo de muralla de sillería. Frena el avance enemigo.',
    categoria: 'muralla',
    ancho: 1,
    alto: 1,
    maxPorSenado: [25, 50, 75, 100, 150],
    alturaVisual: 14,
    niveles: columnas({
      coste: [m(50), m(500), m(2_500), m(10_000), m(30_000)],
      tiempo: [0, 0, 0, 0, 0],
      hp: [600, 1_200, 2_400, 4_500, 8_000],
      senado: [1, 2, 3, 4, 5],
    }),
  },
};

export const TIPOS_EDIFICIO = Object.keys(EDIFICIOS) as TipoEdificio[];

// ───────────────────────────── Unidades militares ─────────────────────────────

export type TipoUnidad = 'legionario' | 'velite' | 'equites' | 'ariete' | 'onagro';

/** Preferencia de objetivo de la IA de combate. */
export type PreferenciaObjetivo = 'cualquiera' | 'almacenes' | 'murallas';

export interface DefinicionUnidad {
  tipo: TipoUnidad;
  nombre: string;
  descripcion: string;
  espacio: number;
  hp: number;
  dps: number;
  /** Alcance en casillas (cuerpo a cuerpo ≈ 0.8). */
  rango: number;
  /** Velocidad en casillas por segundo. */
  velocidad: number;
  intervaloAtaqueSeg: number;
  preferencia: PreferenciaObjetivo;
  /** Multiplicador de daño contra su objetivo preferido. */
  multiplicadorPreferido: number;
  /** Radio de daño en área en casillas (0 = objetivo único). */
  radioSplash: number;
  /** No puede atacar objetivos más cerca que esta distancia. */
  zonaMuerta: number;
  /** Proyectil que dispara (si ataca a distancia). */
  proyectil?: TipoProyectil;
  coste: Coste;
  tiempoEntrenamientoSeg: number;
  /** Nivel de Castra requerido. */
  castraRequerida: number;
  color: string;
}

export const UNIDADES: Record<TipoUnidad, DefinicionUnidad> = {
  legionario: {
    tipo: 'legionario',
    nombre: 'Legionario',
    descripcion: 'Infantería pesada. Testudo: +70% resistencia a proyectiles en formaciones de 4+.',
    espacio: 1,
    hp: 450,
    dps: 32,
    rango: 0.8,
    velocidad: 1.6,
    intervaloAtaqueSeg: 1,
    preferencia: 'cualquiera',
    multiplicadorPreferido: 1,
    radioSplash: 0,
    zonaMuerta: 0,
    coste: { trigo: 50 },
    tiempoEntrenamientoSeg: 20,
    castraRequerida: 1,
    color: PALETA.terracota,
  },
  velite: {
    tipo: 'velite',
    nombre: 'Vélite',
    descripcion: 'Arquero auxiliar. Ataque rápido a distancia (4 casillas).',
    espacio: 1,
    hp: 180,
    dps: 45,
    rango: 4,
    velocidad: 2,
    intervaloAtaqueSeg: 0.7,
    preferencia: 'cualquiera',
    multiplicadorPreferido: 1,
    radioSplash: 0,
    zonaMuerta: 0,
    proyectil: 'flecha',
    coste: { trigo: 60, denarios: 20 },
    tiempoEntrenamientoSeg: 25,
    castraRequerida: 1,
    color: '#C9B48A',
  },
  equites: {
    tipo: 'equites',
    nombre: 'Equites',
    descripcion: 'Caballería veloz. Prioriza almacenes de recursos (daño x2.5).',
    espacio: 4,
    hp: 750,
    dps: 55,
    rango: 0.9,
    velocidad: 3.5,
    intervaloAtaqueSeg: 1,
    preferencia: 'almacenes',
    multiplicadorPreferido: 2.5,
    radioSplash: 0,
    zonaMuerta: 0,
    coste: { trigo: 250, denarios: 100 },
    tiempoEntrenamientoSeg: 90,
    castraRequerida: 2,
    color: PALETA.purpura,
  },
  ariete: {
    tipo: 'ariete',
    nombre: 'Ariete Cubierto',
    descripcion: 'Testudo arietaria. Derriba murallas y puertas (daño x40).',
    espacio: 5,
    hp: 2_200,
    dps: 120,
    rango: 0.9,
    velocidad: 1,
    intervaloAtaqueSeg: 1.5,
    preferencia: 'murallas',
    multiplicadorPreferido: 40,
    radioSplash: 0,
    zonaMuerta: 0,
    coste: { trigo: 300, marmol: 200 },
    tiempoEntrenamientoSeg: 120,
    castraRequerida: 2,
    color: PALETA.madera,
  },
  onagro: {
    tipo: 'onagro',
    nombre: 'Onagro Pesado',
    descripcion: 'Catapulta de trayectoria parabólica. Daño en área (radio 2.5). Zona muerta < 3 casillas.',
    espacio: 8,
    hp: 350,
    dps: 90,
    rango: 9,
    velocidad: 0.9,
    intervaloAtaqueSeg: 3,
    preferencia: 'cualquiera',
    multiplicadorPreferido: 1,
    radioSplash: 2.5,
    zonaMuerta: 3,
    proyectil: 'piedra',
    coste: { trigo: 500, denarios: 400, marmol: 300 },
    tiempoEntrenamientoSeg: 180,
    castraRequerida: 3,
    color: PALETA.maderaOscura,
  },
};

export const TIPOS_UNIDAD = Object.keys(UNIDADES) as TipoUnidad[];

/** Bonus de formación Testudo para legionarios. */
export const TESTUDO = { minimoFormacion: 4, radio: 1.5, reduccionProyectiles: 0.7 } as const;

// ───────────────────────────── Bendiciones (Favor de los Dioses) ─────────────────────────────

export type TipoBendicion = 'marte' | 'minerva';

export interface DefinicionBendicion {
  tipo: TipoBendicion;
  nombre: string;
  descripcion: string;
  coste: Coste;
  multiplicadorDps: number;
  multiplicadorHp: number;
}

export const BENDICIONES: Record<TipoBendicion, DefinicionBendicion> = {
  marte: {
    tipo: 'marte',
    nombre: 'Furia de Marte',
    descripcion: '+25% daño a todas las tropas durante la batalla.',
    coste: { favor: 150 },
    multiplicadorDps: 1.25,
    multiplicadorHp: 1,
  },
  minerva: {
    tipo: 'minerva',
    nombre: 'Égida de Minerva',
    descripcion: '+30% vida a todas las tropas desplegadas.',
    coste: { favor: 200 },
    multiplicadorDps: 1,
    multiplicadorHp: 1.3,
  },
};

// ───────────────────────────── Botín ─────────────────────────────

export const CONFIG_BOTIN = {
  /** Porcentaje del contenido de almacenes enemigos que es saqueable. */
  porcentajeAlmacen: 0.2,
  /** Porcentaje saqueable del Senado enemigo. */
  porcentajeSenado: 0.1,
  /** Horas de producción no recolectada en los productores enemigos. */
  horasProduccionPendiente: 2,
  laurelesPorEstrella: 10,
  laurelesDerrota: -5,
} as const;
