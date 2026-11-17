/**
 * Interfaz "The Roman Codex": paneles de piedra, bordes de bronce y tipografía Cinzel.
 * Genera HTML a partir del estado; las acciones se comunican con atributos data-accion
 * y un único manejador delegado.
 */
import {
  BENDICIONES,
  EDIFICIOS,
  INFO_RECURSO,
  RECURSOS,
  TIPOS_EDIFICIO,
  TIPOS_UNIDAD,
  UNIDADES,
  type Coste,
  type Recursos,
  type TipoBendicion,
  type TipoEdificio,
  type TipoUnidad,
  CONFIG_GENERAL,
} from '../data/gameConfig';
import type { FaseDia } from '../render/Renderer';
import type { Batalla, ResultadoBatalla } from '../systems/Combat';
import {
  capacidad,
  comprobarConstruccion,
  comprobarEntrenamiento,
  comprobarMejora,
  consumoPorHora,
  contarEdificios,
  costeAceleracion,
  datosNivel,
  espacioOcupado,
  limiteTropas,
  maxEdificios,
  obrasEnCurso,
  produccionPorHora,
  puedePagar,
  type EstadoJuego,
  type ResumenSimulacion,
} from '../systems/Economy';

export type ManejadorAccion = (accion: string, datos: DOMStringMap) => void;

export function formatearNumero(n: number): string {
  const v = Math.floor(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 10_000) return `${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}k`;
  return v.toLocaleString('es-ES');
}

