/**
 * IMPERIUM: LEGIONS & GLORY — punto de entrada y bucle principal.
 * Máquina de estados: 'aldea' (gestión en tiempo real) ↔ 'batalla' (simulación de combate).
 */
import './styles.css';
import { BENDICIONES, CONFIG_BOTIN, EDIFICIOS, TIPOS_UNIDAD, type TipoBendicion, type TipoEdificio, type TipoUnidad } from './data/gameConfig';
import { Sfx } from './audio/Sfx';
import { Renderizador, calcularFaseDia } from './render/Renderer';
import { generarBaseEnemiga } from './systems/BaseGenerator';
import { Batalla, botinEntero } from './systems/Combat';
import {
  acelerarObra,
  anadirRecursos,
  consumoPorHora,
  construir,
  crearEstadoInicial,
  entrenar,
  espacioEjercito,
  mejorar,
  moverEdificio,
  nivelSenado,
  puedeColocar,
  puedePagar,
  simular,
  type EstadoJuego,
} from './systems/Economy';
import { borrar, cargar, guardar } from './systems/SaveSystem';
import { Hud } from './ui/Hud';
import { BatallaCampal, type ResultadoCampal } from './battle3d/BatallaCampal';

type Modo = 'aldea' | 'batalla' | 'campal';
type Panel = { tipo: 'construir' } | { tipo: 'edificio'; id: number } | { tipo: 'ejercito' } | null;

const PASO_COMBATE = 1 / 30;

class Juego {
  private estado: EstadoJuego;
  private readonly render: Renderizador;
  private readonly hud: Hud;
  private readonly sfx = new Sfx();
  private modo: Modo = 'aldea';
  private panel: Panel = null;
  private seleccionId: number | null = null;
  private colocando: TipoEdificio | null = null;
  private moviendoId: number | null = null;
  private cursor: { x: number; y: number } | null = null;
  private batalla: Batalla | null = null;
  private unidadElegida: TipoUnidad | null = null;
  private acumulador = 0;
  private ultimoFotograma = performance.now();
  private ultimoHud = 0;
  private ultimoGuardado = 0;
  // Entrada de puntero.
  private pulsando = false;
  private arrastrando = false;
  private inicioPuntero = { x: 0, y: 0 };
  private ultimoPuntero = { x: 0, y: 0 };
  private ultimoDespliegue = 0;

