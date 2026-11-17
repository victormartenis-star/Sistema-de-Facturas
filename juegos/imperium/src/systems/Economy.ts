/**
 * Economía en tiempo real y simulación offline.
 *
 * El estado es serializable (JSON) y todas las funciones son puras respecto al reloj:
 * reciben `ahora` en milisegundos. `simular()` avanza por tramos entre eventos
 * (fin de obras, fin de entrenamientos) para que la producción offline sea exacta aunque
 * una mejora termine a mitad de la ausencia del jugador.
 */
import {
  CONFIG_GENERAL,
  EDIFICIOS,
  NIVELES_SENADO,
  RECURSOS,
  RECURSOS_ALMACENABLES,
  UNIDADES,
  TIPOS_UNIDAD,
  recursosVacios,
  type Coste,
  type NivelEdificio,
  type Recurso,
  type Recursos,
  type TipoEdificio,
  type TipoUnidad,
} from '../data/gameConfig';

export interface EdificioInstancia {
  id: number;
  tipo: TipoEdificio;
  /** Nivel operativo actual (0 = en construcción inicial, aún no funciona). */
  nivel: number;
  x: number;
  y: number;
  /** Obra en curso: al terminar, `nivel` sube en 1. */
  obra?: { inicio: number; finEn: number };
}

export interface OrdenEntrenamiento {
  tipo: TipoUnidad;
  inicio: number;
  finEn: number;
}

export interface EstadoJuego {
  version: 1;
  nombreImperio: string;
  recursos: Recursos;
  edificios: EdificioInstancia[];
  ejercito: Record<TipoUnidad, number>;
  colaEntrenamiento: OrdenEntrenamiento[];
  ultimaActualizacion: number;
  siguienteId: number;
  laureles: number;
  batallasGanadas: number;
}

export interface ResumenSimulacion {
  producido: Recursos;
  consumido: Recursos;
  obrasTerminadas: { tipo: TipoEdificio; nivel: number }[];
  tropasEntrenadas: Partial<Record<TipoUnidad, number>>;
  milisegundos: number;
}

export type Resultado = { ok: true } | { ok: false; motivo: string };

// ───────────────────────────── Creación ─────────────────────────────

export function crearEstadoInicial(ahora: number, nombreImperio = 'Roma Aeterna'): EstadoJuego {
  const estado: EstadoJuego = {
    version: 1,
    nombreImperio,
    recursos: { ...CONFIG_GENERAL.recursosIniciales },
    edificios: [],
    ejercito: { legionario: 6, velite: 4, equites: 0, ariete: 0, onagro: 0 },
    colaEntrenamiento: [],
    ultimaActualizacion: ahora,
    siguienteId: 1,
    laureles: 0,
    batallasGanadas: 0,
  };
  const iniciales: [TipoEdificio, number, number][] = [
    ['senado', 18, 18],
    ['foro', 13, 17],
    ['cantera', 24, 14],
    ['latifundio', 13, 22],
    ['aerarium', 23, 19],
    ['lapidarium', 18, 13],
    ['horreum', 18, 23],
    ['castra', 23, 24],
    ['torre', 15, 14],
  ];
  for (const [tipo, x, y] of iniciales) {
    estado.edificios.push({ id: estado.siguienteId++, tipo, nivel: 1, x, y });
  }
  return estado;
}

// ───────────────────────────── Consultas ─────────────────────────────

export function nivelSenado(estado: EstadoJuego): number {
  return estado.edificios.find((e) => e.tipo === 'senado')?.nivel ?? 1;
}

export function datosNivel(tipo: TipoEdificio, nivel: number): NivelEdificio | undefined {
  return EDIFICIOS[tipo].niveles[nivel - 1];
}

export function contarEdificios(estado: EstadoJuego, tipo: TipoEdificio): number {
  return estado.edificios.filter((e) => e.tipo === tipo).length;
}

export function maxEdificios(estado: EstadoJuego, tipo: TipoEdificio): number {
  const tabla = EDIFICIOS[tipo].maxPorSenado;
  return tabla[Math.min(tabla.length, nivelSenado(estado)) - 1] ?? 0;
}

export function obrasEnCurso(estado: EstadoJuego): number {
  return estado.edificios.filter((e) => e.obra).length;
}

