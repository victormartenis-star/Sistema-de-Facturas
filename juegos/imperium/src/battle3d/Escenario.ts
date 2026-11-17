/**
 * Convierte el ejército de la economía en un despliegue de batalla campal y genera la hueste
 * germana. Cada unidad de la economía es un grupo real de hombres:
 *  - legionario / vélite → un contubernium (8 hombres)
 *  - equites → 4 jinetes
 *  - onagro → 1 máquina con su dotación
 *  - ariete → se queda en el castrum (máquina de asedio, no de campo abierto)
 */
import type { TipoUnidad } from '../data/gameConfig';
import { HardcoreCombatEngine, type SquadSpec, type Weather } from '../engine/HardcoreCombatEngine';
import { mulberry32 } from '../systems/BaseGenerator';

export const HOMBRES_POR_UNIDAD: Record<TipoUnidad, number> = { legionario: 8, velite: 8, equites: 4, ariete: 0, onagro: 1 };
const MAX_HOMBRES_ROMA = 520;

const ORDINALES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const PROVINCIAS = [
  { nombre: 'Batalla del Limes Germánico', region: 'Germania Magna' },
  { nombre: 'Emboscada en el Bosque de Teutoburgo', region: 'Germania Inferior' },
  { nombre: 'Choque en el vado del Rin', region: 'Gallia Belgica' },
  { nombre: 'Batalla de los pantanos del Lippe', region: 'Germania Magna' },
];

export interface Despliegue {
  motor: HardcoreCombatEngine;
  nombre: string;
  region: string;
  /** Hombres que representa cada soldado si el ejército supera el máximo simulado. */
  escala: number;
  hombresRoma: number;
  hombresBarbaros: number;
}

export function crearDespliegue(
  ejercito: Record<TipoUnidad, number>,
  nivelSenado: number,
  weather: Weather,
  hambre: boolean,
  semilla: number,
): Despliegue {
  const rnd = mulberry32(semilla);
  const motor = new HardcoreCombatEngine({ weather, seed: semilla, starving: { rome: hambre }, fieldSize: 260 });

  let leg = ejercito.legionario * HOMBRES_POR_UNIDAD.legionario;
  let vel = ejercito.velite * HOMBRES_POR_UNIDAD.velite;
  let eq = ejercito.equites * HOMBRES_POR_UNIDAD.equites;
  const onagros = Math.min(4, ejercito.onagro);
  const total = leg + vel + eq;
  const escala = total > MAX_HOMBRES_ROMA ? total / MAX_HOMBRES_ROMA : 1;
  leg = Math.round(leg / escala);
  vel = Math.round(vel / escala);
  eq = Math.round(eq / escala);

  // ── Roma: centurias en línea (80 hombres por centuria, con su centurión) ──
  const centurias: number[] = [];
  for (let r = leg; r > 0; r -= 80) centurias.push(Math.min(80, r));
  const anchoCenturia = 20 * 1.3;
  const frente = centurias.length * (anchoCenturia + 4);
  centurias.forEach((n, i) => {
    motor.addSquad({
      name: `${ORDINALES[i] ?? i + 1} Centuria`,
      faction: 'rome',
      unitClass: 'legionary',
      count: n - 1,
      leader: 'centurion',
      center: { x: -frente / 2 + anchoCenturia / 2 + i * (anchoCenturia + 4), z: -45 },
      facing: 0,
      formation: 'line',
      ai: false,
    });
  });
  if (vel > 0) {
    const grupos = Math.ceil(vel / 40);
    for (let i = 0; i < grupos; i++) {
      motor.addSquad({
        name: grupos > 1 ? `Vélites ${ORDINALES[i]}` : 'Vélites',
        faction: 'rome',
        unitClass: 'velite',
        count: Math.min(40, vel - i * 40),
        center: { x: (i - (grupos - 1) / 2) * 50, z: -26 },
        facing: 0,
        formation: 'loose',
        ai: false,
      });
    }
  }
  if (eq > 0) {
    const alas = eq >= 12 ? 2 : 1;
    for (let i = 0; i < alas; i++) {
      const lado = alas === 1 ? 1 : i === 0 ? -1 : 1;
      motor.addSquad({
        name: alas > 1 ? `Ala ${lado < 0 ? 'izquierda' : 'derecha'}` : 'Turma',
        faction: 'rome',
        unitClass: 'eques',
        count: Math.round(eq / alas),
        center: { x: lado * (frente / 2 + 22), z: -48 },
        facing: 0,
        formation: 'line',
        ai: false,
      });
    }
  }
  for (let i = 0; i < onagros; i++) {
    motor.addSquad({
      name: `Onagro ${ORDINALES[i]}`,
      faction: 'rome',
      unitClass: 'onager',
      count: 1,
      center: { x: (i - (onagros - 1) / 2) * 14, z: -78 },
      facing: 0,
      formation: 'line',
      ai: true,
    });
  }

  // ── Germanos: bandas en orden abierto, arqueros detrás, jinetes en las alas ──
  const hombresRoma = leg + vel + eq;
  const factor = 1.25 + nivelSenado * 0.12 + rnd() * 0.15;
  const hombresBarbaros = Math.max(40, Math.round(hombresRoma * factor));
  const jinetes = hombresRoma >= 60 ? Math.round(hombresBarbaros * 0.12) : 0;
  const arqueros = Math.round(hombresBarbaros * 0.14);
  const guerreros = hombresBarbaros - jinetes - arqueros;
  const bandas = Math.max(1, Math.round(guerreros / 60));
  const frenteB = bandas * 34;
  const especificaciones: SquadSpec[] = [];
  for (let i = 0; i < bandas; i++) {
    especificaciones.push({
      name: `Banda ${i + 1}`,
      faction: 'barbarian',
      unitClass: 'warrior',
      count: Math.round(guerreros / bandas) - 1,
      leader: 'chieftain',
      center: { x: -frenteB / 2 + 17 + i * 34 + (rnd() - 0.5) * 6, z: 48 + (rnd() - 0.5) * 8 },
      facing: Math.PI,
      formation: 'loose',
      ai: true,
    });
  }
  if (arqueros > 0) {
    especificaciones.push({ name: 'Arqueros', faction: 'barbarian', unitClass: 'archer', count: arqueros, center: { x: 0, z: 78 }, facing: Math.PI, formation: 'loose', ai: true });
  }
  if (jinetes > 0) {
    const alas = jinetes >= 16 ? 2 : 1;
    for (let i = 0; i < alas; i++) {
      const lado = alas === 1 ? -1 : i === 0 ? -1 : 1;
      especificaciones.push({ name: 'Jinetes', faction: 'barbarian', unitClass: 'horseman', count: Math.round(jinetes / alas), center: { x: lado * (frenteB / 2 + 25), z: 55 }, facing: Math.PI, formation: 'loose', ai: true });
    }
  }
  for (const e of especificaciones) motor.addSquad(e);

  const p = PROVINCIAS[Math.floor(rnd() * PROVINCIAS.length)];
  return { motor, nombre: p.nombre, region: p.region, escala, hombresRoma, hombresBarbaros };
}
