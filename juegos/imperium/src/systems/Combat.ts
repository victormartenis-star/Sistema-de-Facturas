/**
 * Motor de combate determinista con paso fijo.
 *
 * IA de unidades:
 *  1. Elige objetivo según su preferencia (cualquiera / almacenes / murallas).
 *  2. Calcula ruta A* hasta una casilla desde la que el objetivo esté a su alcance.
 *     Las murallas son atravesables con coste alto: si la ruta óptima cruza una muralla,
 *     la unidad la ataca como obstáculo antes de continuar.
 *  3. Al destruirse cualquier edificio, todas las unidades replanifican.
 *
 * Defensas: apuntan a la unidad más cercana en rango y disparan proyectiles balísticos.
 * Legionarios en formación (4+) reciben −70% daño de proyectiles (Testudo).
 * Onagros: tiro parabólico con daño en área y zona muerta.
 */
import {
  BENDICIONES,
  CONFIG_GENERAL,
  EDIFICIOS,
  RECURSOS,
  TESTUDO,
  TIPOS_UNIDAD,
  UNIDADES,
  recursosVacios,
  type Coste,
  type Recursos,
  type TipoBendicion,
  type TipoEdificio,
  type TipoProyectil,
  type TipoUnidad,
} from '../data/gameConfig';
import { calcularTiroPorAngulo, calcularTiroPorVelocidad, posicionEnVuelo, type Tiro } from '../engine/Ballistics';
import { distancia, distanciaARectangulo, type Vector2D } from '../engine/IsoGrid';
import { buscarRuta, type RejillaCostes } from '../engine/Pathfinding';
import type { BaseEnemiga } from './BaseGenerator';

export interface EdificioCombate {
  id: number;
  tipo: TipoEdificio;
  nivel: number;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  hpMax: number;
  destruido: boolean;
  esMuralla: boolean;
  esAlmacen: boolean;
  esDefensa: boolean;
  botinTotal: Coste;
  cooldown: number;
  objetivoId: number | null;
}

export interface UnidadCombate {
  id: number;
  tipo: TipoUnidad;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  objetivoId: number | null;
  obstaculoId: number | null;
  ruta: Vector2D[];
  cooldown: number;
  replanificar: boolean;
  /** Ángulo de orientación (para el render). */
  orientacion: number;
  atacando: boolean;
  enTestudo: boolean;
}

export interface ProyectilCombate {
  id: number;
  tipo: TipoProyectil;
  bando: 'atacante' | 'defensor';
  tiro: Tiro;
  t: number;
  dano: number;
  radioSplash: number;
  objetivoId: number;
  /** El proyectil persigue al objetivo (flechas de defensa contra unidades móviles). */
  guiado: boolean;
}

export type EventoCombate =
  | { tipo: 'disparo'; proyectil: TipoProyectil; x: number; y: number }
  | { tipo: 'impacto'; proyectil: TipoProyectil; x: number; y: number; radio: number }
  | { tipo: 'golpe'; x: number; y: number }
  | { tipo: 'destruido'; x: number; y: number; edificio: TipoEdificio }
  | { tipo: 'baja'; x: number; y: number; unidad: TipoUnidad }
  | { tipo: 'despliegue'; x: number; y: number; unidad: TipoUnidad };

export interface ResultadoBatalla {
  estrellas: number;
  destruccion: number;
  botin: Recursos;
  motivo: 'victoria_total' | 'tiempo' | 'sin_tropas' | 'retirada';
  supervivientes: Record<TipoUnidad, number>;
}

const COSTE_MURALLA = 8;
const ANGULO_ONAGRO = 50;

export class Batalla {
  readonly tamano = CONFIG_GENERAL.tamanoMapa;
  readonly base: BaseEnemiga;
  readonly edificios: EdificioCombate[] = [];
  unidades: UnidadCombate[] = [];
  proyectiles: ProyectilCombate[] = [];
  readonly reserva: Record<TipoUnidad, number>;
  readonly botin: Recursos = recursosVacios();
  readonly bendiciones = new Set<TipoBendicion>();
  eventos: EventoCombate[] = [];
  tiempo = 0;
  readonly limite = CONFIG_GENERAL.duracionBatallaSeg;
  resultado: ResultadoBatalla | null = null;