export function formatearTiempo(segundos: number): string {
  const s = Math.max(0, Math.ceil(segundos));
  if (s === 0) return 'Instantáneo';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

function formatearCoste(coste: Coste, estado?: EstadoJuego): string {
  const partes = RECURSOS.filter((r) => (coste[r] ?? 0) > 0).map((r) => {
    const falta = estado && estado.recursos[r] < (coste[r] ?? 0);
    return `<span class="coste ${falta ? 'falta' : ''}">${INFO_RECURSO[r].icono} ${formatearNumero(coste[r]!)}</span>`;
  });
  return partes.length ? partes.join(' ') : '<span class="coste">Gratis</span>';
}

const ICONO_EDIFICIO: Record<TipoEdificio, string> = {
  senado: '🏛️',
  foro: '⚖️',
  cantera: '⛏️',
  latifundio: '🌾',
  templo: '🔥',
  aerarium: '🪙',
  lapidarium: '🧱',
  horreum: '🏚️',
  castra: '⛺',
  torre: '🏹',
  balista: '🎯',
  muralla: '🧱',
};

const ICONO_UNIDAD: Record<TipoUnidad, string> = {
  legionario: '🛡️',
  velite: '🏹',
  equites: '🐎',
  ariete: '🐏',
  onagro: '☄️',
};

const ICONO_FASE: Record<FaseDia['nombre'], string> = { Amanecer: '🌅', Día: '☀️', Atardecer: '🌇', Noche: '🌙' };

export class Hud {
  private readonly recursosEl: HTMLElement;
  private readonly accionesEl: HTMLElement;
  private readonly panelEl: HTMLElement;
  private readonly batallaEl: HTMLElement;
  private readonly modalEl: HTMLElement;
  private readonly avisoEl: HTMLElement;
  private temporizadorAviso = 0;
  private ultimoPanel = '';
  /** Mientras hay un botón pulsado no se regenera el HTML (si no, el clic se pierde). */
  private presionado = false;
  private readonly cache = new WeakMap<HTMLElement, string>();

  constructor(raiz: HTMLElement, private readonly onAccion: ManejadorAccion) {
    raiz.innerHTML = `
      <header id="recursos" class="codex-barra"></header>
      <nav id="acciones" class="codex-barra"></nav>
      <aside id="panel" class="codex-panel oculto"></aside>
      <section id="hud-batalla" class="oculto"></section>
      <div id="modal" class="oculto"></div>
      <div id="aviso" class="oculto"></div>`;
    this.recursosEl = raiz.querySelector('#recursos')!;
    this.accionesEl = raiz.querySelector('#acciones')!;
    this.panelEl = raiz.querySelector('#panel')!;
    this.batallaEl = raiz.querySelector('#hud-batalla')!;
    this.modalEl = raiz.querySelector('#modal')!;
    this.avisoEl = raiz.querySelector('#aviso')!;
    raiz.addEventListener('pointerdown', () => (this.presionado = true));
    const soltar = () => (this.presionado = false);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
    raiz.addEventListener('click', (ev) => {
      const objetivo = (ev.target as HTMLElement).closest<HTMLElement>('[data-accion]');
      if (!objetivo || objetivo.hasAttribute('disabled')) return;
      ev.stopPropagation();
      this.onAccion(objetivo.dataset.accion!, objetivo.dataset);
    });
  }

  // ───────────────────────── Comunes ─────────────────────────

  private establecer(el: HTMLElement, html: string): void {
    if (this.presionado || this.cache.get(el) === html) return;
    el.innerHTML = html;
    this.cache.set(el, html);
  }

  aviso(texto: string, tipo: 'info' | 'error' | 'exito' = 'info'): void {
    this.avisoEl.textContent = texto;
    this.avisoEl.className = `aviso-${tipo}`;
    clearTimeout(this.temporizadorAviso);
    this.temporizadorAviso = window.setTimeout(() => (this.avisoEl.className = 'oculto'), 2600);
  }

  modoAldea(): void {
    this.recursosEl.classList.remove('oculto');
    this.accionesEl.classList.remove('oculto');
    this.batallaEl.classList.add('oculto');
  }

  modoBatalla(): void {
    this.cerrarPanel();
    this.accionesEl.classList.add('oculto');
    this.batallaEl.classList.remove('oculto');
  }

  cerrarPanel(): void {
    this.panelEl.classList.add('oculto');
    this.ultimoPanel = '';
  }

  get panelAbierto(): boolean {
    return !this.panelEl.classList.contains('oculto');
  }

  private mostrarPanel(html: string): void {
    if (html !== this.ultimoPanel && !this.presionado) {
      this.panelEl.innerHTML = html;
      this.ultimoPanel = html;
    }
    this.panelEl.classList.remove('oculto');
  }

  cerrarModal(): void {
    this.modalEl.className = 'oculto';
    this.modalEl.innerHTML = '';
  }

  private mostrarModal(html: string): void {
    this.modalEl.innerHTML = `<div class="codex-panel modal-caja">${html}</div>`;
    this.modalEl.className = '';
  }

  // ───────────────────────── Barra superior ─────────────────────────

  actualizarRecursos(estado: EstadoJuego, fase: FaseDia, silenciado: boolean, recursosVisibles?: Recursos): void {
    const rec = recursosVisibles ?? estado.recursos;
    const celdas = RECURSOS.map((r) => {
      const cap = capacidad(estado, r);
      const lleno = Number.isFinite(cap) && cap > 0 ? Math.min(100, (rec[r] / cap) * 100) : 0;
      const neto = produccionPorHora(estado, r) - consumoPorHora(estado, r);
      const titulo = `${INFO_RECURSO[r].nombre}${Number.isFinite(cap) ? ` — capacidad ${formatearNumero(cap)}` : ''}${neto ? ` — ${neto > 0 ? '+' : ''}${formatearNumero(neto)}/h` : ''}`;
      return `<div class="recurso" title="${titulo}">
          <span class="icono">${INFO_RECURSO[r].icono}</span>
          <div class="valor"><b>${formatearNumero(rec[r])}</b>
          ${Number.isFinite(cap) ? `<i class="medidor"><i style="width:${lleno}%;background:${INFO_RECURSO[r].color}"></i></i>` : ''}</div>
        </div>`;
    }).join('');
    this.establecer(this.recursosEl, `
      <div class="imperio"><span class="laurel">🏅 ${estado.laureles}</span><span class="nombre">${estado.nombreImperio}</span></div>
      <div class="lista-recursos">${celdas}</div>
      <div class="fase" title="Ciclo día/noche">${ICONO_FASE[fase.nombre]} ${fase.nombre}
        <button class="boton-icono" data-accion="silencio" title="Sonido">${silenciado ? '🔇' : '🔊'}</button>
        <button class="boton-icono" data-accion="reiniciar" title="Refundar Roma (borrar partida)">↺</button></div>`);
  }

  actualizarAcciones(estado: EstadoJuego): void {
    const obras = obrasEnCurso(estado);
    const html = `
      <button class="boton-codex" data-accion="abrir-construir">🏗️<span>Construir</span></button>
      <button class="boton-codex" data-accion="abrir-ejercito">⚔️<span>Ejército ${espacioOcupado(estado)}/${limiteTropas(estado)}</span></button>
      <button class="boton-codex boton-rojo" data-accion="batalla-campal">⚔️<span>Batalla campal</span></button>
      <button class="boton-codex boton-purpura" data-accion="buscar-batalla">🦅<span>Asaltar provincia</span></button>
      <div class="fabri" title="Constructores (fabri) ocupados">🔨 ${obras}/${CONFIG_GENERAL.constructores}</div>
      <div class="zoom"><button class="boton-icono" data-accion="zoom-mas">＋</button><button class="boton-icono" data-accion="zoom-menos">－</button></div>`;
    this.establecer(this.accionesEl, html);
  }

  // ───────────────────────── Paneles de aldea ─────────────────────────

  panelConstruir(estado: EstadoJuego): void {
    const filas = TIPOS_EDIFICIO.filter((t) => t !== 'senado').map((tipo) => {
      const def = EDIFICIOS[tipo];
      const n1 = def.niveles[0];
      const chequeo = comprobarConstruccion(estado, tipo);
      const max = maxEdificios(estado, tipo);
      return `<button class="tarjeta" data-accion="colocar" data-tipo="${tipo}" ${chequeo.ok ? '' : 'disabled'}>
          <span class="tarjeta-icono">${ICONO_EDIFICIO[tipo]}</span>
          <span class="tarjeta-cuerpo">
            <b>${def.nombre}</b> <small>${contarEdificios(estado, tipo)}/${max}</small>
            <span class="detalle">${formatearCoste(n1.coste, estado)} · ⏳ ${formatearTiempo(n1.tiempoSeg)}</span>
            ${chequeo.ok ? '' : `<span class="motivo">${chequeo.motivo}</span>`}
          </span>
        </button>`;
    });
    this.mostrarPanel(`
      <div class="panel-cabecera"><h2>Construir</h2><button class="boton-icono" data-accion="cerrar-panel">✕</button></div>
      <p class="pista">Elige un edificio y toca el terreno para colocarlo. Las murallas se colocan en serie.</p>
      <div class="rejilla-tarjetas">${filas.join('')}</div>`);
  }

  panelEdificio(estado: EstadoJuego, id: number, ahora: number): void {
    const e = estado.edificios.find((b) => b.id === id);
    if (!e) return this.cerrarPanel();
    const def = EDIFICIOS[e.tipo];
    const actual = datosNivel(e.tipo, Math.max(1, e.nivel))!;
    const siguiente = datosNivel(e.tipo, e.nivel + 1);
    const stats: string[] = [`❤️ ${formatearNumero(actual.hp)} PV`];
    if (actual.produccionHora) stats.push(`${INFO_RECURSO[def.recurso!].icono} ${formatearNumero(actual.produccionHora)}/h`);
    if (actual.capacidad) stats.push(`📦 ${formatearNumero(actual.capacidad)}${e.tipo === 'senado' ? ' (🪙🏛️🌾)' : ''}`);
    if (actual.dps) stats.push(`⚔️ ${actual.dps} DPS · 🎯 ${def.defensa?.rango} casillas`);
    if (e.tipo === 'senado') stats.push(`👥 Límite tropas ${limiteTropas(estado)}`);
    if (e.tipo === 'castra') {
      const unidades = TIPOS_UNIDAD.filter((t) => UNIDADES[t].castraRequerida <= e.nivel).map((t) => ICONO_UNIDAD[t]).join(' ');
      stats.push(`Desbloquea: ${unidades}`);
    }

    let obra = '';
    if (e.obra) {
      const restante = (e.obra.finEn - ahora) / 1000;
      const aureos = costeAceleracion(e.obra.finEn - ahora);
      obra = `<div class="obra">🔨 ${e.nivel === 0 ? 'En construcción' : `Mejorando a nivel ${e.nivel + 1}`}: <b>${formatearTiempo(restante)}</b>
        <button class="boton-codex boton-purpura" data-accion="acelerar" data-id="${e.id}" ${estado.recursos.aureos >= aureos ? '' : 'disabled'}>
          Acelerar · 💎 ${aureos}</button></div>`;
    }
    let mejora = '';
    if (!e.obra) {
      if (siguiente) {
        const chequeo = comprobarMejora(estado, e.id);
        const extra: string[] = [];
        if (siguiente.produccionHora) extra.push(`${INFO_RECURSO[def.recurso!].icono} ${formatearNumero(siguiente.produccionHora)}/h`);
        if (siguiente.capacidad) extra.push(`📦 ${formatearNumero(siguiente.capacidad)}`);
        if (siguiente.dps) extra.push(`⚔️ ${siguiente.dps} DPS`);
        extra.push(`❤️ ${formatearNumero(siguiente.hp)}`);
        mejora = `<div class="mejora">
          <h3>Nivel ${siguiente.nivel}</h3>
          <div class="detalle">${extra.join(' · ')}</div>
          <div class="detalle">${formatearCoste(siguiente.coste, estado)} · ⏳ ${formatearTiempo(siguiente.tiempoSeg)}</div>
          <button class="boton-codex" data-accion="mejorar" data-id="${e.id}" ${chequeo.ok ? '' : 'disabled'}>⬆️ Mejorar</button>
          ${chequeo.ok ? '' : `<span class="motivo">${chequeo.motivo}</span>`}
        </div>`;
      } else {
        mejora = `<div class="mejora"><h3>🏆 Nivel máximo</h3></div>`;
      }
    }
    this.mostrarPanel(`
      <div class="panel-cabecera"><h2>${ICONO_EDIFICIO[e.tipo]} ${def.nombre} <small>Niv. ${e.nivel}</small></h2>
        <button class="boton-icono" data-accion="cerrar-panel">✕</button></div>
      <p class="pista">${def.descripcion}</p>
      <div class="stats">${stats.map((s) => `<span>${s}</span>`).join('')}</div>
      ${obra}${mejora}
      <div class="fila-botones">
        <button class="boton-codex boton-pequeno" data-accion="mover" data-id="${e.id}">✥ Mover</button>
        ${e.tipo === 'castra' ? '<button class="boton-codex boton-pequeno" data-accion="abrir-ejercito">⚔️ Entrenar</button>' : ''}
      </div>`);
  }

  panelEjercito(estado: EstadoJuego, ahora: number): void {
    const filas = TIPOS_UNIDAD.map((tipo) => {
      const def = UNIDADES[tipo];
      const chequeo = comprobarEntrenamiento(estado, tipo);
      return `<button class="tarjeta" data-accion="entrenar" data-tipo="${tipo}" ${chequeo.ok ? '' : 'disabled'}>
          <span class="tarjeta-icono">${ICONO_UNIDAD[tipo]}<em>${estado.ejercito[tipo]}</em></span>
          <span class="tarjeta-cuerpo">
            <b>${def.nombre}</b> <small>👥${def.espacio}</small>
            <span class="detalle">❤️${def.hp} · ⚔️${def.dps} DPS${def.rango > 1 ? ` · 🎯${def.rango}` : ''} · 🏃${def.velocidad}</span>
            <span class="detalle">${formatearCoste(def.coste, estado)} · ⏳ ${formatearTiempo(def.tiempoEntrenamientoSeg)}</span>
            <span class="descripcion">${def.descripcion}</span>
            ${chequeo.ok ? '' : `<span class="motivo">${chequeo.motivo}</span>`}
          </span>
        </button>`;
    });
    const cola = estado.colaEntrenamiento.slice(0, 12).map((o, i) => {
      const restante = i === 0 ? ` ${formatearTiempo((o.finEn - ahora) / 1000)}` : '';
      return `<span class="en-cola">${ICONO_UNIDAD[o.tipo]}${restante}</span>`;
    });
    const consumo = consumoPorHora(estado, 'trigo');
    this.mostrarPanel(`
      <div class="panel-cabecera"><h2>⚔️ Legiones <small>👥 ${espacioOcupado(estado)}/${limiteTropas(estado)}</small></h2>
        <button class="boton-icono" data-accion="cerrar-panel">✕</button></div>
      <p class="pista">Mantener el ejército consume 🌾 ${formatearNumero(consumo)}/h. El límite de tropas lo fija el Senado.</p>
      ${cola.length ? `<div class="cola">⏳ ${cola.join('')}${estado.colaEntrenamiento.length > 12 ? '…' : ''}</div>` : ''}
      <div class="rejilla-tarjetas">${filas.join('')}</div>`);
  }

  // ───────────────────────── Batalla ─────────────────────────

  actualizarBatalla(b: Batalla, seleccion: TipoUnidad | null, estado: EstadoJuego): void {
    const estrellas = '★'.repeat(b.estrellas) + '☆'.repeat(3 - b.estrellas);
    const botin = (['denarios', 'marmol', 'trigo'] as const)
      .map((r) => `${INFO_RECURSO[r].icono} ${formatearNumero(b.botin[r])}`)
      .join(' ');
    const empezada = b.empezada;
    const tarjetas = TIPOS_UNIDAD.filter((t) => b.reserva[t] > 0 || estado.ejercito[t] > 0).map(
      (t) => `<button class="unidad-boton ${seleccion === t ? 'activa' : ''}" data-accion="elegir-unidad" data-tipo="${t}" ${b.reserva[t] ? '' : 'disabled'}>
          ${ICONO_UNIDAD[t]}<b>${b.reserva[t]}</b><small>${UNIDADES[t].nombre}</small></button>`,
    );
    const bendiciones = (Object.keys(BENDICIONES) as TipoBendicion[]).map((t) => {
      const def = BENDICIONES[t];
      const activa = b.bendiciones.has(t);
      const posible = !activa && !empezada && puedePagar(estado, def.coste);
      return `<button class="boton-codex boton-pequeno ${activa ? 'boton-purpura' : ''}" data-accion="bendicion" data-tipo="${t}" ${posible ? '' : 'disabled'} title="${def.descripcion}">
          ${activa ? '✨' : '🌿'} ${def.nombre} ${activa ? '' : `· ${formatearCoste(def.coste)}`}</button>`;
    });
    this.establecer(this.batallaEl, `
      <div class="codex-barra info-batalla">
        <div><b>${b.base.nombre}</b><small>Caudillo ${b.base.caudillo} · Senado ${b.base.nivelSenado}</small></div>
        <div class="reloj">${empezada ? formatearTiempo(b.tiempoRestante) : 'Explora'}</div>
        <div class="estrellas">${estrellas} <b>${b.destruccion}%</b></div>
        <div class="botin">${botin}</div>
      </div>
      <div class="codex-barra barra-despliegue">
        <div class="unidades">${tarjetas.join('')}</div>
        <div class="bendiciones">${bendiciones.join('')}</div>
        <div class="fila-botones">
          ${empezada ? '' : '<button class="boton-codex boton-pequeno" data-accion="siguiente-rival">🔄 Otro rival · 🪙 50</button>'}
          <button class="boton-codex boton-pequeno boton-rojo" data-accion="retirada">${empezada ? '🏳️ Retirada' : '🏠 Volver'}</button>
        </div>
      </div>
      ${empezada ? '' : '<p class="pista-batalla">Elige una unidad y toca fuera de la zona roja para desplegarla. Mantén pulsado para desplegar en serie.</p>'}`);
  }

  mostrarResultado(r: ResultadoBatalla, botinReal: Coste, laureles: number, bajas: Partial<Record<TipoUnidad, number>>): void {
    const victoria = r.estrellas > 0;
    const listaBajas = TIPOS_UNIDAD.filter((t) => (bajas[t] ?? 0) > 0).map((t) => `${ICONO_UNIDAD[t]}×${bajas[t]}`).join(' ') || 'Ninguna';
    this.mostrarModal(`
      <h2 class="${victoria ? 'titulo-victoria' : 'titulo-derrota'}">${victoria ? 'VICTORIA' : 'DERROTA'}</h2>
      <div class="estrellas grandes">${'★'.repeat(r.estrellas)}${'☆'.repeat(3 - r.estrellas)}</div>
      <p>Destrucción: <b>${r.destruccion}%</b></p>
      <p>Botín: ${formatearCoste(botinReal)}</p>
      <p>Laureles: <b>${laureles >= 0 ? '+' : ''}${laureles}</b></p>
      <p>Caídos en combate: ${listaBajas}</p>
      <button class="boton-codex" data-accion="cerrar-resultado">Volver a Roma</button>`);
  }

  mostrarResumenOffline(resumen: ResumenSimulacion): void {
    const horas = resumen.milisegundos / 3_600_000;
    const producido = (['denarios', 'marmol', 'trigo', 'favor'] as const)
      .filter((r) => resumen.producido[r] >= 1)
      .map((r) => `<li>${INFO_RECURSO[r].icono} +${formatearNumero(resumen.producido[r])} ${INFO_RECURSO[r].nombre}</li>`);
    const consumo = resumen.consumido.trigo >= 1 ? `<li>🌾 −${formatearNumero(resumen.consumido.trigo)} trigo consumido por las legiones</li>` : '';
    const obras = resumen.obrasTerminadas.map((o) => `<li>🏗️ ${EDIFICIOS[o.tipo].nombre} → nivel ${o.nivel}</li>`);
    const tropas = (Object.entries(resumen.tropasEntrenadas) as [TipoUnidad, number][]).map(([t, n]) => `<li>${ICONO_UNIDAD[t]} ${n} × ${UNIDADES[t].nombre}</li>`);
    this.mostrarModal(`
      <h2>Ave, César</h2>
      <p>Durante tu ausencia (${formatearTiempo(horas * 3600)}) el imperio no ha descansado:</p>
      <ul class="lista-resumen">${[...producido, consumo, ...obras, ...tropas].join('') || '<li>Nada destacable.</li>'}</ul>
      <button class="boton-codex" data-accion="cerrar-modal">Continuar</button>`);
  }

  confirmarReinicio(): void {
    this.mostrarModal(`
      <h2>¿Refundar Roma?</h2><p>Se perderá todo el progreso guardado.</p>
      <div class="fila-botones"><button class="boton-codex boton-rojo" data-accion="reiniciar-confirmado">Refundar</button>
      <button class="boton-codex" data-accion="cerrar-modal">Cancelar</button></div>`);
  }
}
