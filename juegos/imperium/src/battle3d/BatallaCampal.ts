/**
 * Controlador de la batalla campal 3D: sesión informativa previa, bucle de simulación a paso
 * fijo con interpolación, mando de centurias (formaciones y órdenes), registro y resultado.
 */
import './batalla3d.css';
import {
  FORMATIONS,
  WEATHER,
  type BattleResult,
  type FormationType,
  type HardcoreCombatEngine,
  type Projectile,
  type Squad,
  type SquadOrder,
  type UnitClass,
  type Weather,
} from '../engine/HardcoreCombatEngine';
import type { TipoUnidad } from '../data/gameConfig';
import { crearDespliegue, HOMBRES_POR_UNIDAD, type Despliegue } from './Escenario';
import { Escena3D } from './Escena3D';

const PASO = 1 / 20;

export interface ResultadoCampal {
  resultado: BattleResult;
  /** Unidades de la economía perdidas (contubernia, turmae, máquinas). */
  perdidas: Partial<Record<TipoUnidad, number>>;
  hombresPerdidos: number;
  enemigosCaidos: number;
  abandonada: boolean;
}

export interface OpcionesCampal {
  ejercito: Record<TipoUnidad, number>;
  nivelSenado: number;
  hambre: boolean;
  onFin: (r: ResultadoCampal) => void;
  onSonido?: (tipo: 'golpe' | 'impacto' | 'piedra' | 'flecha' | 'fanfarria' | 'derrota') => void;
}

const CLASE_A_ECONOMIA: Partial<Record<UnitClass, TipoUnidad>> = {
  legionary: 'legionario',
  centurion: 'legionario',
  velite: 'velite',
  eques: 'equites',
  onager: 'onagro',
};

const ETIQUETA_ORDEN: Record<SquadOrder, string> = {
  hold: 'Mantener',
  advance: 'Avanzar',
  charge: '¡Carga!',
  move: 'En marcha',
  retreat: 'Retirada',
};

export class BatallaCampal {
  private readonly raiz: HTMLElement;
  private escena: Escena3D | null = null;
  private despliegue: Despliegue | null = null;
  private motor: HardcoreCombatEngine | null = null;
  private seleccion: Squad | null = null;
  private velocidad = 1;
  private acumulador = 0;
  private ultimo = performance.now();
  private ultimoHud = 0;
  private activo = true;
  private terminado = false;
  private registro: { t: number; texto: string; tipo: string }[] = [];
  private pulsado: { x: number; y: number } | null = null;
  /** Mientras se pulsa un botón del HUD no se regenera su HTML (si no, el clic se pierde). */
  private hudPulsado = false;
  private readonly cacheHtml = new WeakMap<Element, string>();
  private readonly alRedimensionar = () => this.escena?.redimensionar();
  private readonly alTeclear = (e: KeyboardEvent) => this.teclado(e);

  constructor(contenedor: HTMLElement, private readonly opciones: OpcionesCampal) {
    this.raiz = document.createElement('div');
    this.raiz.className = 'campal';
    contenedor.appendChild(this.raiz);
    this.mostrarBriefing();
  }

  // ───────────────────────── Sesión informativa ─────────────────────────