  private siguienteId = 1;
  /** id del edificio en cada casilla (0 = libre). */
  private readonly mapa: Int32Array;
  private readonly zonaProhibida: Uint8Array;
  private readonly porId = new Map<number, EdificioCombate>();
  private desplegadas = 0;

  constructor(base: BaseEnemiga, ejercito: Record<TipoUnidad, number>) {
    this.base = base;
    this.reserva = { ...ejercito };
    this.mapa = new Int32Array(this.tamano * this.tamano);
    this.zonaProhibida = new Uint8Array(this.tamano * this.tamano);
    for (const b of base.edificios) {
      const def = EDIFICIOS[b.tipo];
      const hp = def.niveles[b.nivel - 1].hp;
      const e: EdificioCombate = {
        id: this.siguienteId++,
        tipo: b.tipo,
        nivel: b.nivel,
        x: b.x,
        y: b.y,
        w: def.ancho,
        h: def.alto,
        hp,
        hpMax: hp,
        destruido: false,
        esMuralla: def.categoria === 'muralla',
        esAlmacen: def.categoria === 'almacen',
        esDefensa: def.categoria === 'defensa',
        botinTotal: { ...b.botin },
        cooldown: 0,
        objetivoId: null,
      };
      this.edificios.push(e);
      this.porId.set(e.id, e);
      for (let i = 0; i < e.w; i++) for (let j = 0; j < e.h; j++) this.mapa[(e.y + j) * this.tamano + e.x + i] = e.id;
      // Zona de despliegue prohibida: la huella + 1 casilla alrededor.
      for (let i = e.x - 1; i <= e.x + e.w; i++) {
        for (let j = e.y - 1; j <= e.y + e.h; j++) {
          if (i >= 0 && j >= 0 && i < this.tamano && j < this.tamano) this.zonaProhibida[j * this.tamano + i] = 1;
        }
      }
    }
  }

  // ───────────────────────── Consultas ─────────────────────────

  edificio(id: number | null): EdificioCombate | undefined {
    return id == null ? undefined : this.porId.get(id);
  }

  get destruccion(): number {
    const validos = this.edificios.filter((e) => !e.esMuralla);
    if (!validos.length) return 100;
    return Math.round((validos.filter((e) => e.destruido).length / validos.length) * 100);
  }

  get estrellas(): number {
    const senado = this.edificios.find((e) => e.tipo === 'senado');
    const pct = this.destruccion;
    return (pct >= 50 ? 1 : 0) + (senado?.destruido ? 1 : 0) + (pct >= 100 ? 1 : 0);
  }

  get empezada(): boolean {
    return this.desplegadas > 0;
  }

  get tiempoRestante(): number {
    return Math.max(0, this.limite - this.tiempo);
  }

  get modDps(): number {
    let m = 1;
    for (const b of this.bendiciones) m *= BENDICIONES[b].multiplicadorDps;
    return m;
  }

  get modHp(): number {
    let m = 1;
    for (const b of this.bendiciones) m *= BENDICIONES[b].multiplicadorHp;
    return m;
  }