export function capacidad(estado: EstadoJuego, recurso: Recurso): number {
  if (recurso === 'aureos') return Infinity;
  let total = 0;
  for (const e of estado.edificios) {
    if (e.nivel < 1) continue;
    const def = EDIFICIOS[e.tipo];
    const n = datosNivel(e.tipo, e.nivel);
    if (!n) continue;
    if (e.tipo === 'senado' && recurso !== 'favor') total += n.capacidad ?? 0;
    else if (def.recurso === recurso && (def.categoria === 'almacen' || e.tipo === 'templo')) total += n.capacidad ?? 0;
  }
  return total;
}

export function produccionPorHora(estado: EstadoJuego, recurso: Recurso): number {
  let total = 0;
  for (const e of estado.edificios) {
    if (e.nivel < 1) continue;
    const def = EDIFICIOS[e.tipo];
    if (def.recurso !== recurso || def.categoria !== 'recursos') continue;
    total += datosNivel(e.tipo, e.nivel)?.produccionHora ?? 0;
  }
  return total;
}

export function espacioEjercito(ejercito: Record<TipoUnidad, number>): number {
  return TIPOS_UNIDAD.reduce((s, t) => s + ejercito[t] * UNIDADES[t].espacio, 0);
}

export function espacioOcupado(estado: EstadoJuego): number {
  const enCola = estado.colaEntrenamiento.reduce((s, o) => s + UNIDADES[o.tipo].espacio, 0);
  return espacioEjercito(estado.ejercito) + enCola;
}

export function limiteTropas(estado: EstadoJuego): number {
  return NIVELES_SENADO[nivelSenado(estado) - 1].limiteTropas;
}

export function consumoPorHora(estado: EstadoJuego, recurso: Recurso): number {
  if (recurso !== 'trigo') return 0;
  return espacioEjercito(estado.ejercito) * CONFIG_GENERAL.consumoTrigoPorEspacioHora;
}

export function nivelCastraMaximo(estado: EstadoJuego): number {
  return estado.edificios.filter((e) => e.tipo === 'castra').reduce((m, e) => Math.max(m, e.nivel), 0);
}

export function puedePagar(estado: EstadoJuego, coste: Coste): boolean {
  return RECURSOS.every((r) => (coste[r] ?? 0) <= estado.recursos[r]);
}

function pagar(estado: EstadoJuego, coste: Coste): void {
  for (const r of RECURSOS) estado.recursos[r] -= coste[r] ?? 0;
}

/** Añade recursos respetando la capacidad (el botín no puede desbordar los almacenes). */
export function anadirRecursos(estado: EstadoJuego, cantidad: Coste): Recursos {
  const anadido = recursosVacios();
  for (const r of RECURSOS) {
    const c = cantidad[r] ?? 0;
    if (c <= 0) continue;
    const libre = Math.max(0, capacidad(estado, r) - estado.recursos[r]);
    anadido[r] = Math.min(c, libre);
    estado.recursos[r] += anadido[r];
  }
  return anadido;
}

// ───────────────────────────── Colocación ─────────────────────────────

export function casillaOcupada(estado: EstadoJuego, x: number, y: number, ignorarId?: number): boolean {
  return estado.edificios.some((e) => {
    if (e.id === ignorarId) return false;
    const def = EDIFICIOS[e.tipo];
    return x >= e.x && x < e.x + def.ancho && y >= e.y && y < e.y + def.alto;
  });
}

export function puedeColocar(estado: EstadoJuego, tipo: TipoEdificio, x: number, y: number, ignorarId?: number): boolean {
  const def = EDIFICIOS[tipo];
  const { tamanoMapa, margenMapa } = CONFIG_GENERAL;
  if (x < margenMapa || y < margenMapa) return false;
  if (x + def.ancho > tamanoMapa - margenMapa || y + def.alto > tamanoMapa - margenMapa) return false;
  for (let i = 0; i < def.ancho; i++) {
    for (let j = 0; j < def.alto; j++) {
      if (casillaOcupada(estado, x + i, y + j, ignorarId)) return false;
    }
  }
  return true;
}

// ───────────────────────────── Acciones ─────────────────────────────