  private mostrarBriefing(): void {
    const ej = this.opciones.ejercito;
    const hombres = (['legionario', 'velite', 'equites', 'onagro'] as TipoUnidad[])
      .filter((t) => ej[t] > 0)
      .map((t) => `<li><b>${ej[t] * HOMBRES_POR_UNIDAD[t]}</b> ${{ legionario: 'legionarios', velite: 'vélites', equites: 'equites', onagro: 'onagros', ariete: '' }[t]}</li>`)
      .join('');
    const climas = (Object.keys(WEATHER) as Weather[])
      .map((w, i) => `<label class="opcion-clima"><input type="radio" name="clima" id="clima-${w}" value="${w}" ${i === 0 ? 'checked' : ''}><span><b>${WEATHER[w].label}</b><small>${this.descripcionClima(w)}</small></span></label>`)
      .join('');
    this.raiz.innerHTML = `
      <div class="briefing">
        <div class="briefing-caja">
          <p class="sello">Legio XIX · Limes Germanicus</p>
          <h1>Orden de batalla</h1>
          <p class="cronica">Exploradores informan de una hueste germana cruzando el bosque. Formad las centurias delante del castrum.</p>
          <div class="briefing-columnas">
            <section>
              <h2>Tus fuerzas</h2>
              <ul>${hombres || '<li>Sin tropas</li>'}</ul>
              ${ej.ariete ? '<p class="nota">Los arietes quedan en el castrum: son máquinas de asedio.</p>' : ''}
              <p class="${this.opciones.hambre ? 'alerta' : 'nota'}">${this.opciones.hambre ? 'Líneas de suministro cortadas: el Horreum está vacío. Habrá deserciones y la moral empieza baja.' : 'Suministro de trigo asegurado.'}</p>
            </section>
            <section>
              <h2>Condiciones</h2>
              <div class="climas">${climas}</div>
            </section>
          </div>
          <div class="briefing-botones">
            <button class="boton-hierro" data-accion="volver">Volver al castrum</button>
            <button class="boton-hierro boton-sangre" data-accion="empezar">Formar las líneas</button>
          </div>
        </div>
      </div>`;
    this.raiz.querySelector('[data-accion="volver"]')!.addEventListener('click', () => this.cerrar(null));
    this.raiz.querySelector('[data-accion="empezar"]')!.addEventListener('click', () => {
      const w = (this.raiz.querySelector('input[name="clima"]:checked') as HTMLInputElement).value as Weather;
      this.empezar(w);
    });
  }

  private descripcionClima(w: Weather): string {
    return {
      clear: 'Sol frío del norte. Alcance de proyectiles completo.',
      rain: 'Barro denso: caballería −40% velocidad, más fatiga, surcos profundos.',
      fog: 'Visibilidad mínima: proyectiles a la mitad de alcance y menos precisos.',
      dusk: 'Luz rasante y polvo. Alcance reducido.',
    }[w];
  }

  // ───────────────────────── Batalla ─────────────────────────

