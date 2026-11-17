/**
 * Generador procedural de provincias rivales a las que atacar.
 * Determinista a partir de una semilla (mulberry32) para poder reproducir batallas.
 */
import {
  CONFIG_BOTIN,
  CONFIG_GENERAL,
  EDIFICIOS,
  type Coste,
  type TipoEdificio,
} from '../data/gameConfig';

export interface EdificioBase {
  tipo: TipoEdificio;
  nivel: number;
  x: number;
  y: number;
  /** Recursos saqueables que contiene. */
  botin: Coste;
}

export interface BaseEnemiga {
  nombre: string;
  caudillo: string;
  nivelSenado: number;
  semilla: number;
  edificios: EdificioBase[];
}

export function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROVINCIAS = ['Gallia Comata', 'Germania Magna', 'Britannia', 'Dacia', 'Hispania Ulterior', 'Numidia', 'Parthia', 'Caledonia'];
const CAUDILLOS = ['Ambiórix', 'Arminio', 'Boudica', 'Decébalo', 'Viriato', 'Yugurta', 'Orodes', 'Calgaco'];

export function generarBaseEnemiga(nivelSenado: number, semilla: number): BaseEnemiga {
  const rnd = mulberry32(semilla);
  const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const nivel = Math.max(1, Math.min(5, nivelSenado));
  const tamano = CONFIG_GENERAL.tamanoMapa;
  const ocupado = new Uint8Array(tamano * tamano);
  const edificios: EdificioBase[] = [];

  const libre = (x: number, y: number, w: number, h: number, margen: number) => {
    for (let i = x - margen; i < x + w + margen; i++) {
      for (let j = y - margen; j < y + h + margen; j++) {
        if (i < 3 || j < 3 || i >= tamano - 3 || j >= tamano - 3) return false;
        if (ocupado[j * tamano + i]) return false;
      }
    }
    return true;
  };
  const marcar = (x: number, y: number, w: number, h: number) => {
    for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) ocupado[j * tamano + i] = 1;
  };
  const nivelPara = (tipo: TipoEdificio) => {
    // El nivel máximo de un edificio que permite este Senado, con algo de azar hacia abajo.
    const niveles = EDIFICIOS[tipo].niveles;
    let max = 0;
    for (const n of niveles) if (n.senadoRequerido <= nivel) max = n.nivel;
    return Math.max(1, max - (rnd() < 0.35 ? 1 : 0));
  };
  const colocar = (tipo: TipoEdificio, radioMin: number, radioMax: number, margen = 1): EdificioBase | null => {
    const def = EDIFICIOS[tipo];
    for (let intento = 0; intento < 300; intento++) {
      const ang = rnd() * Math.PI * 2;
      const r = radioMin + rnd() * (radioMax - radioMin);
      const x = Math.round(20 + Math.cos(ang) * r - def.ancho / 2);
      const y = Math.round(20 + Math.sin(ang) * r - def.alto / 2);
      if (!libre(x, y, def.ancho, def.alto, margen)) continue;
      marcar(x, y, def.ancho, def.alto);
      const e: EdificioBase = { tipo, nivel: nivelPara(tipo), x, y, botin: {} };
      edificios.push(e);
      return e;
    }
    return null;
  };

  // Núcleo: Senado en el centro, almacenes y defensas alrededor.
  const senado: EdificioBase = { tipo: 'senado', nivel, x: 18, y: 18, botin: {} };
  marcar(18, 18, 4, 4);
  edificios.push(senado);

  const cuantos = (tipo: TipoEdificio) => EDIFICIOS[tipo].maxPorSenado[nivel - 1];
  const nucleo: TipoEdificio[] = ['aerarium', 'lapidarium', 'horreum', 'torre', 'balista', 'templo'];
  for (const tipo of nucleo) for (let i = 0; i < cuantos(tipo); i++) colocar(tipo, 3.5, 6.5);

  // Murallas: anillo rectangular alrededor del núcleo.
  const nucleoEdificios = [...edificios];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of nucleoEdificios) {
    const def = EDIFICIOS[e.tipo];
    minX = Math.min(minX, e.x);
    minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + def.ancho - 1);
    maxY = Math.max(maxY, e.y + def.alto - 1);
  }
  minX -= 2; minY -= 2; maxX += 2; maxY += 2;
  const nivelMuralla = nivelPara('muralla');
  const casillasMuralla: [number, number][] = [];
  for (let x = minX; x <= maxX; x++) casillasMuralla.push([x, minY], [x, maxY]);
  for (let y = minY + 1; y < maxY; y++) casillasMuralla.push([minX, y], [maxX, y]);
  const maxMurallas = cuantos('muralla');
  // Si no alcanzan las murallas, se deja un hueco (puerta) aleatorio.
  const huecoInicio = entre(0, casillasMuralla.length - 1);
  const huecos = Math.max(nivel === 1 ? 3 : 0, casillasMuralla.length - maxMurallas);
  casillasMuralla.forEach(([x, y], i) => {
    const enHueco = (i - huecoInicio + casillasMuralla.length) % casillasMuralla.length < huecos;
    if (enHueco || x < 3 || y < 3 || x >= tamano - 3 || y >= tamano - 3) return;
    if (ocupado[y * tamano + x]) return;
    ocupado[y * tamano + x] = 1;
    edificios.push({ tipo: 'muralla', nivel: nivelMuralla, x, y, botin: {} });
  });

  // Anillo exterior: productores y cuarteles fuera de las murallas.
  const exterior: TipoEdificio[] = ['foro', 'cantera', 'latifundio', 'castra'];
  const radioExterior = Math.max(maxX - 20, maxY - 20, 20 - minX, 20 - minY) + 2;
  for (const tipo of exterior) for (let i = 0; i < cuantos(tipo); i++) colocar(tipo, radioExterior, radioExterior + 5);

  // Botín.
  for (const e of edificios) {
    const def = EDIFICIOS[e.tipo];
    const datos = def.niveles[e.nivel - 1];
    const lleno = 0.35 + rnd() * 0.5;
    if (def.categoria === 'almacen' && def.recurso && datos.capacidad) {
      e.botin[def.recurso] = Math.round(datos.capacidad * lleno * CONFIG_BOTIN.porcentajeAlmacen);
    } else if (def.categoria === 'recursos' && def.recurso && datos.produccionHora && e.tipo !== 'templo') {
      e.botin[def.recurso] = Math.round(datos.produccionHora * CONFIG_BOTIN.horasProduccionPendiente * lleno);
    } else if (e.tipo === 'senado' && datos.capacidad) {
      const c = Math.round(datos.capacidad * lleno * CONFIG_BOTIN.porcentajeSenado);
      e.botin = { denarios: c, marmol: c, trigo: c };
    }
  }

  const idx = Math.floor(rnd() * PROVINCIAS.length);
  return { nombre: PROVINCIAS[idx], caudillo: CAUDILLOS[idx], nivelSenado: nivel, semilla, edificios };
}