export function comprobarConstruccion(estado: EstadoJuego, tipo: TipoEdificio): Resultado {
  const n1 = datosNivel(tipo, 1)!;
  if (contarEdificios(estado, tipo) >= maxEdificios(estado, tipo)) {
    return { ok: false, motivo: `Límite alcanzado para Senado nivel ${nivelSenado(estado)}` };
  }
  if (nivelSenado(estado) < n1.senadoRequerido) return { ok: false, motivo: `Requiere Senado nivel ${n1.senadoRequerido}` };
  if (n1.tiempoSeg > 0 && obrasEnCurso(estado) >= CONFIG_GENERAL.constructores) {
    return { ok: false, motivo: 'Todos los fabri están ocupados' };
  }
  if (!puedePagar(estado, n1.coste)) return { ok: false, motivo: 'Recursos insuficientes' };
  return { ok: true };
}

export function construir(estado: EstadoJuego, tipo: TipoEdificio, x: number, y: number, ahora: number): Resultado {
  const comprobacion = comprobarConstruccion(estado, tipo);
  if (!comprobacion.ok) return comprobacion;
  if (!puedeColocar(estado, tipo, x, y)) return { ok: false, motivo: 'El terreno no está libre' };
  const n1 = datosNivel(tipo, 1)!;
  pagar(estado, n1.coste);
  const edificio: EdificioInstancia = { id: estado.siguienteId++, tipo, nivel: 0, x, y };
  if (n1.tiempoSeg > 0) edificio.obra = { inicio: ahora, finEn: ahora + n1.tiempoSeg * 1000 };
  else edificio.nivel = 1;
  estado.edificios.push(edificio);
  return { ok: true };
}

export function comprobarMejora(estado: EstadoJuego, id: number): Resultado {
  const e = estado.edificios.find((b) => b.id === id);
  if (!e) return { ok: false, motivo: 'Edificio inexistente' };
  if (e.obra) return { ok: false, motivo: 'Ya está en obras' };
  const siguiente = datosNivel(e.tipo, e.nivel + 1);
  if (!siguiente) return { ok: false, motivo: 'Nivel máximo' };
  if (nivelSenado(estado) < siguiente.senadoRequerido) {
    return { ok: false, motivo: `Requiere Senado nivel ${siguiente.senadoRequerido}` };
  }
  if (siguiente.tiempoSeg > 0 && obrasEnCurso(estado) >= CONFIG_GENERAL.constructores) {
    return { ok: false, motivo: 'Todos los fabri están ocupados' };
  }
  if (!puedePagar(estado, siguiente.coste)) return { ok: false, motivo: 'Recursos insuficientes' };
  return { ok: true };
}

export function mejorar(estado: EstadoJuego, id: number, ahora: number): Resultado {
  const comprobacion = comprobarMejora(estado, id);
  if (!comprobacion.ok) return comprobacion;
  const e = estado.edificios.find((b) => b.id === id)!;
  const siguiente = datosNivel(e.tipo, e.nivel + 1)!;
  pagar(estado, siguiente.coste);
  if (siguiente.tiempoSeg > 0) e.obra = { inicio: ahora, finEn: ahora + siguiente.tiempoSeg * 1000 };
  else e.nivel += 1;
  return { ok: true };
}

export function costeAceleracion(msRestantes: number): number {
  if (msRestantes <= 0) return 0;
  return Math.max(1, Math.ceil(msRestantes / 1000 / CONFIG_GENERAL.segundosPorAureo));
}

export function acelerarObra(estado: EstadoJuego, id: number, ahora: number): Resultado {
  const e = estado.edificios.find((b) => b.id === id);
  if (!e?.obra) return { ok: false, motivo: 'No hay obra que acelerar' };
  const coste = costeAceleracion(e.obra.finEn - ahora);
  if (estado.recursos.aureos < coste) return { ok: false, motivo: 'Áureos insuficientes' };
  simular(estado, ahora);
  estado.recursos.aureos -= coste;
  e.obra.finEn = ahora;
  simular(estado, ahora);
  return { ok: true };
}

export function moverEdificio(estado: EstadoJuego, id: number, x: number, y: number): Resultado {
  const e = estado.edificios.find((b) => b.id === id);
  if (!e) return { ok: false, motivo: 'Edificio inexistente' };
  if (!puedeColocar(estado, e.tipo, x, y, id)) return { ok: false, motivo: 'El terreno no está libre' };
  e.x = x;
  e.y = y;
  return { ok: true };
}