  puedeDesplegar(x: number, y: number): boolean {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.tamano || cy >= this.tamano) return false;
    return this.zonaProhibida[cy * this.tamano + cx] === 0;
  }

  esZonaProhibida(cx: number, cy: number): boolean {
    return this.zonaProhibida[cy * this.tamano + cx] === 1;
  }

  // ───────────────────────── Acciones ─────────────────────────

  desplegar(tipo: TipoUnidad, x: number, y: number): boolean {
    if (this.resultado || this.reserva[tipo] <= 0 || !this.puedeDesplegar(x, y)) return false;
    this.reserva[tipo] -= 1;
    this.desplegadas++;
    const def = UNIDADES[tipo];
    const hp = def.hp * this.modHp;
    this.unidades.push({
      id: this.siguienteId++,
      tipo,
      x,
      y,
      hp,
      hpMax: hp,
      objetivoId: null,
      obstaculoId: null,
      ruta: [],
      cooldown: 0.3,
      replanificar: true,
      orientacion: 0,
      atacando: false,
      enTestudo: false,
    });
    this.eventos.push({ tipo: 'despliegue', x, y, unidad: tipo });
    return true;
  }

  /** Activa una bendición (el pago lo valida quien llama). Solo antes del primer despliegue. */
  activarBendicion(tipo: TipoBendicion): boolean {
    if (this.bendiciones.has(tipo) || this.desplegadas > 0) return false;
    this.bendiciones.add(tipo);
    return true;
  }

  retirarse(): void {
    if (!this.resultado) this.finalizar('retirada');
  }

  // ───────────────────────── Bucle ─────────────────────────

  actualizar(dt: number): void {
    // El reloj no corre durante la fase de exploración (antes del primer despliegue).
    if (this.resultado || this.desplegadas === 0) return;
    this.tiempo += dt;
    this.actualizarTestudo();
    for (const u of this.unidades) this.actualizarUnidad(u, dt);
    for (const e of this.edificios) if (e.esDefensa && !e.destruido) this.actualizarDefensa(e, dt);
    this.actualizarProyectiles(dt);

    const muertas = this.unidades.filter((u) => u.hp <= 0);
    for (const u of muertas) this.eventos.push({ tipo: 'baja', x: u.x, y: u.y, unidad: u.tipo });
    if (muertas.length) this.unidades = this.unidades.filter((u) => u.hp > 0);

    const sinReserva = TIPOS_UNIDAD.every((t) => this.reserva[t] === 0);
    const proyectilesAtacantes = this.proyectiles.some((p) => p.bando === 'atacante');
    if (this.destruccion >= 100) this.finalizar('victoria_total');
    else if (this.tiempo >= this.limite) this.finalizar('tiempo');
    else if (sinReserva && this.unidades.length === 0 && !proyectilesAtacantes) this.finalizar('sin_tropas');
  }

  private finalizar(motivo: ResultadoBatalla['motivo']): void {
    const supervivientes = { ...this.reserva };
    for (const u of this.unidades) supervivientes[u.tipo] += 1;
    this.resultado = {
      estrellas: this.estrellas,
      destruccion: this.destruccion,
      botin: { ...this.botin },
      motivo,
      supervivientes,
    };
  }

  private actualizarTestudo(): void {
    const legionarios = this.unidades.filter((u) => u.tipo === 'legionario');
    for (const u of legionarios) {
      let cerca = 0;
      for (const o of legionarios) if (o !== u && distancia(u, o) <= TESTUDO.radio) cerca++;
      u.enTestudo = cerca + 1 >= TESTUDO.minimoFormacion;
    }
  }

  // ───────────────────────── IA de unidades ─────────────────────────

  private elegirObjetivo(u: UnidadCombate): EdificioCombate | undefined {
    const def = UNIDADES[u.tipo];
    const vivos = this.edificios.filter((e) => !e.destruido);
    let candidatos = vivos.filter((e) => !e.esMuralla);
    if (def.preferencia === 'almacenes') {
      const almacenes = vivos.filter((e) => e.esAlmacen);
      if (almacenes.length) candidatos = almacenes;
    } else if (def.preferencia === 'murallas') {
      const murallas = vivos.filter((e) => e.esMuralla);
      if (murallas.length) candidatos = murallas;
    }
    if (def.zonaMuerta > 0) {
      const fuera = candidatos.filter((e) => distanciaARectangulo(u, e.x, e.y, e.w, e.h) >= def.zonaMuerta);
      if (fuera.length) candidatos = fuera;
    }
    let mejor: EdificioCombate | undefined;
    let mejorD = Infinity;
    for (const e of candidatos) {
      const dd = distanciaARectangulo(u, e.x, e.y, e.w, e.h);
      if (dd < mejorD) {
        mejorD = dd;
        mejor = e;
      }
    }
    return mejor;
  }

  private rejilla(): RejillaCostes {
    return {
      ancho: this.tamano,
      alto: this.tamano,
      coste: (x, y) => {
        const id = this.mapa[y * this.tamano + x];
        if (!id) return 1;
        const e = this.porId.get(id)!;
        if (e.destruido) return 1;
        return e.esMuralla ? COSTE_MURALLA : Infinity;
      },
    };
  }

  private planificar(u: UnidadCombate): void {
    u.replanificar = false;
    u.obstaculoId = null;
    const objetivo = this.elegirObjetivo(u);
    u.objetivoId = objetivo?.id ?? null;
    u.ruta = [];
    if (!objetivo) return;
    const def = UNIDADES[u.tipo];
    const enAlcance = (cx: number, cy: number) => {
      const dd = distanciaARectangulo({ x: cx + 0.5, y: cy + 0.5 }, objetivo.x, objetivo.y, objetivo.w, objetivo.h);
      return dd <= def.rango && dd >= def.zonaMuerta;
    };
    const rejilla = this.rejilla();
    const ruta = buscarRuta(rejilla, u, {
      esMeta: (x, y) => {
        if (!enAlcance(x, y)) return false;
        // La casilla meta debe ser pisable (salvo que sea el propio objetivo).
        const id = this.mapa[y * this.tamano + x];
        return !id || id === objetivo.id || this.porId.get(id)!.destruido;
      },
      heuristica: (x, y) =>
        Math.max(0, distanciaARectangulo({ x: x + 0.5, y: y + 0.5 }, objetivo.x, objetivo.y, objetivo.w, objetivo.h) - def.rango),
    });
    u.ruta = ruta ?? [];
  }

  private enAlcance(u: UnidadCombate, e: EdificioCombate): boolean {
    const def = UNIDADES[u.tipo];
    const dd = distanciaARectangulo(u, e.x, e.y, e.w, e.h);
    return dd <= def.rango + 0.05 && dd >= def.zonaMuerta - 0.05;
  }

  private actualizarUnidad(u: UnidadCombate, dt: number): void {
    const def = UNIDADES[u.tipo];
    u.cooldown = Math.max(0, u.cooldown - dt);
    let objetivo = this.edificio(u.objetivoId);
    if (u.replanificar || !objetivo || objetivo.destruido) {
      this.planificar(u);
      objetivo = this.edificio(u.objetivoId);
    }
    if (!objetivo) {
      u.atacando = false;
      return;
    }

    // ¿Una muralla bloquea el camino?
    const obstaculo = this.edificio(u.obstaculoId);
    if (obstaculo && !obstaculo.destruido) {
      if (this.enAlcance(u, obstaculo) || distanciaARectangulo(u, obstaculo.x, obstaculo.y, 1, 1) <= 1) {
        this.atacar(u, obstaculo);
        return;
      }
    } else if (u.obstaculoId) {
      u.obstaculoId = null;
    }

    if (this.enAlcance(u, objetivo)) {
      this.atacar(u, objetivo);
      return;
    }
    u.atacando = false;

    // Onagro demasiado cerca: retrocede para salir de la zona muerta.
    if (def.zonaMuerta > 0 && distanciaARectangulo(u, objetivo.x, objetivo.y, objetivo.w, objetivo.h) < def.zonaMuerta) {
      const cx = objetivo.x + objetivo.w / 2;
      const cy = objetivo.y + objetivo.h / 2;
      this.moverHacia(u, { x: u.x + (u.x - cx), y: u.y + (u.y - cy) }, dt);
      return;
    }

    const siguiente = u.ruta[0];
    if (!siguiente) {
      // Sin ruta (bloqueado): avance directo.
      this.moverHacia(u, { x: objetivo.x + objetivo.w / 2, y: objetivo.y + objetivo.h / 2 }, dt);
      return;
    }
    const idCasilla = this.mapa[siguiente.y * this.tamano + siguiente.x];
    const enCasilla = idCasilla ? this.porId.get(idCasilla) : undefined;
    if (enCasilla && !enCasilla.destruido && enCasilla.esMuralla && enCasilla.id !== objetivo.id) {
      u.obstaculoId = enCasilla.id;
      this.atacar(u, enCasilla);
      return;
    }
    const destino = { x: siguiente.x + 0.5, y: siguiente.y + 0.5 };
    if (this.moverHacia(u, destino, dt)) u.ruta.shift();
  }

  /** Mueve la unidad; devuelve true si llegó al destino. */
  private moverHacia(u: UnidadCombate, destino: Vector2D, dt: number): boolean {
    const dx = destino.x - u.x;
    const dy = destino.y - u.y;
    const dd = Math.hypot(dx, dy);
    const paso = UNIDADES[u.tipo].velocidad * dt;
    if (dd > 1e-6) u.orientacion = Math.atan2(dy, dx);
    if (dd <= paso) {
      u.x = destino.x;
      u.y = destino.y;
      return true;
    }
    u.x = Math.min(this.tamano - 0.01, Math.max(0, u.x + (dx / dd) * paso));
    u.y = Math.min(this.tamano - 0.01, Math.max(0, u.y + (dy / dd) * paso));
    return false;
  }

  private multiplicador(u: UnidadCombate, e: EdificioCombate): number {
    const def = UNIDADES[u.tipo];
    if (def.preferencia === 'almacenes' && e.esAlmacen) return def.multiplicadorPreferido;
    if (def.preferencia === 'murallas' && e.esMuralla) return def.multiplicadorPreferido;
    return 1;
  }

  private atacar(u: UnidadCombate, e: EdificioCombate): void {
    u.atacando = true;
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    u.orientacion = Math.atan2(cy - u.y, cx - u.x);
    if (u.cooldown > 0) return;
    const def = UNIDADES[u.tipo];
    u.cooldown = def.intervaloAtaqueSeg;
    const dano = def.dps * def.intervaloAtaqueSeg * this.modDps * this.multiplicador(u, e);

    if (!def.proyectil) {
      this.danarEdificio(e, dano);
      this.eventos.push({ tipo: 'golpe', x: cx, y: cy });
      return;
    }
    // Punto de impacto: el punto del edificio más cercano al tirador (o su centro para el onagro).
    const destino =
      def.radioSplash > 0
        ? { x: cx, y: cy }
        : { x: Math.min(e.x + e.w, Math.max(e.x, u.x)), y: Math.min(e.y + e.h, Math.max(e.y, u.y)) };
    const tiro =
      def.proyectil === 'piedra'
        ? calcularTiroPorAngulo({ x: u.x, y: u.y }, destino, ANGULO_ONAGRO)
        : calcularTiroPorVelocidad({ x: u.x, y: u.y }, destino, 10, 0.4);
    this.proyectiles.push({
      id: this.siguienteId++,
      tipo: def.proyectil,
      bando: 'atacante',
      tiro,
      t: 0,
      dano,
      radioSplash: def.radioSplash,
      objetivoId: e.id,
      guiado: false,
    });
    this.eventos.push({ tipo: 'disparo', proyectil: def.proyectil, x: u.x, y: u.y });
  }

  // ───────────────────────── Defensas ─────────────────────────

  private actualizarDefensa(e: EdificioCombate, dt: number): void {
    const def = EDIFICIOS[e.tipo];
    if (!def.defensa) return;
    e.cooldown = Math.max(0, e.cooldown - dt);
    const centro = { x: e.x + e.w / 2, y: e.y + e.h / 2 };
    let objetivo = this.unidades.find((u) => u.id === e.objetivoId && u.hp > 0);
    if (!objetivo || distancia(centro, objetivo) > def.defensa.rango) {
      objetivo = undefined;
      let mejor = Infinity;
      for (const u of this.unidades) {
        const dd = distancia(centro, u);
        if (u.hp > 0 && dd <= def.defensa.rango && dd < mejor) {
          mejor = dd;
          objetivo = u;
        }
      }
      e.objetivoId = objetivo?.id ?? null;
    }
    if (!objetivo || e.cooldown > 0) return;
    e.cooldown = def.defensa.intervaloSeg;
    const dps = def.niveles[e.nivel - 1].dps ?? 0;
    const alturaSalida = def.alturaVisual / 32;
    this.proyectiles.push({
      id: this.siguienteId++,
      tipo: def.defensa.proyectil,
      bando: 'defensor',
      tiro: calcularTiroPorVelocidad(centro, { x: objetivo.x, y: objetivo.y }, def.defensa.velocidadProyectil, alturaSalida),
      t: 0,
      dano: dps * def.defensa.intervaloSeg,
      radioSplash: 0,
      objetivoId: objetivo.id,
      guiado: true,
    });
    this.eventos.push({ tipo: 'disparo', proyectil: def.defensa.proyectil, x: centro.x, y: centro.y });
  }

  // ───────────────────────── Proyectiles y daño ─────────────────────────

  private actualizarProyectiles(dt: number): void {
    const restantes: ProyectilCombate[] = [];
    for (const p of this.proyectiles) {
      p.t += dt;
      if (p.guiado) {
        const u = this.unidades.find((x) => x.id === p.objetivoId);
        if (u && u.hp > 0) p.tiro.destino = { x: u.x, y: u.y };
      }
      if (p.t < p.tiro.duracion) {
        restantes.push(p);
        continue;
      }
      const impacto = posicionEnVuelo(p.tiro, p.tiro.duracion);
      this.eventos.push({ tipo: 'impacto', proyectil: p.tipo, x: impacto.x, y: impacto.y, radio: p.radioSplash });
      if (p.bando === 'defensor') {
        const u = this.unidades.find((x) => x.id === p.objetivoId);
        if (u && u.hp > 0) u.hp -= u.enTestudo ? p.dano * (1 - TESTUDO.reduccionProyectiles) : p.dano;
      } else if (p.radioSplash > 0) {
        for (const e of this.edificios) {
          if (!e.destruido && distanciaARectangulo(impacto, e.x, e.y, e.w, e.h) <= p.radioSplash) this.danarEdificio(e, p.dano);
        }
      } else {
        const e = this.edificio(p.objetivoId);
        if (e && !e.destruido) this.danarEdificio(e, p.dano);
      }
    }
    this.proyectiles = restantes;
  }

  private danarEdificio(e: EdificioCombate, dano: number): void {
    if (e.destruido) return;
    const real = Math.min(dano, e.hp);
    e.hp -= real;
    // Botín proporcional al daño infligido.
    for (const r of RECURSOS) {
      const total = e.botinTotal[r] ?? 0;
      if (total > 0) this.botin[r] += (total * real) / e.hpMax;
    }
    if (e.hp <= 1e-6) {
      e.hp = 0;
      e.destruido = true;
      for (const r of RECURSOS) this.botin[r] = Math.round(this.botin[r] * 1000) / 1000;
      this.eventos.push({ tipo: 'destruido', x: e.x + e.w / 2, y: e.y + e.h / 2, edificio: e.tipo });
      for (const u of this.unidades) u.replanificar = true;
    }
  }

  /** Recoge y vacía la cola de eventos (para audio y partículas). */
  consumirEventos(): EventoCombate[] {
    const ev = this.eventos;
    this.eventos = [];
    return ev;
  }
}

/** Botín redondeado hacia abajo, listo para sumar a la economía. */
export function botinEntero(botin: Recursos): Coste {
  const r: Coste = {};
  for (const k of RECURSOS) if (botin[k] >= 1) r[k] = Math.floor(botin[k]);
  return r;
}