  constructor(canvas: HTMLCanvasElement, raizUi: HTMLElement) {
    this.render = new Renderizador(canvas);
    this.hud = new Hud(raizUi, (accion, datos) => this.accion(accion, datos));
    const ahora = Date.now();
    const guardado = cargar();
    if (guardado) {
      this.estado = guardado;
      const resumen = simular(this.estado, ahora);
      if (resumen.milisegundos > 60_000) this.hud.mostrarResumenOffline(resumen);
    } else {
      this.estado = crearEstadoInicial(ahora);
    }
    this.render.centrarEn(20, 20);
    if (window.innerWidth < 640) this.render.camara.zoom = 0.6;
    this.registrarEntrada(canvas);
    window.addEventListener('resize', () => this.render.redimensionar());
    window.addEventListener('beforeunload', () => guardar(this.estado));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) guardar(this.estado);
    });
    this.hud.modoAldea();
    requestAnimationFrame((t) => this.bucle(t));
  }

  // ───────────────────────── Bucle ─────────────────────────

  private bucle(t: number): void {
    const dt = Math.min(0.25, (t - this.ultimoFotograma) / 1000);
    this.ultimoFotograma = t;
    const ahora = Date.now();
    const resumen = simular(this.estado, ahora);
    for (const o of resumen.obrasTerminadas) this.hud.aviso(`🏗️ ${EDIFICIOS[o.tipo].nombre} alcanza el nivel ${o.nivel}`, 'exito');

    if (this.modo === 'campal') {
      // La batalla campal 3D tiene su propio bucle; la economía sigue corriendo.
    } else if (this.modo === 'batalla' && this.batalla) {
      this.actualizarBatalla(dt, t);
      this.render.dibujarBatalla(this.batalla, ahora, {
        mostrarZona: !!this.unidadElegida && !this.batalla.resultado,
        cursor: this.cursor && this.unidadElegida ? { ...this.cursor, valido: this.batalla.puedeDesplegar(this.cursor.x, this.cursor.y) } : null,
      });
    } else {
      this.render.dibujarAldea(this.estado, ahora, { seleccionId: this.seleccionId, fantasma: this.fantasma() });
    }

    if (t - this.ultimoHud > 250) {
      this.ultimoHud = t;
      this.refrescarHud(ahora);
    }
    if (ahora - this.ultimoGuardado > 5000) {
      this.ultimoGuardado = ahora;
      guardar(this.estado);
    }
    requestAnimationFrame((n) => this.bucle(n));
  }

  private actualizarBatalla(dt: number, t: number): void {
    const b = this.batalla!;
    // Despliegue continuo mientras se mantiene pulsado.
    if (this.pulsando && !this.arrastrando && this.unidadElegida && t - this.ultimoDespliegue > 140) {
      this.ultimoDespliegue = t;
      this.desplegarEn(this.ultimoPuntero.x, this.ultimoPuntero.y, false);
    }
    this.acumulador += dt;
    while (this.acumulador >= PASO_COMBATE) {
      b.actualizar(PASO_COMBATE);
      this.acumulador -= PASO_COMBATE;
    }
    const eventos = b.consumirEventos();
    this.render.procesarEventos(eventos);
    for (const ev of eventos) {
      if (ev.tipo === 'disparo' && ev.proyectil !== 'piedra') this.sfx.flecha();
      else if (ev.tipo === 'impacto' && ev.proyectil === 'piedra') this.sfx.impactoPiedra();
      else if (ev.tipo === 'golpe') this.sfx.espada();
      else if (ev.tipo === 'destruido') this.sfx.derrumbe();
    }
    if (b.resultado && !this.resultadoMostrado) this.terminarBatalla();
  }

  private resultadoMostrado = false;

  private fantasma() {
    if (!this.cursor) return null;
    const tipo = this.colocando ?? (this.moviendoId ? this.estado.edificios.find((e) => e.id === this.moviendoId)?.tipo : undefined);
    if (!tipo) return null;
    const { x, y } = this.origenHuella(tipo, this.cursor);
    return { tipo, x, y, valido: puedeColocar(this.estado, tipo, x, y, this.moviendoId ?? undefined) };
  }

  private origenHuella(tipo: TipoEdificio, p: { x: number; y: number }) {
    const def = EDIFICIOS[tipo];
    return { x: Math.floor(p.x - def.ancho / 2 + 0.5), y: Math.floor(p.y - def.alto / 2 + 0.5) };
  }

  private refrescarHud(ahora: number): void {
    const fase = calcularFaseDia(ahora);
    this.hud.actualizarRecursos(this.estado, fase, this.sfx.silenciado);
    if (this.modo === 'aldea') {
      this.hud.actualizarAcciones(this.estado);
      if (this.panel?.tipo === 'construir') this.hud.panelConstruir(this.estado);
      else if (this.panel?.tipo === 'edificio') this.hud.panelEdificio(this.estado, this.panel.id, ahora);
      else if (this.panel?.tipo === 'ejercito') this.hud.panelEjercito(this.estado, ahora);
    } else if (this.batalla) {
      this.hud.actualizarBatalla(this.batalla, this.unidadElegida, this.estado);
    }
  }

  private abrirPanel(panel: Panel): void {
    this.panel = panel;
    if (!panel) {
      this.hud.cerrarPanel();
      this.seleccionId = null;
    }
    this.ultimoHud = 0;
  }

  // ───────────────────────── Acciones de interfaz ─────────────────────────

  private accion(accion: string, datos: DOMStringMap): void {
    this.sfx.desbloquear();
    const ahora = Date.now();
    switch (accion) {
      case 'abrir-construir':
        this.cancelarColocacion();
        this.abrirPanel({ tipo: 'construir' });
        break;
      case 'abrir-ejercito':
        this.abrirPanel({ tipo: 'ejercito' });
        break;
      case 'cerrar-panel':
        this.cancelarColocacion();
        this.abrirPanel(null);
        break;
      case 'colocar':
        this.colocando = datos.tipo as TipoEdificio;
        this.moviendoId = null;
        this.abrirPanel(null);
        this.hud.aviso(`Toca el terreno para colocar: ${EDIFICIOS[this.colocando].nombre}. Clic derecho / Esc para cancelar.`);
        break;
      case 'mejorar':
        this.resultado(mejorar(this.estado, Number(datos.id), ahora), '⬆️ Obras de mejora iniciadas');
        break;
      case 'acelerar':
        this.resultado(acelerarObra(this.estado, Number(datos.id), ahora), '💎 Obra completada');
        break;
      case 'mover':
        this.moviendoId = Number(datos.id);
        this.colocando = null;
        this.abrirPanel(null);
        this.hud.aviso('Toca la nueva ubicación');
        break;
      case 'entrenar':
        this.resultado(entrenar(this.estado, datos.tipo as TipoUnidad, ahora), null);
        break;
      case 'buscar-batalla':
        this.iniciarBatalla();
        break;
      case 'batalla-campal':
        this.iniciarCampal();
        break;
      case 'siguiente-rival':
        if (puedePagar(this.estado, { denarios: 50 })) {
          this.estado.recursos.denarios -= 50;
          this.iniciarBatalla();
        } else this.hud.aviso('Denarios insuficientes', 'error');
        break;
      case 'elegir-unidad':
        this.unidadElegida = datos.tipo as TipoUnidad;
        this.sfx.metal();
        break;
      case 'bendicion': {
        const tipo = datos.tipo as TipoBendicion;
        const def = BENDICIONES[tipo];
        if (this.batalla && puedePagar(this.estado, def.coste) && this.batalla.activarBendicion(tipo)) {
          this.estado.recursos.favor -= def.coste.favor ?? 0;
          this.hud.aviso(`✨ ${def.nombre}`, 'exito');
          this.sfx.fanfarria(true);
        }
        break;
      }
      case 'retirada':
        if (this.batalla?.empezada) this.batalla.retirarse();
        else this.volverAldea();
        break;
      case 'cerrar-resultado':
        this.hud.cerrarModal();
        this.volverAldea();
        break;
      case 'cerrar-modal':
        this.hud.cerrarModal();
        break;
      case 'silencio':
        this.sfx.silenciado = !this.sfx.silenciado;
        break;
      case 'zoom-mas':
        this.render.zoomEn(1.2, this.render.ancho / 2, this.render.alto / 2);
        break;
      case 'zoom-menos':
        this.render.zoomEn(1 / 1.2, this.render.ancho / 2, this.render.alto / 2);
        break;
      case 'reiniciar':
        this.hud.confirmarReinicio();
        break;
      case 'reiniciar-confirmado':
        borrar();
        this.estado = crearEstadoInicial(Date.now());
        this.hud.cerrarModal();
        this.abrirPanel(null);
        break;
    }
    this.ultimoHud = 0;
  }

  private resultado(r: { ok: boolean; motivo?: string }, exito: string | null): void {
    if (r.ok) {
      this.sfx.construir();
      if (exito) this.hud.aviso(exito, 'exito');
      guardar(this.estado);
    } else {
      this.hud.aviso(r.motivo ?? 'No es posible', 'error');
    }
  }

  private cancelarColocacion(): void {
    this.colocando = null;
    this.moviendoId = null;
  }

  // ───────────────────────── Batalla ─────────────────────────

  private iniciarBatalla(): void {
    if (espacioEjercito(this.estado.ejercito) === 0) {
      this.hud.aviso('Necesitas tropas: entrena legiones en la Castra', 'error');
      return;
    }
    this.cancelarColocacion();
    const semilla = (Math.random() * 2 ** 31) | 0;
    this.batalla = new Batalla(generarBaseEnemiga(nivelSenado(this.estado), semilla), this.estado.ejercito);
    this.modo = 'batalla';
    this.resultadoMostrado = false;
    this.unidadElegida = TIPOS_UNIDAD.find((t) => this.estado.ejercito[t] > 0) ?? null;
    this.render.centrarEn(20, 20);
    this.hud.modoBatalla();
    this.sfx.metal();
  }

  private iniciarCampal(): void {
    const ej = this.estado.ejercito;
    if (ej.legionario + ej.velite + ej.equites + ej.onagro === 0) {
      this.hud.aviso('Necesitas tropas de campaña: entrena legionarios, vélites o equites en la Castra', 'error');
      return;
    }
    this.cancelarColocacion();
    this.abrirPanel(null);
    this.modo = 'campal';
    const lienzo = document.querySelector<HTMLElement>('#lienzo')!;
    const ui = document.querySelector<HTMLElement>('#ui')!;
    lienzo.style.display = 'none';
    ui.style.display = 'none';
    // Líneas de suministro cortadas: menos trigo que dos horas de mantenimiento.
    const hambre = this.estado.recursos.trigo < Math.max(1, consumoPorHora(this.estado, 'trigo') * 2);
    new BatallaCampal(document.body, {
      ejercito: { ...ej },
      nivelSenado: nivelSenado(this.estado),
      hambre,
      onSonido: (t) => {
        if (t === 'golpe') this.sfx.espada();
        else if (t === 'impacto') this.sfx.construir();
        else if (t === 'piedra') this.sfx.impactoPiedra();
        else if (t === 'flecha') this.sfx.flecha();
        else this.sfx.fanfarria(t === 'fanfarria');
      },
      onFin: (r) => {
        lienzo.style.display = '';
        ui.style.display = '';
        this.modo = 'aldea';
        this.render.redimensionar();
        this.hud.modoAldea();
        this.aplicarCampal(r);
      },
    });
  }

  private aplicarCampal(r: ResultadoCampal): void {
    if (r.resultado.duration === 0) return; // se volvió sin combatir
    for (const [t, n] of Object.entries(r.perdidas) as [TipoUnidad, number][]) this.estado.ejercito[t] = Math.max(0, this.estado.ejercito[t] - n);
    const victoria = !r.abandonada && r.resultado.winner === 'rome';
    if (victoria) {
      // Botín del campamento enemigo y del campo de batalla.
      const botin = anadirRecursos(this.estado, { denarios: r.enemigosCaidos * 12, trigo: r.enemigosCaidos * 8, favor: Math.round(r.enemigosCaidos / 4) });
      this.estado.laureles += 25;
      this.estado.batallasGanadas += 1;
      this.hud.aviso(`Victoria: +${botin.denarios} denarios, +${botin.trigo} trigo, +25 laureles`, 'exito');
    } else {
      this.estado.laureles = Math.max(0, this.estado.laureles + CONFIG_BOTIN.laurelesDerrota);
      this.hud.aviso(`Las legiones regresan diezmadas: ${r.hombresPerdidos} hombres perdidos`, 'error');
    }
    guardar(this.estado);
  }

  private desplegarEn(sx: number, sy: number, avisar: boolean): void {
    const b = this.batalla;
    if (!b || !this.unidadElegida || b.resultado) return;
    const p = this.render.pantallaACartesiano(sx, sy);
    if (b.reserva[this.unidadElegida] <= 0) {
      this.unidadElegida = TIPOS_UNIDAD.find((t) => b.reserva[t] > 0) ?? null;
      if (!this.unidadElegida) return;
    }
    if (b.desplegar(this.unidadElegida, p.x, p.y)) this.sfx.metal();
    else if (avisar) this.hud.aviso('No puedes desplegar en la zona roja', 'error');
  }

  private terminarBatalla(): void {
    const b = this.batalla!;
    const r = b.resultado!;
    this.resultadoMostrado = true;
    const bajas: Partial<Record<TipoUnidad, number>> = {};
    for (const t of TIPOS_UNIDAD) {
      const perdidas = this.estado.ejercito[t] - r.supervivientes[t];
      if (perdidas > 0) bajas[t] = perdidas;
      this.estado.ejercito[t] = r.supervivientes[t];
    }
    const botinReal = anadirRecursos(this.estado, botinEntero(r.botin));
    const laureles = r.estrellas > 0 ? r.estrellas * CONFIG_BOTIN.laurelesPorEstrella : CONFIG_BOTIN.laurelesDerrota;
    this.estado.laureles = Math.max(0, this.estado.laureles + laureles);
    if (r.estrellas > 0) this.estado.batallasGanadas += 1;
    guardar(this.estado);
    this.sfx.fanfarria(r.estrellas > 0);
    setTimeout(() => this.hud.mostrarResultado(r, botinReal, laureles, bajas), 600);
  }

  private volverAldea(): void {
    this.batalla = null;
    this.modo = 'aldea';
    this.unidadElegida = null;
    this.hud.modoAldea();
    this.render.centrarEn(20, 20);
  }

  // ───────────────────────── Entrada ─────────────────────────

  private registrarEntrada(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (ev) => {
      this.sfx.desbloquear();
      canvas.setPointerCapture(ev.pointerId);
      this.pulsando = true;
      this.arrastrando = false;
      this.inicioPuntero = { x: ev.offsetX, y: ev.offsetY };
      this.ultimoPuntero = { x: ev.offsetX, y: ev.offsetY };
      this.ultimoDespliegue = performance.now();
      if (this.modo === 'batalla') this.desplegarEn(ev.offsetX, ev.offsetY, true);
    });
    canvas.addEventListener('pointermove', (ev) => {
      this.cursor = this.render.pantallaACartesiano(ev.offsetX, ev.offsetY);
      if (this.pulsando) {
        const dx = ev.offsetX - this.ultimoPuntero.x;
        const dy = ev.offsetY - this.ultimoPuntero.y;
        if (Math.hypot(ev.offsetX - this.inicioPuntero.x, ev.offsetY - this.inicioPuntero.y) > 6) this.arrastrando = true;
        if (this.arrastrando) this.render.desplazar(dx, dy);
      }
      this.ultimoPuntero = { x: ev.offsetX, y: ev.offsetY };
    });
    canvas.addEventListener('pointerup', (ev) => {
      const fueClic = this.pulsando && !this.arrastrando;
      this.pulsando = false;
      if (fueClic && this.modo === 'aldea') this.clicAldea(ev.offsetX, ev.offsetY);
    });
    canvas.addEventListener('pointerleave', () => (this.cursor = null));
    canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.cancelarColocacion();
    });
    canvas.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        this.render.zoomEn(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev.offsetX, ev.offsetY);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        this.cancelarColocacion();
        this.abrirPanel(null);
      }
    });
  }

  private clicAldea(sx: number, sy: number): void {
    const p = this.render.pantallaACartesiano(sx, sy);
    const ahora = Date.now();
    if (this.colocando) {
      const tipo = this.colocando;
      const { x, y } = this.origenHuella(tipo, p);
      const r = construir(this.estado, tipo, x, y, ahora);
      this.resultado(r, null);
      // Las murallas se colocan en serie; el resto, de uno en uno.
      if (r.ok && tipo !== 'muralla') this.colocando = null;
      return;
    }
    if (this.moviendoId) {
      const e = this.estado.edificios.find((b) => b.id === this.moviendoId);
      if (e) {
        const { x, y } = this.origenHuella(e.tipo, p);
        this.resultado(moverEdificio(this.estado, e.id, x, y), null);
      }
      this.moviendoId = null;
      return;
    }
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const e = this.estado.edificios.find((b) => {
      const def = EDIFICIOS[b.tipo];
      return cx >= b.x && cx < b.x + def.ancho && cy >= b.y && cy < b.y + def.alto;
    });
    if (e) {
      this.seleccionId = e.id;
      this.sfx.metal();
      this.abrirPanel({ tipo: 'edificio', id: e.id });
    } else {
      this.abrirPanel(null);
    }
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#lienzo')!;
const ui = document.querySelector<HTMLElement>('#ui')!;
new Juego(canvas, ui);