export function comprobarEntrenamiento(estado: EstadoJuego, tipo: TipoUnidad): Resultado {
  const def = UNIDADES[tipo];
  if (nivelCastraMaximo(estado) < def.castraRequerida) return { ok: false, motivo: `Requiere Castra nivel ${def.castraRequerida}` };
  if (espacioOcupado(estado) + def.espacio > limiteTropas(estado)) return { ok: false, motivo: 'Límite de tropas del Senado' };
  if (!puedePagar(estado, def.coste)) return { ok: false, motivo: 'Recursos insuficientes' };
  return { ok: true };
}

export function entrenar(estado: EstadoJuego, tipo: TipoUnidad, ahora: number): Resultado {
  const comprobacion = comprobarEntrenamiento(estado, tipo);
  if (!comprobacion.ok) return comprobacion;
  const def = UNIDADES[tipo];
  pagar(estado, def.coste);
  const ultimo = estado.colaEntrenamiento.at(-1);
  const inicio = Math.max(ahora, ultimo?.finEn ?? 0);
  estado.colaEntrenamiento.push({ tipo, inicio, finEn: inicio + def.tiempoEntrenamientoSeg * 1000 });
  return { ok: true };
}

// ───────────────────────────── Simulación ─────────────────────────────

/** Acumula producción/consumo durante `ms` milisegundos con el estado actual de edificios. */
function acumular(estado: EstadoJuego, ms: number, resumen: ResumenSimulacion): void {
  if (ms <= 0) return;
  const horas = ms / 3_600_000;
  for (const r of RECURSOS_ALMACENABLES) {
    const prod = produccionPorHora(estado, r) * horas;
    const cons = consumoPorHora(estado, r) * horas;
    const neto = prod - cons;
    const actual = estado.recursos[r];
    const cap = capacidad(estado, r);
    let nuevo: number;
    if (neto >= 0) nuevo = actual >= cap ? actual : Math.min(cap, actual + neto);
    else nuevo = Math.max(0, actual + neto);
    const delta = nuevo - actual;
    if (delta > 0) resumen.producido[r] += delta;
    else resumen.consumido[r] -= delta;
    estado.recursos[r] = nuevo;
  }
}

/**
 * Avanza el estado hasta `ahora`. Funciona igual para un fotograma (16 ms) que para
 * una ausencia de varios días: procesa los eventos en orden cronológico.
 */
export function simular(estado: EstadoJuego, ahora: number): ResumenSimulacion {
  const resumen: ResumenSimulacion = {
    producido: recursosVacios(),
    consumido: recursosVacios(),
    obrasTerminadas: [],
    tropasEntrenadas: {},
    milisegundos: Math.max(0, ahora - estado.ultimaActualizacion),
  };
  let t = estado.ultimaActualizacion;
  if (ahora < t) return resumen;

  for (;;) {
    let siguiente = Infinity;
    for (const e of estado.edificios) if (e.obra && e.obra.finEn <= ahora) siguiente = Math.min(siguiente, e.obra.finEn);
    const orden = estado.colaEntrenamiento[0];
    if (orden && orden.finEn <= ahora) siguiente = Math.min(siguiente, orden.finEn);
    if (!Number.isFinite(siguiente)) break;

    const instante = Math.max(t, siguiente);
    acumular(estado, instante - t, resumen);
    t = instante;

    for (const e of estado.edificios) {
      if (e.obra && e.obra.finEn <= instante) {
        e.nivel += 1;
        delete e.obra;
        resumen.obrasTerminadas.push({ tipo: e.tipo, nivel: e.nivel });
      }
    }
    while (estado.colaEntrenamiento.length && estado.colaEntrenamiento[0].finEn <= instante) {
      const o = estado.colaEntrenamiento.shift()!;
      estado.ejercito[o.tipo] += 1;
      resumen.tropasEntrenadas[o.tipo] = (resumen.tropasEntrenadas[o.tipo] ?? 0) + 1;
    }
  }
  acumular(estado, ahora - t, resumen);
  estado.ultimaActualizacion = ahora;
  return resumen;
}