  private empezar(clima: Weather): void {
    this.raiz.innerHTML = '';
    this.despliegue = crearDespliegue(this.opciones.ejercito, this.opciones.nivelSenado, clima, this.opciones.hambre, (Math.random() * 2 ** 31) | 0);
    this.motor = this.despliegue.motor;
    const escena = new Escena3D(this.raiz, this.motor, clima);
    this.escena = escena;
    // El terreno deformable alimenta al motor: altura y barro.
    this.motor.config.heightAt = (x, z) => escena.terreno.alturaEn(x, z);
    this.motor.config.groundSpeedAt = (x, z) => escena.terreno.velocidadSuelo(x, z);
    for (const u of this.motor.units) u.position.y = escena.terreno.alturaEn(u.position.x, u.position.z);

    const hud = document.createElement('div');
    hud.className = 'campal-hud';
    hud.innerHTML = `
      <header class="campal-barra" id="c-cabecera"></header>
      <aside class="campal-lista" id="c-lista"></aside>
      <div class="campal-registro" id="c-registro"></div>
      <footer class="campal-mando" id="c-mando"></footer>
      <div class="campal-velocidad">
        <button data-vel="0" title="Pausa (espacio)">❚❚</button><button data-vel="1" class="activo">×1</button><button data-vel="2">×2</button><button data-vel="4">×4</button>
        <button data-accion="abandonar" class="abandonar">Abandonar</button>
      </div>
      <p class="campal-ayuda">Clic: seleccionar centuria · Clic en el terreno: marchar · Clic sobre el enemigo: cargar · Arrastrar: girar · Clic derecho: desplazar · Rueda: zoom</p>`;
    this.raiz.appendChild(hud);
    hud.addEventListener('click', (e) => this.clicHud(e));
    hud.addEventListener('pointerdown', () => (this.hudPulsado = true));
    window.addEventListener('pointerup', () => (this.hudPulsado = false));
    if (this.motor.deserted > 0) this.log(`${this.motor.deserted} hombres han desertado por hambre`, 'malo');

    const lienzo = escena.renderer.domElement;
    lienzo.addEventListener('pointerdown', (e) => (this.pulsado = { x: e.clientX, y: e.clientY }));
    lienzo.addEventListener('pointerup', (e) => {
      if (this.pulsado && Math.hypot(e.clientX - this.pulsado.x, e.clientY - this.pulsado.y) < 6 && e.button === 0) this.clicCampo(e.clientX, e.clientY);
      this.pulsado = null;
    });
    window.addEventListener('resize', this.alRedimensionar);
    window.addEventListener('keydown', this.alTeclear);
    this.seleccion = this.motor.squads.find((s) => s.faction === 'rome' && !s.ai) ?? null;
    if (import.meta.env.DEV) {
      // Enganche de depuración: adelantar la simulación desde la consola o los tests de navegador.
      (window as unknown as { __campal: unknown }).__campal = {
        motor: this.motor,
        escena: this.escena,
        avanzar: (seg: number) => {
          for (let k = 0; k < seg / PASO; k++) {
            const antes = new Map<number, Projectile>(this.motor!.projectiles.map((p) => [p.id, p]));
            this.escena!.antesDePaso();
            this.motor!.step(PASO);
            const ev = this.motor!.consumeEvents();
            this.escena!.procesarEventos(ev, antes);
            this.narrar(ev);
          }
        },
      };
    }
    this.log('Las legiones forman frente al castrum', 'info');
    this.ultimo = performance.now();
    requestAnimationFrame((t) => this.bucle(t));
  }

  private bucle(t: number): void {
    if (!this.activo || !this.motor || !this.escena) return;
    const dt = Math.min(0.1, (t - this.ultimo) / 1000);
    this.ultimo = t;
    this.acumulador += dt * this.velocidad;
    let pasos = 0;
    while (this.acumulador >= PASO && pasos < 8) {
      const antes = new Map<number, Projectile>(this.motor.projectiles.map((p) => [p.id, p]));
      this.escena.antesDePaso();
      this.motor.step(PASO);
      const eventos = this.motor.consumeEvents();
      this.escena.procesarEventos(eventos, antes);
      this.narrar(eventos);
      this.acumulador -= PASO;
      pasos++;
    }
    this.escena.dibujar(Math.min(1, this.acumulador / PASO), dt * this.velocidad, this.seleccion, t);
    if (t - this.ultimoHud > 200) {
      this.ultimoHud = t;
      this.actualizarHud();
    }
    if (this.motor.result && !this.terminado) {
      this.terminado = true;
      setTimeout(() => this.mostrarResultado(false), 1500);
    }
    requestAnimationFrame((n) => this.bucle(n));
  }

  private narrar(eventos: ReturnType<HardcoreCombatEngine['consumeEvents']>): void {
    const m = this.motor!;
    for (const ev of eventos) {
      if (ev.type === 'rout') {
        const s = m.squad(ev.squadId)!;
        this.log(s.faction === 'rome' ? `¡La ${s.name} rompe filas y huye!` : `${s.name} germana se desbanda`, s.faction === 'rome' ? 'malo' : 'bueno');
        this.opciones.onSonido?.(s.faction === 'rome' ? 'derrota' : 'fanfarria');
      } else if (ev.type === 'rally') {
        const s = m.squad(ev.squadId)!;
        if (s.faction === 'rome') this.log(`La ${s.name} se reagrupa bajo su centurión`, 'bueno');
      } else if (ev.type === 'leaderDown') {
        const s = m.squad(ev.squadId)!;
        this.log(s.faction === 'rome' ? `Ha caído el centurión de la ${s.name}` : `Cae el caudillo de la ${s.name}`, s.faction === 'rome' ? 'malo' : 'bueno');
      } else if (ev.type === 'impact' && ev.energy > 1500) this.opciones.onSonido?.('impacto');
      else if (ev.type === 'hit') this.opciones.onSonido?.('golpe');
      else if (ev.type === 'missileLand' && ev.kind === 'stone') this.opciones.onSonido?.('piedra');
      else if (ev.type === 'missile' && ev.kind !== 'stone') this.opciones.onSonido?.('flecha');
    }
  }

  private log(texto: string, tipo: 'bueno' | 'malo' | 'info'): void {
    this.registro.push({ t: this.motor?.time ?? 0, texto, tipo });
    this.registro = this.registro.slice(-6);
  }

  // ───────────────────────── Mando ─────────────────────────

  private clicCampo(cx: number, cy: number): void {
    const m = this.motor!;
    const p = this.escena!.puntoSuelo(cx, cy);
    if (!p) return;
    let cercano: { u: (typeof m.units)[number]; d: number } | null = null;
    for (const u of m.units) {
      if (u.state === 'dead' || u.state === 'fled') continue;
      const d = Math.hypot(u.position.x - p.x, u.position.z - p.z);
      if (d < (u.mounted ? 2.6 : 1.8) && (!cercano || d < cercano.d)) cercano = { u, d };
    }
    if (cercano && cercano.u.faction === 'rome') {
      const s = m.squad(cercano.u.squadId)!;
      if (!s.ai) this.seleccion = s;
      this.ultimoHud = 0;
      return;
    }
    if (!this.seleccion) return;
    if (cercano && cercano.u.faction === 'barbarian') {
      m.order(this.seleccion.id, 'charge');
      this.seleccion.targetSquadId = cercano.u.squadId;
      this.log(`La ${this.seleccion.name} carga contra ${m.squad(cercano.u.squadId)!.name}`, 'info');
    } else {
      const c = m.centroide(this.seleccion) ?? this.seleccion.anchor;
      // Al marchar, la formación encara la dirección de avance.
      this.seleccion.facing = Math.atan2(p.x - c.x, p.z - c.z);
      m.order(this.seleccion.id, 'move', { x: p.x, z: p.z });
    }
    this.ultimoHud = 0;
  }

  private clicHud(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button, [data-escuadra]');
    if (!b || b.hasAttribute('disabled')) return;
    const m = this.motor!;
    if (b.dataset.vel) {
      this.velocidad = Number(b.dataset.vel);
      this.raiz.querySelectorAll('[data-vel]').forEach((x) => x.classList.toggle('activo', x === b));
      return;
    }
    if (b.dataset.escuadra) {
      this.seleccion = m.squad(b.dataset.escuadra) ?? null;
      const c = this.seleccion && m.centroide(this.seleccion);
      if (c && (e as MouseEvent).detail > 1) this.escena!.enfocar(c.x, c.z);
    } else if (b.dataset.formacion && this.seleccion) {
      m.setFormation(this.seleccion.id, b.dataset.formacion as FormationType);
      this.log(`La ${this.seleccion.name} adopta formación ${FORMATIONS[b.dataset.formacion as FormationType].label}`, 'info');
    } else if (b.dataset.orden && this.seleccion) {
      const orden = b.dataset.orden as SquadOrder;
      m.order(this.seleccion.id, orden);
      if (orden === 'charge') this.log(`¡La ${this.seleccion.name} carga!`, 'info');
    } else if (b.dataset.accion === 'pila' && this.seleccion) {
      const n = m.throwPila(this.seleccion.id);
      this.log(n ? `La ${this.seleccion.name} lanza ${n} pila` : 'El enemigo está fuera del alcance de los pila (28 m)', n ? 'info' : 'malo');
    } else if (b.dataset.accion === 'abandonar') {
      this.mostrarResultado(true);
      return;
    }
    this.ultimoHud = 0;
  }

  private teclado(e: KeyboardEvent): void {
    if (!this.motor || this.terminado) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.velocidad = this.velocidad === 0 ? 1 : 0;
    }
    const atajos: Record<string, FormationType> = { Digit1: 'line', Digit2: 'testudo', Digit3: 'orbis', Digit4: 'cuneus', Digit5: 'loose' };
    if (atajos[e.code] && this.seleccion) this.motor.setFormation(this.seleccion.id, atajos[e.code]);
    if (e.code === 'KeyC' && this.seleccion) this.motor.order(this.seleccion.id, 'charge');
    if (e.code === 'KeyH' && this.seleccion) this.motor.order(this.seleccion.id, 'hold');
    if (e.code === 'KeyP' && this.seleccion) this.motor.throwPila(this.seleccion.id);
    this.ultimoHud = 0;
  }

  // ───────────────────────── Interfaz ─────────────────────────

  private estadoEscuadra(s: Squad): { texto: string; clase: string } {
    const m = this.motor!;
    const miembros = m.miembros(s);
    if (!miembros.length) return { texto: 'Aniquilada', clase: 'perdida' };
    if (s.routed) return { texto: '¡Pánico!', clase: 'panico' };
    const combate = miembros.filter((u) => u.state === 'engaged').length / miembros.length;
    if (combate > 0.2) return { texto: 'En combate', clase: 'combate' };
    return { texto: ETIQUETA_ORDEN[s.order], clase: 'formada' };
  }

  private poner(el: Element, html: string): void {
    if (this.hudPulsado || this.cacheHtml.get(el) === html) return;
    el.innerHTML = html;
    this.cacheHtml.set(el, html);
  }

  private actualizarHud(): void {
    const m = this.motor!;
    const d = this.despliegue!;
    const roma = m.fuerza('rome');
    const barb = m.fuerza('barbarian');
    const min = Math.floor(m.time / 60), seg = Math.floor(m.time % 60);
    const cab = this.raiz.querySelector('#c-cabecera')!;
    this.poner(cab, `
      <div class="titulo"><b>${d.nombre}</b><small>${d.region} · ${WEATHER[m.config.weather].label}${d.escala > 1 ? ` · 1 soldado = ${d.escala.toFixed(1)} hombres` : ''}</small></div>
      <div class="fuerzas">
        <div class="bando roma"><span>Roma</span><b>${roma.activos}</b><i class="barra"><i style="width:${(roma.activos / roma.total) * 100}%"></i></i><small>Moral ${roma.moral.toFixed(0)}</small></div>
        <div class="reloj">${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}</div>
        <div class="bando germanos"><span>Germanos</span><b>${barb.activos}</b><i class="barra"><i style="width:${(barb.activos / barb.total) * 100}%"></i></i><small>Moral ${barb.moral.toFixed(0)}</small></div>
      </div>`);

    const lista = this.raiz.querySelector('#c-lista')!;
    this.poner(lista, m.squads
      .filter((s) => s.faction === 'rome')
      .map((s) => {
        const miembros = m.miembros(s);
        const moral = m.moralMedia(s);
        const fatiga = miembros.length ? miembros.reduce((a, u) => a + u.fatigue, 0) / miembros.length : 0;
        const pila = miembros.reduce((a, u) => a + u.pila, 0);
        const st = this.estadoEscuadra(s);
        const lider = m.unit(s.leaderId);
        const sel = this.seleccion?.id === s.id;
        return `<button class="escuadra ${sel ? 'sel' : ''} ${st.clase}" data-escuadra="${s.id}" ${s.ai ? 'title="Máquina: dispara por su cuenta"' : ''}>
          <span class="nombre">${s.name}<em class="estado">${st.texto}</em></span>
          <span class="datos">${miembros.length}/${s.initialSize} hombres · ${FORMATIONS[s.formation].label}${pila ? ` · ${pila} pila` : ''}${lider && lider.state === 'dead' ? ' · sin centurión' : ''}</span>
          <span class="medidor moral" title="Moral"><i style="width:${moral}%"></i></span>
          <span class="medidor fatiga" title="Fatiga"><i style="width:${fatiga}%"></i></span>
        </button>`;
      })
      .join(''));

    const mando = this.raiz.querySelector('#c-mando')!;
    const s = this.seleccion;
    if (!s || s.ai) {
      this.poner(mando, '<p class="vacio">Selecciona una centuria</p>');
    } else {
      const montada = s.unitClass === 'eques';
      const formaciones = (['line', 'testudo', 'orbis', 'cuneus', 'loose'] as FormationType[])
        .map((f, i) => `<button data-formacion="${f}" class="${s.formation === f ? 'activo' : ''}" ${montada && (f === 'testudo' || f === 'orbis') ? 'disabled' : ''} title="${this.ayudaFormacion(f)} (tecla ${i + 1})">${FORMATIONS[f].label}</button>`)
        .join('');
      const pila = m.miembros(s).reduce((a, u) => a + u.pila, 0);
      this.poner(mando, `
        <div class="grupo"><span class="etiqueta">${s.name}</span><div class="botones">${formaciones}</div></div>
        <div class="grupo"><span class="etiqueta">Órdenes</span><div class="botones">
          <button data-orden="hold" class="${s.order === 'hold' ? 'activo' : ''}">Mantener</button>
          <button data-orden="advance" class="${s.order === 'advance' ? 'activo' : ''}">Avanzar</button>
          <button data-orden="charge" class="carga ${s.order === 'charge' ? 'activo' : ''}">¡Carga!</button>
          <button data-accion="pila" ${pila ? '' : 'disabled'}>Lanzar pila (${pila})</button>
          <button data-orden="retreat" class="${s.order === 'retreat' ? 'activo' : ''}">Replegarse</button>
        </div></div>`);
    }

    const reg = this.raiz.querySelector('#c-registro')!;
    this.poner(reg, this.registro
      .map((r) => `<p class="${r.tipo}"><time>${String(Math.floor(r.t / 60)).padStart(2, '0')}:${String(Math.floor(r.t % 60)).padStart(2, '0')}</time> ${r.texto}</p>`)
      .join(''));
  }

  private ayudaFormacion(f: FormationType): string {
    return {
      line: 'Línea: equilibrio entre frente y profundidad',
      testudo: 'Testudo: casi inmune a proyectiles, −50% velocidad, torpe ante cargas de caballería',
      orbis: 'Orbis: círculo cerrado, +200% defensa en todas direcciones, casi inmóvil',
      cuneus: 'Cuneus: cuña de choque, ×2.5 energía de impacto en la carga',
      loose: 'Orden abierto: menos vulnerable a proyectiles, débil en el choque',
    }[f];
  }

  // ───────────────────────── Fin ─────────────────────────

  private calcular(abandonada: boolean): ResultadoCampal {
    const m = this.motor!;
    const escala = this.despliegue!.escala;
    const resultado: BattleResult = m.result ?? {
      winner: 'barbarian',
      dead: { rome: {}, barbarian: {} },
      fled: { rome: 0, barbarian: 0 },
      deserted: m.deserted,
      duration: m.time,
    };
    if (!m.result) {
      for (const u of m.units) if (u.state === 'dead') resultado.dead[u.faction][u.unitClass] = (resultado.dead[u.faction][u.unitClass] ?? 0) + 1;
    }
    const perdidasHombres: Partial<Record<TipoUnidad, number>> = {};
    for (const [clase, n] of Object.entries(resultado.dead.rome) as [UnitClass, number][]) {
      const t = CLASE_A_ECONOMIA[clase];
      if (t) perdidasHombres[t] = (perdidasHombres[t] ?? 0) + n * (t === 'onagro' ? 1 : escala);
    }
    // Desertores: también se pierden para la economía.
    perdidasHombres.legionario = (perdidasHombres.legionario ?? 0) + m.deserted * escala;
    // Si se abandona, los que estaban huyendo se dispersan (un tercio no vuelve).
    if (abandonada) {
      for (const u of m.units) {
        const t = CLASE_A_ECONOMIA[u.unitClass];
        if (u.faction === 'rome' && t && (u.state === 'routing' || u.state === 'fled')) perdidasHombres[t] = (perdidasHombres[t] ?? 0) + escala / 3;
      }
    }
    const perdidas: Partial<Record<TipoUnidad, number>> = {};
    let hombresPerdidos = 0;
    for (const [t, h] of Object.entries(perdidasHombres) as [TipoUnidad, number][]) {
      hombresPerdidos += h;
      const unidades = Math.min(this.opciones.ejercito[t], Math.round(h / HOMBRES_POR_UNIDAD[t]));
      if (unidades > 0) perdidas[t] = unidades;
    }
    const enemigosCaidos = Object.values(resultado.dead.barbarian).reduce((a, n) => a + (n ?? 0), 0);
    return { resultado, perdidas, hombresPerdidos: Math.round(hombresPerdidos), enemigosCaidos: Math.round(enemigosCaidos * escala), abandonada };
  }

  private mostrarResultado(abandonada: boolean): void {
    if (!this.motor) return;
    this.terminado = true;
    this.velocidad = abandonada ? 0 : 0.35;
    const r = this.calcular(abandonada);
    const victoria = !abandonada && r.resultado.winner === 'rome';
    const titulo = abandonada ? 'Retirada' : victoria ? 'Victoria' : r.resultado.winner === 'draw' ? 'Tablas' : 'Derrota';
    this.opciones.onSonido?.(victoria ? 'fanfarria' : 'derrota');
    const capa = document.createElement('div');
    capa.className = 'briefing resultado';
    capa.innerHTML = `
      <div class="briefing-caja">
        <p class="sello">${this.despliegue!.nombre}</p>
        <h1 class="${victoria ? 'victoria' : 'derrota'}">${titulo}</h1>
        <div class="cifras">
          <div><b>${r.enemigosCaidos}</b><small>germanos caídos</small></div>
          <div><b>${r.hombresPerdidos}</b><small>romanos perdidos</small></div>
          <div><b>${Math.floor(this.motor.time / 60)}:${String(Math.floor(this.motor.time % 60)).padStart(2, '0')}</b><small>duración</small></div>
        </div>
        ${this.motor.deserted ? `<p class="alerta">${this.motor.deserted} desertores por hambre.</p>` : ''}
        <p class="nota">Bajas en tus registros: ${Object.entries(r.perdidas).map(([t, n]) => `${n} × ${t}`).join(', ') || 'ninguna'}</p>
        <div class="briefing-botones"><button class="boton-hierro boton-sangre" data-accion="cerrar">Volver al castrum</button></div>
      </div>`;
    this.raiz.appendChild(capa);
    capa.querySelector('[data-accion="cerrar"]')!.addEventListener('click', () => this.cerrar(r));
  }

  private cerrar(r: ResultadoCampal | null): void {
    this.activo = false;
    window.removeEventListener('resize', this.alRedimensionar);
    window.removeEventListener('keydown', this.alTeclear);
    this.escena?.liberar();
    this.raiz.remove();
    if (r) this.opciones.onFin(r);
    else this.opciones.onFin({ resultado: { winner: 'draw', dead: { rome: {}, barbarian: {} }, fled: { rome: 0, barbarian: 0 }, deserted: 0, duration: 0 }, perdidas: {}, hombresPerdidos: 0, enemigosCaidos: 0, abandonada: true });
  }
}
