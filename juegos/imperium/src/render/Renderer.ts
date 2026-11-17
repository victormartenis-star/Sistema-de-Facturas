/**
 * Renderizador Canvas 2D isométrico 2.5D.
 *
 * Todo se dibuja en "espacio isométrico" (píxeles del IsoRenderer) y la cámara se aplica
 * con una única transformación afín. Las entidades se ordenan con sortEntitiesByDepth
 * (algoritmo del pintor). Tras la escena se aplica el ciclo día/noche y la luz de antorchas.
 */
import { CONFIG_GENERAL, EDIFICIOS, PALETA, UNIDADES, type TipoEdificio, type TipoUnidad } from '../data/gameConfig';
import { posicionEnVuelo } from '../engine/Ballistics';
import { IsoRenderer, sortEntitiesByDepth, type EntidadOrdenable, type Vector2D } from '../engine/IsoGrid';
import { mulberry32 } from '../systems/BaseGenerator';
import type { Batalla, EventoCombate, UnidadCombate } from '../systems/Combat';
import type { EstadoJuego } from '../systems/Economy';

const T = CONFIG_GENERAL.tamanoMapa;
const ALTURA_Z = 32; // píxeles por casilla de altura

interface Dibujable extends EntidadOrdenable {
  dibujar(): void;
}

export interface EdificioDibujable {
  id: number;
  tipo: TipoEdificio;
  nivel: number;
  x: number;
  y: number;
  /** 0..1 si está en obras. */
  progresoObra: number | null;
  destruido: boolean;
  /** 0..1 si está dañado (batalla). */
  vida: number | null;
  translucido?: boolean;
}

interface Particula {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  vida: number;
  vidaMax: number;
  color: string;
  tamano: number;
  gravedad: number;
}

export interface FaseDia {
  nombre: 'Amanecer' | 'Día' | 'Atardecer' | 'Noche';
  oscuridad: number;
  antorchas: boolean;
  /** −1 (medianoche) … 1 (mediodía). */
  elevacionSol: number;
}

export function calcularFaseDia(ahoraMs: number): FaseDia {
  const dur = CONFIG_GENERAL.duracionDiaSeg;
  const t = ((ahoraMs / 1000) % dur) / dur;
  const elev = Math.sin(2 * Math.PI * (t - 0.25));
  const oscuridad = Math.min(0.62, Math.max(0, (0.25 - elev) * 0.6));
  const subiendo = t < 0.5;
  let nombre: FaseDia['nombre'] = 'Día';
  if (elev < -0.15) nombre = 'Noche';
  else if (elev < 0.3) nombre = subiendo ? 'Amanecer' : 'Atardecer';
  return { nombre, oscuridad, antorchas: elev < 0.07, elevacionSol: elev };
}

export class Renderizador {
  readonly iso = new IsoRenderer(64, 32);
  readonly camara = { x: 0, y: T * 16, zoom: 1 };
  private readonly ctx: CanvasRenderingContext2D;
  private terreno: HTMLCanvasElement | null = null;
  private arboles: { x: number; y: number; escala: number }[] = [];
  private particulas: Particula[] = [];
  private antorchas: { x: number; y: number; z: number }[] = [];
  private zonaCache: { batalla: Batalla; ruta: Path2D } | null = null;
  private dpr = 1;
  private reloj = 0;
  private fase: FaseDia = calcularFaseDia(0);

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible');
    this.ctx = ctx;
    this.generarDecorado();
    this.redimensionar();
  }

  get ancho(): number {
    return this.canvas.clientWidth;
  }
  get alto(): number {
    return this.canvas.clientHeight;
  }

  redimensionar(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.canvas.clientWidth * this.dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * this.dpr);
  }

  // ───────────────────────── Cámara ─────────────────────────

  pantallaACartesiano(sx: number, sy: number): Vector2D {
    const ix = (sx - this.ancho / 2) / this.camara.zoom + this.camara.x;
    const iy = (sy - this.alto / 2) / this.camara.zoom + this.camara.y;
    return this.iso.isometricToCartesianExact(ix, iy);
  }

  desplazar(dxPantalla: number, dyPantalla: number): void {
    this.camara.x -= dxPantalla / this.camara.zoom;
    this.camara.y -= dyPantalla / this.camara.zoom;
    const lim = T * 32;
    this.camara.x = Math.max(-lim, Math.min(lim, this.camara.x));
    this.camara.y = Math.max(0, Math.min(T * 32, this.camara.y));
  }

  zoomEn(factor: number, sx: number, sy: number): void {
    const antes = this.pantallaACartesiano(sx, sy);
    this.camara.zoom = Math.max(0.45, Math.min(2.2, this.camara.zoom * factor));
    const despues = this.pantallaACartesiano(sx, sy);
    const a = this.iso.cartesianToIsometric(antes.x, antes.y);
    const b = this.iso.cartesianToIsometric(despues.x, despues.y);
    this.camara.x += a.x - b.x;
    this.camara.y += a.y - b.y;
  }

  centrarEn(cx: number, cy: number): void {
    const p = this.iso.cartesianToIsometric(cx, cy);
    this.camara.x = p.x;
    this.camara.y = p.y;
  }

  private P(x: number, y: number, z = 0): Vector2D {
    const p = this.iso.cartesianToIsometric(x, y);
    return { x: p.x, y: p.y - z };
  }

  // ───────────────────────── Escena ─────────────────────────

  private comenzar(ahora: number): void {
    this.reloj = ahora / 1000;
    this.fase = calcularFaseDia(ahora);
    this.antorchas = [];
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#1d2412';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const z = this.camara.zoom * this.dpr;
    c.setTransform(z, 0, 0, z, (this.ancho / 2) * this.dpr - this.camara.x * z, (this.alto / 2) * this.dpr - this.camara.y * z);
    if (!this.terreno) this.terreno = this.crearTerreno();
    c.drawImage(this.terreno, -T * 32 - 8, -8);
  }

  dibujarAldea(
    estado: EstadoJuego,
    ahora: number,
    opciones: { seleccionId?: number | null; fantasma?: { tipo: TipoEdificio; x: number; y: number; valido: boolean } | null },
  ): void {
    this.comenzar(ahora);
    const sel = estado.edificios.find((e) => e.id === opciones.seleccionId);
    if (sel) this.contornoHuella(sel.x, sel.y, EDIFICIOS[sel.tipo].ancho, EDIFICIOS[sel.tipo].alto, PALETA.oro, true);

    const lista: Dibujable[] = [];
    for (const e of estado.edificios) {
      const def = EDIFICIOS[e.tipo];
      const progreso = e.obra ? Math.min(1, (ahora - e.obra.inicio) / Math.max(1, e.obra.finEn - e.obra.inicio)) : null;
      const d: EdificioDibujable = { id: e.id, tipo: e.tipo, nivel: Math.max(1, e.nivel), x: e.x, y: e.y, progresoObra: progreso, destruido: false, vida: null, translucido: e.nivel === 0 };
      lista.push({ cartX: e.x, cartY: e.y, width: def.ancho, height: def.alto, dibujar: () => this.dibujarEdificio(d) });
    }
    this.anadirArboles(lista);

    if (opciones.fantasma) {
      const f = opciones.fantasma;
      const def = EDIFICIOS[f.tipo];
      this.rellenarHuella(f.x, f.y, def.ancho, def.alto, f.valido ? 'rgba(90,200,90,0.45)' : 'rgba(220,60,50,0.5)');
      lista.push({
        cartX: f.x,
        cartY: f.y,
        width: def.ancho,
        height: def.alto,
        capa: 5,
        dibujar: () => this.dibujarEdificio({ id: -1, tipo: f.tipo, nivel: 1, x: f.x, y: f.y, progresoObra: null, destruido: false, vida: null, translucido: true }),
      });
    }
    for (const d of sortEntitiesByDepth(lista)) d.dibujar();
    this.terminar();
  }

  dibujarBatalla(b: Batalla, ahora: number, opciones: { mostrarZona: boolean; cursor?: { x: number; y: number; valido: boolean } | null }): void {
    this.comenzar(ahora);
    if (opciones.mostrarZona) {
      if (this.zonaCache?.batalla !== b) this.zonaCache = { batalla: b, ruta: this.rutaZonaProhibida(b) };
      this.ctx.fillStyle = 'rgba(192,57,43,0.18)';
      this.ctx.fill(this.zonaCache.ruta);
    }
    const lista: Dibujable[] = [];
    for (const e of b.edificios) {
      const d: EdificioDibujable = {
        id: e.id,
        tipo: e.tipo,
        nivel: e.nivel,
        x: e.x,
        y: e.y,
        progresoObra: null,
        destruido: e.destruido,
        vida: e.hp < e.hpMax ? e.hp / e.hpMax : null,
      };
      lista.push({ cartX: e.x, cartY: e.y, width: e.w, height: e.h, dibujar: () => this.dibujarEdificio(d) });
    }
    for (const u of b.unidades) lista.push({ cartX: u.x, cartY: u.y, width: 0, height: 0, capa: 1, dibujar: () => this.dibujarUnidad(u) });
    this.anadirArboles(lista);
    for (const d of sortEntitiesByDepth(lista)) d.dibujar();

    // Proyectiles siempre por encima (están en el aire).
    for (const p of b.proyectiles) {
      const pos = posicionEnVuelo(p.tiro, p.t);
      const prev = posicionEnVuelo(p.tiro, Math.max(0, p.t - 0.05));
      this.dibujarProyectil(p.tipo, pos, prev);
    }
    if (opciones.cursor) {
      const c = opciones.cursor;
      this.rellenarHuella(Math.floor(c.x), Math.floor(c.y), 1, 1, c.valido ? 'rgba(212,175,55,0.55)' : 'rgba(192,57,43,0.55)');
    }
    this.actualizarParticulas();
    this.terminar();
  }

  private terminar(): void {
    const c = this.ctx;
    const f = this.fase;
    c.setTransform(1, 0, 0, 1, 0, 0);
    // Tinte cálido en amanecer/atardecer.
    const calidez = Math.max(0, 1 - Math.abs(f.elevacionSol) / 0.35);
    if (calidez > 0) {
      c.fillStyle = `rgba(255,120,40,${0.16 * calidez})`;
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (f.oscuridad > 0) {
      c.fillStyle = `rgba(12,14,42,${f.oscuridad})`;
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (f.antorchas && this.antorchas.length) {
      const z = this.camara.zoom * this.dpr;
      c.globalCompositeOperation = 'lighter';
      const intensidad = Math.min(1, f.oscuridad / 0.4);
      for (const a of this.antorchas) {
        const p = this.P(a.x, a.y, a.z);
        const sx = (p.x - this.camara.x) * z + (this.ancho / 2) * this.dpr;
        const sy = (p.y - this.camara.y) * z + (this.alto / 2) * this.dpr;
        const r = (46 + Math.sin(this.reloj * 9 + a.x * 3) * 3) * z;
        const g = c.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, `rgba(255,170,70,${0.42 * intensidad})`);
        g.addColorStop(1, 'rgba(255,120,40,0)');
        c.fillStyle = g;
        c.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
      c.globalCompositeOperation = 'source-over';
    }
  }

  // ───────────────────────── Terreno y decorado ─────────────────────────

  private generarDecorado(): void {
    const rnd = mulberry32(1453);
    const m = CONFIG_GENERAL.margenMapa;
    for (let i = 0; i < T; i++) {
      for (let j = 0; j < T; j++) {
        const enBorde = i < m || j < m || i >= T - m || j >= T - m;
        if (enBorde && rnd() < 0.55) this.arboles.push({ x: i + 0.3 + rnd() * 0.4, y: j + 0.3 + rnd() * 0.4, escala: 0.8 + rnd() * 0.5 });
      }
    }
  }

  private anadirArboles(lista: Dibujable[]): void {
    for (const a of this.arboles) lista.push({ cartX: a.x, cartY: a.y, width: 0, height: 0, dibujar: () => this.dibujarCipres(a.x, a.y, a.escala) });
  }

  private crearTerreno(): HTMLCanvasElement {
    const lienzo = document.createElement('canvas');
    lienzo.width = T * 64 + 16;
    lienzo.height = T * 32 + 16;
    const c = lienzo.getContext('2d')!;
    c.translate(T * 32 + 8, 8);
    const rnd = mulberry32(77);
    const m = CONFIG_GENERAL.margenMapa;
    for (let i = 0; i < T; i++) {
      for (let j = 0; j < T; j++) {
        const enBorde = i < m || j < m || i >= T - m || j >= T - m;
        const v = rnd();
        let color: string = (i + j) % 2 === 0 ? PALETA.oliva : '#5B7232';
        if (v < 0.08) color = PALETA.olivaClaro;
        if (enBorde) color = v < 0.5 ? PALETA.olivaOscuro : '#34451B';
        c.fillStyle = color;
        this.trazarRombo(c, i, j, 1, 1);
        c.fill();
        if (!enBorde && v > 0.94) {
          // Florecillas / matojos.
          const p = this.P(i + 0.5, j + 0.5);
          c.fillStyle = v > 0.97 ? '#E6D57A' : '#7E9B48';
          c.fillRect(p.x - 1, p.y - 1, 2, 2);
        }
      }
    }
    c.strokeStyle = 'rgba(0,0,0,0.07)';
    c.lineWidth = 1;
    for (let i = m; i <= T - m; i++) {
      this.linea(c, this.P(i, m), this.P(i, T - m));
      this.linea(c, this.P(m, i), this.P(T - m, i));
    }
    return lienzo;
  }

  private rutaZonaProhibida(b: Batalla): Path2D {
    const ruta = new Path2D();
    for (let i = 0; i < T; i++) {
      for (let j = 0; j < T; j++) {
        if (!b.esZonaProhibida(i, j)) continue;
        const a = this.P(i, j), bb = this.P(i + 1, j), cc = this.P(i + 1, j + 1), dd = this.P(i, j + 1);
        ruta.moveTo(a.x, a.y);
        ruta.lineTo(bb.x, bb.y);
        ruta.lineTo(cc.x, cc.y);
        ruta.lineTo(dd.x, dd.y);
        ruta.closePath();
      }
    }
    return ruta;
  }

  // ───────────────────────── Primitivas ─────────────────────────

  private linea(c: CanvasRenderingContext2D, a: Vector2D, b: Vector2D): void {
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  }

  private trazarRombo(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, z = 0): void {
    const n = this.P(x, y, z), e = this.P(x + w, y, z), s = this.P(x + w, y + h, z), o = this.P(x, y + h, z);
    c.beginPath();
    c.moveTo(n.x, n.y);
    c.lineTo(e.x, e.y);
    c.lineTo(s.x, s.y);
    c.lineTo(o.x, o.y);
    c.closePath();
  }

  private poligono(puntos: Vector2D[], color: string): void {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(puntos[0].x, puntos[0].y);
    for (let i = 1; i < puntos.length; i++) c.lineTo(puntos[i].x, puntos[i].y);
    c.closePath();
    c.fillStyle = color;
    c.fill();
  }

  private rellenarHuella(x: number, y: number, w: number, h: number, color: string): void {
    this.trazarRombo(this.ctx, x, y, w, h);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  private contornoHuella(x: number, y: number, w: number, h: number, color: string, pulso = false): void {
    const c = this.ctx;
    this.trazarRombo(c, x - 0.1, y - 0.1, w + 0.2, h + 0.2);
    c.strokeStyle = color;
    c.lineWidth = 2.5;
    c.globalAlpha = pulso ? 0.6 + 0.4 * Math.sin(this.reloj * 5) : 1;
    c.stroke();
    c.globalAlpha = 1;
  }

  /** Prisma isométrico. z0 = altura de la base, alto = altura del cuerpo (píxeles). */
  private caja(x: number, y: number, w: number, h: number, z0: number, alto: number, arriba: string, izq: string, der: string): void {
    const n = (z: number) => this.P(x, y, z), e = (z: number) => this.P(x + w, y, z);
    const s = (z: number) => this.P(x + w, y + h, z), o = (z: number) => this.P(x, y + h, z);
    const z1 = z0 + alto;
    this.poligono([o(z0), s(z0), s(z1), o(z1)], izq);
    this.poligono([s(z0), e(z0), e(z1), s(z1)], der);
    this.poligono([n(z1), e(z1), s(z1), o(z1)], arriba);
  }

  /** Tejado a cuatro aguas (pirámide). */
  private tejadoPiramide(x: number, y: number, w: number, h: number, z0: number, altoTejado: number, claro: string, oscuro: string): void {
    const n = this.P(x, y, z0), e = this.P(x + w, y, z0), s = this.P(x + w, y + h, z0), o = this.P(x, y + h, z0);
    const apice = this.P(x + w / 2, y + h / 2, z0 + altoTejado);
    this.poligono([n, e, apice], claro);
    this.poligono([n, o, apice], claro);
    this.poligono([o, s, apice], oscuro);
    this.poligono([s, e, apice], claro);
    this.ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    this.ctx.lineWidth = 1;
    this.linea(this.ctx, s, apice);
  }

  /** Tejado a dos aguas con la cumbrera paralela al eje X y frontón en el lado +X. */
  private tejadoDosAguas(x: number, y: number, w: number, h: number, z0: number, altoTejado: number, teja: string, tejaOscura: string, fronton: string): void {
    const n = this.P(x, y, z0), e = this.P(x + w, y, z0), s = this.P(x + w, y + h, z0), o = this.P(x, y + h, z0);
    const c1 = this.P(x, y + h / 2, z0 + altoTejado), c2 = this.P(x + w, y + h / 2, z0 + altoTejado);
    this.poligono([n, e, c2, c1], teja);
    this.poligono([o, s, c2, c1], tejaOscura);
    this.poligono([e, s, c2], fronton);
    // Tejas (líneas).
    this.ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    this.ctx.lineWidth = 1;
    for (let k = 1; k < w * 3; k++) {
      const t = k / (w * 3);
      this.linea(this.ctx, this.P(x + w * t, y + h, z0), this.P(x + w * t, y + h / 2, z0 + altoTejado));
    }
  }

  private columna(p: Vector2D, alto: number, ancho = 4): void {
    const c = this.ctx;
    c.fillStyle = PALETA.marmolSombra;
    c.fillRect(p.x - ancho / 2, p.y - alto, ancho, alto);
    c.fillStyle = PALETA.marmol;
    c.fillRect(p.x - ancho / 2, p.y - alto, ancho / 2, alto);
    c.fillStyle = PALETA.marmol;
    c.fillRect(p.x - ancho / 2 - 1, p.y - alto - 2, ancho + 2, 2);
  }

  /** Columnata a lo largo de las dos aristas frontales de un rectángulo. */
  private columnata(x: number, y: number, w: number, h: number, z0: number, alto: number, separacion = 0.5): void {
    const puntos: Vector2D[] = [];
    for (let t = 0; t <= w + 1e-6; t += separacion) puntos.push({ x: x + t, y: y + h });
    for (let t = h - separacion; t >= -1e-6; t -= separacion) puntos.push({ x: x + w, y: y + t });
    puntos.sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const q of puntos) this.columna(this.P(q.x, q.y, z0), alto);
  }

  private estandarte(x: number, y: number, z0: number, color: string): void {
    const c = this.ctx;
    const p = this.P(x, y, z0);
    c.strokeStyle = PALETA.bronce;
    c.lineWidth = 1.5;
    this.linea(c, p, { x: p.x, y: p.y - 22 });
    const ondea = Math.sin(this.reloj * 3 + x) * 1.5;
    this.poligono([{ x: p.x, y: p.y - 21 }, { x: p.x + 9, y: p.y - 20 + ondea }, { x: p.x + 9, y: p.y - 9 + ondea }, { x: p.x, y: p.y - 10 }], color);
    c.fillStyle = PALETA.oro;
    c.beginPath();
    c.arc(p.x, p.y - 23, 1.8, 0, Math.PI * 2);
    c.fill();
  }

  private antorcha(x: number, y: number, z: number): void {
    this.antorchas.push({ x, y, z: z + 6 });
    if (!this.fase.antorchas) return;
    const p = this.P(x, y, z);
    const c = this.ctx;
    c.strokeStyle = PALETA.maderaOscura;
    c.lineWidth = 1.5;
    this.linea(c, p, { x: p.x, y: p.y - 5 });
    const parpadeo = 1 + Math.sin(this.reloj * 14 + x * 7) * 0.25;
    c.fillStyle = '#FFD27A';
    c.beginPath();
    c.ellipse(p.x, p.y - 7, 1.6 * parpadeo, 3 * parpadeo, 0, 0, Math.PI * 2);
    c.fill();
  }

  private dibujarCipres(x: number, y: number, escala: number): void {
    const c = this.ctx;
    const p = this.P(x, y);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(p.x + 4, p.y, 7 * escala, 3 * escala, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = PALETA.maderaOscura;
    c.fillRect(p.x - 1, p.y - 4, 2, 4);
    const alto = 30 * escala;
    const ancho = 6 * escala;
    c.fillStyle = PALETA.cipres;
    c.beginPath();
    c.moveTo(p.x, p.y - alto - 4);
    c.quadraticCurveTo(p.x + ancho * 1.4, p.y - alto * 0.45, p.x, p.y - 3);
    c.quadraticCurveTo(p.x - ancho * 1.4, p.y - alto * 0.45, p.x, p.y - alto - 4);
    c.fill();
    c.fillStyle = '#33502A';
    c.beginPath();
    c.moveTo(p.x, p.y - alto - 3);
    c.quadraticCurveTo(p.x - ancho * 1.1, p.y - alto * 0.5, p.x - 0.5, p.y - 5);
    c.lineTo(p.x, p.y - alto - 3);
    c.fill();
  }

  // ───────────────────────── Edificios ─────────────────────────

  dibujarEdificio(e: EdificioDibujable): void {
    const def = EDIFICIOS[e.tipo];
    const { x, y } = e;
    const w = def.ancho, h = def.alto;
    const c = this.ctx;
    if (e.destruido) {
      this.dibujarEscombros(x, y, w, h);
      return;
    }
    // Sombra proyectada (según la elevación del sol).
    const sombra = Math.max(0.05, 0.25 * (1 - this.fase.oscuridad));
    this.rellenarHuella(x + 0.25, y + 0.15, w, h, `rgba(0,0,0,${sombra})`);

    if (e.translucido) c.globalAlpha = 0.55;
    const nv = e.nivel;
    switch (e.tipo) {
      case 'senado': {
        this.caja(x + 0.1, y + 0.1, w - 0.2, h - 0.2, 0, 8, PALETA.marmol, PALETA.marmolSombra, PALETA.marmolOscuro);
        this.caja(x + 0.8, y + 0.8, w - 1.6, h - 1.6, 8, 30, PALETA.marmol, '#D6D6D2', PALETA.marmolSombra);
        this.columnata(x + 0.35, y + 0.35, w - 0.7, h - 0.7, 8, 30, 0.55);
        this.caja(x + 0.3, y + 0.3, w - 0.6, h - 0.6, 38, 4, PALETA.marmol, PALETA.oro, PALETA.oroOscuro);
        this.tejadoDosAguas(x + 0.3, y + 0.3, w - 0.6, h - 0.6, 42, 14 + nv * 2, PALETA.terracota, PALETA.terracotaOscuro, PALETA.marmol);
        for (let i = 0; i < Math.min(nv, 4); i++) this.estandarte(x + 0.4 + i * 0.9, y + h - 0.05, 8, PALETA.purpura);
        this.antorcha(x + 0.1, y + h, 8);
        this.antorcha(x + w, y + 0.1, 8);
        if (nv >= 3) {
          const cima = this.P(x + w / 2, y + h / 2, 42 + 14 + nv * 2);
          c.fillStyle = PALETA.oro;
          c.beginPath();
          c.arc(cima.x, cima.y - 5, 4, 0, Math.PI * 2);
          c.fill();
        }
        break;
      }
      case 'foro': {
        this.caja(x + 0.1, y + 0.1, w - 0.2, h - 0.2, 0, 3, '#DCD8CC', PALETA.marmolSombra, PALETA.marmolOscuro);
        c.strokeStyle = 'rgba(0,0,0,0.12)';
        for (let k = 1; k < 6; k++) this.linea(c, this.P(x + 0.1 + (k * (w - 0.2)) / 6, y + 0.1, 3), this.P(x + 0.1 + (k * (w - 0.2)) / 6, y + h - 0.1, 3));
        this.columnata(x + 0.2, y + 0.2, w - 0.4, h - 0.4, 3, 16 + nv * 2, 0.7);
        // Estatua de oro en el centro.
        this.caja(x + 1.25, y + 1.25, 0.5, 0.5, 3, 7, PALETA.marmol, PALETA.marmolSombra, PALETA.marmolOscuro);
        const p = this.P(x + 1.5, y + 1.5, 10);
        c.fillStyle = PALETA.oro;
        c.fillRect(p.x - 2, p.y - 12, 4, 12);
        c.beginPath();
        c.arc(p.x, p.y - 14, 2.5, 0, Math.PI * 2);
        c.fill();
        // Puesto de recaudador con toldo púrpura.
        this.caja(x + 0.4, y + 1.9, 0.8, 0.6, 3, 6, PALETA.madera, PALETA.maderaOscura, PALETA.madera);
        this.tejadoPiramide(x + 0.3, y + 1.8, 1, 0.8, 9, 5, PALETA.purpura, PALETA.purpuraOscuro);
        break;
      }
      case 'cantera': {
        this.caja(x + 0.1, y + 0.1, w - 0.2, h - 0.2, 0, 4, '#A39C8E', PALETA.piedra, '#6E685D');
        this.rellenarHuellaZ(x + 0.5, y + 0.5, 1.5, 1.5, 4, '#5E594F');
        const bloques: [number, number, number][] = [[2.0, 0.3, 0], [2.0, 0.9, 0], [2.0, 0.6, 1], [0.3, 2.2, 0]];
        for (const [bx, by, capa] of bloques.slice(0, 2 + Math.min(2, nv))) {
          this.caja(x + bx, y + by, 0.6, 0.5, 4 + capa * 8, 8, PALETA.marmol, PALETA.marmolSombra, PALETA.marmolOscuro);
        }
        // Grúa de madera (polyspastos).
        const base = this.P(x + 0.6, y + 2.4, 4);
        c.strokeStyle = PALETA.madera;
        c.lineWidth = 2;
        this.linea(c, base, { x: base.x + 18, y: base.y - 34 });
        this.linea(c, { x: base.x + 8, y: base.y }, { x: base.x + 18, y: base.y - 34 });
        c.lineWidth = 1;
        c.strokeStyle = '#222';
        const balanceo = Math.sin(this.reloj * 1.5) * 3;
        this.linea(c, { x: base.x + 18, y: base.y - 34 }, { x: base.x + 22 + balanceo, y: base.y - 14 });
        break;
      }
      case 'latifundio': {
        this.rellenarHuella(x + 0.05, y + 0.05, w - 0.1, h - 0.1, '#8B6B3A');
        this.rellenarHuella(x + 0.15, y + 0.15, w - 0.3, h - 1.25, PALETA.trigo);
        c.strokeStyle = 'rgba(120,90,30,0.55)';
        c.lineWidth = 1;
        for (let k = 1; k < 8; k++) this.linea(c, this.P(x + 0.15 + (k * (w - 0.3)) / 8, y + 0.15), this.P(x + 0.15 + (k * (w - 0.3)) / 8, y + h - 1.1));
        // Espigas que se mecen.
        c.strokeStyle = '#E8CF7A';
        for (let k = 0; k < 18; k++) {
          const px = x + 0.3 + (k % 6) * 0.42, py = y + 0.3 + Math.floor(k / 6) * 0.5;
          const p = this.P(px, py);
          const viento = Math.sin(this.reloj * 2 + px) * 1.5;
          this.linea(c, p, { x: p.x + viento, y: p.y - 5 });
        }
        this.caja(x + 1.9, y + 2.0, 0.9, 0.8, 0, 10, '#E5D8B8', '#CDBF9A', '#B3A47E');
        this.tejadoPiramide(x + 1.85, y + 1.95, 1, 0.9, 10, 7, PALETA.terracota, PALETA.terracotaOscuro);
        break;
      }
      case 'templo': {
        this.caja(x + 0.05, y + 0.05, w - 0.1, h - 0.1, 0, 7, PALETA.marmol, PALETA.marmolSombra, PALETA.marmolOscuro);
        this.caja(x + 0.7, y + 0.7, w - 1.4, h - 1.4, 7, 20, '#EFEFEC', '#D9D9D4', PALETA.marmolSombra);
        this.columnata(x + 0.25, y + 0.25, w - 0.5, h - 0.5, 7, 20, 0.45);
        this.caja(x + 0.2, y + 0.2, w - 0.4, h - 0.4, 27, 3, PALETA.marmol, PALETA.oro, PALETA.oroOscuro);
        this.tejadoDosAguas(x + 0.2, y + 0.2, w - 0.4, h - 0.4, 30, 12, PALETA.terracota, PALETA.terracotaOscuro, PALETA.marmol);
        // Altar con llama perpetua.
        const altar = this.P(x + w - 0.1, y + h + 0.1, 7);
        c.fillStyle = PALETA.marmolSombra;
        c.fillRect(altar.x - 3, altar.y - 5, 6, 5);
        c.fillStyle = '#FF9F3A';
        c.beginPath();
        c.ellipse(altar.x, altar.y - 8, 2, 3.5 + Math.sin(this.reloj * 12) * 0.8, 0, 0, Math.PI * 2);
        c.fill();
        this.antorchas.push({ x: x + w, y: y + h, z: 12 });
        break;
      }
      case 'aerarium': {
        this.caja(x + 0.2, y + 0.2, w - 0.4, h - 0.4, 0, 6, PALETA.marmol, PALETA.marmolSombra, PALETA.marmolOscuro);
        this.caja(x + 0.35, y + 0.35, w - 0.7, h - 0.7, 6, 18 + nv, '#E2DED2', '#CFC9B8', '#B4AD99');
        this.tejadoPiramide(x + 0.25, y + 0.25, w - 0.5, h - 0.5, 24 + nv, 16, PALETA.terracota, PALETA.terracotaOscuro);
        // Escudo del tesoro (moneda) en la fachada.
        const f = this.P(x + w / 2, y + h - 0.35, 15);
        c.fillStyle = PALETA.oro;
        c.strokeStyle = PALETA.oroOscuro;
        c.lineWidth = 1.5;
        c.beginPath();
        c.ellipse(f.x - 6, f.y + 3, 6, 5, 0, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.fillStyle = PALETA.oroOscuro;
        c.font = 'bold 7px Cinzel, serif';
        c.textAlign = 'center';
        c.fillText('SPQR', f.x - 6, f.y + 5.5);
        // Puerta de bronce.
        this.poligono([this.P(x + 2.3, y + h - 0.35, 6), this.P(x + w - 0.35, y + 2.0, 6), this.P(x + w - 0.35, y + 2.0, 18), this.P(x + 2.3, y + h - 0.35, 18)], PALETA.bronce);
        break;
      }
      case 'lapidarium': {
        this.caja(x + 0.1, y + 0.1, w - 0.2, h - 0.2, 0, 3, '#BDB6A6', PALETA.piedra, '#6E685D');
        const pilas = 3 + nv;
        for (let k = 0; k < pilas; k++) {
          const bx = x + 0.3 + (k % 3) * 0.85, by = y + 0.3 + Math.floor(k / 3) * 1.2;
          const alturaPila = 1 + ((k * 7) % 3);
          for (let l = 0; l < alturaPila; l++) this.caja(bx, by, 0.7, 0.9, 3 + l * 7, 7, PALETA.marmol, PALETA.marmolSombra, PALETA.marmolOscuro);
        }
        break;
      }
      case 'horreum': {
        this.caja(x + 0.2, y + 0.4, w - 0.4, h - 0.8, 0, 4, PALETA.piedra, '#6E685D', '#5E594F');
        this.caja(x + 0.25, y + 0.45, w - 0.5, h - 0.9, 4, 16 + nv, '#E2CFA2', '#C9B486', '#AF9C70');
        this.tejadoDosAguas(x + 0.15, y + 0.35, w - 0.3, h - 0.7, 20 + nv, 14, PALETA.terracota, PALETA.terracotaOscuro, '#E2CFA2');
        // Sacos de trigo.
        for (let k = 0; k < 3; k++) {
          const p = this.P(x + 0.6 + k * 0.6, y + h - 0.2, 0);
          c.fillStyle = '#D8C089';
          c.beginPath();
          c.ellipse(p.x, p.y - 4, 4, 5, 0, 0, Math.PI * 2);
          c.fill();
        }
        break;
      }
      case 'castra': {
        // Empalizada.
        const z = 10;
        this.caja(x + 0.05, y + 0.05, w - 0.1, 0.15, 0, z, PALETA.madera, PALETA.maderaOscura, PALETA.madera);
        this.caja(x + 0.05, y + 0.05, 0.15, h - 0.1, 0, z, PALETA.madera, PALETA.maderaOscura, PALETA.madera);
        this.rellenarHuella(x + 0.2, y + 0.2, w - 0.4, h - 0.4, '#8E7B55');
        const tiendas: [number, number][] = [[0.4, 0.4], [1.6, 0.4], [0.4, 1.6]];
        for (const [tx, ty] of tiendas.slice(0, 1 + nv)) this.tejadoPiramide(x + tx, y + ty, 0.9, 0.9, 0, 16, '#EDE3CF', '#C9BCA0');
        this.caja(x + 1.6, y + 1.6, 1, 1, 0, 10, PALETA.marmol, PALETA.marmolSombra, PALETA.marmolOscuro);
        this.tejadoPiramide(x + 1.55, y + 1.55, 1.1, 1.1, 10, 9, PALETA.terracota, PALETA.terracotaOscuro);
        this.caja(x + 0.05, y + h - 0.2, w - 0.1, 0.15, 0, z, PALETA.madera, PALETA.maderaOscura, PALETA.madera);
        this.caja(x + w - 0.2, y + 0.05, 0.15, h - 0.1, 0, z, PALETA.madera, PALETA.maderaOscura, PALETA.madera);
        this.estandarte(x + w - 0.1, y + h - 0.1, z, PALETA.purpura);
        this.antorcha(x + 0.1, y + h - 0.1, z);
        break;
      }
      case 'torre': {
        const alto = def.alturaVisual - 6 + nv * 3;
        this.caja(x + 0.2, y + 0.2, w - 0.4, h - 0.4, 0, alto, '#D9D5C8', '#C4BEAD', '#A69F8C');
        // Hiladas de sillería.
        c.strokeStyle = 'rgba(0,0,0,0.12)';
        for (let k = 8; k < alto; k += 8) {
          this.linea(c, this.P(x + 0.2, y + h - 0.2, k), this.P(x + w - 0.2, y + h - 0.2, k));
          this.linea(c, this.P(x + w - 0.2, y + h - 0.2, k), this.P(x + w - 0.2, y + 0.2, k));
        }
        this.caja(x + 0.1, y + 0.1, w - 0.2, h - 0.2, alto, 4, PALETA.marmol, PALETA.marmolSombra, PALETA.marmolOscuro);
        // Almenas.
        for (const [ax, ay] of [[0.1, 0.1], [w - 0.45, 0.1], [0.1, h - 0.45], [w - 0.45, h - 0.45], [w / 2 - 0.17, h - 0.45], [w - 0.45, h / 2 - 0.17]] as const) {
          this.caja(x + ax, y + ay, 0.35, 0.35, alto + 4, 6, PALETA.marmol, PALETA.marmolSombra, PALETA.marmolOscuro);
        }
        // Arquero.
        const a = this.P(x + w / 2, y + h / 2, alto + 4);
        c.fillStyle = PALETA.terracota;
        c.fillRect(a.x - 2, a.y - 9, 4, 7);
        c.fillStyle = '#9A9A9A';
        c.beginPath();
        c.arc(a.x, a.y - 11, 2.5, 0, Math.PI * 2);
        c.fill();
        this.antorcha(x + w - 0.1, y + h - 0.1, alto + 4);
        break;
      }
      case 'balista': {
        this.caja(x + 0.2, y + 0.2, w - 0.4, h - 0.4, 0, 8, '#BDB6A6', PALETA.piedra, '#6E685D');
        const centro = this.P(x + w / 2, y + h / 2, 8);
        c.strokeStyle = PALETA.madera;
        c.lineWidth = 3;
        this.linea(c, { x: centro.x - 14, y: centro.y - 6 }, { x: centro.x + 14, y: centro.y - 6 });
        c.lineWidth = 2;
        c.strokeStyle = PALETA.maderaOscura;
        this.linea(c, { x: centro.x, y: centro.y + 2 }, { x: centro.x + 4, y: centro.y - 18 });
        c.strokeStyle = '#ddd';
        c.lineWidth = 1;
        this.linea(c, { x: centro.x - 14, y: centro.y - 6 }, { x: centro.x + 2, y: centro.y - 2 });
        this.linea(c, { x: centro.x + 14, y: centro.y - 6 }, { x: centro.x + 2, y: centro.y - 2 });
        c.fillStyle = PALETA.bronce;
        c.fillRect(centro.x - 3, centro.y - 8, 6, 5);
        break;
      }
      case 'muralla': {
        const alto = 10 + nv * 2;
        const tonos = nv >= 3 ? [PALETA.marmol, PALETA.marmolSombra, PALETA.marmolOscuro] : ['#CFC6B0', '#B0A68E', '#958B74'];
        this.caja(x + 0.08, y + 0.08, 0.84, 0.84, 0, alto, tonos[0], tonos[1], tonos[2]);
        if (nv >= 2) this.caja(x + 0.3, y + 0.3, 0.4, 0.4, alto, 4, tonos[0], tonos[1], tonos[2]);
        break;
      }
    }
    c.globalAlpha = 1;

    if (e.progresoObra != null) this.dibujarAndamio(x, y, w, h, def.alturaVisual, e.progresoObra);
    if (e.vida != null) this.barraVida(this.P(x + w / 2, y + h / 2, def.alturaVisual + 18), 28, e.vida, '#5FBF4A');
  }

  private rellenarHuellaZ(x: number, y: number, w: number, h: number, z: number, color: string): void {
    this.trazarRombo(this.ctx, x, y, w, h, z);
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  private dibujarAndamio(x: number, y: number, w: number, h: number, alto: number, progreso: number): void {
    const c = this.ctx;
    c.strokeStyle = '#A0743F';
    c.lineWidth = 1.5;
    const esquinas = [this.P(x, y + h), this.P(x + w, y + h), this.P(x + w, y)];
    for (const p of esquinas) this.linea(c, p, { x: p.x, y: p.y - alto - 6 });
    for (let k = 10; k < alto; k += 12) {
      this.linea(c, this.P(x, y + h, k), this.P(x + w, y + h, k));
      this.linea(c, this.P(x + w, y + h, k), this.P(x + w, y, k));
    }
    this.barraVida(this.P(x + w / 2, y + h / 2, alto + 22), 40, progreso, PALETA.oro);
  }

  private barraVida(p: Vector2D, ancho: number, fraccion: number, color: string): void {
    const c = this.ctx;
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(p.x - ancho / 2 - 1, p.y - 1, ancho + 2, 5);
    c.fillStyle = fraccion < 0.35 && color !== PALETA.oro ? '#D9472B' : color;
    c.fillRect(p.x - ancho / 2, p.y, ancho * Math.max(0, Math.min(1, fraccion)), 3);
  }

  private dibujarEscombros(x: number, y: number, w: number, h: number): void {
    this.rellenarHuella(x + 0.1, y + 0.1, w - 0.2, h - 0.2, '#4A4436');
    const rnd = mulberry32(x * 131 + y * 7);
    const n = Math.max(2, Math.round(w * h * 1.2));
    for (let k = 0; k < n; k++) {
      const bx = x + 0.15 + rnd() * (w - 0.6), by = y + 0.15 + rnd() * (h - 0.6);
      this.caja(bx, by, 0.3 + rnd() * 0.2, 0.3, 0, 3 + rnd() * 4, '#9A9284', '#7C7568', '#635D52');
    }
  }

  // ───────────────────────── Unidades ─────────────────────────

  private dibujarUnidad(u: UnidadCombate): void {
    const c = this.ctx;
    const p = this.P(u.x, u.y);
    const def = UNIDADES[u.tipo];
    const anda = u.atacando ? Math.abs(Math.sin(this.reloj * 10 + u.id)) * 2 : Math.abs(Math.sin(this.reloj * 12 + u.id)) * 1.5;
    const mira = Math.cos(u.orientacion - Math.PI / 4) >= 0 ? 1 : -1; // hacia la derecha de pantalla
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath();
    c.ellipse(p.x, p.y, u.tipo === 'equites' || u.tipo === 'ariete' || u.tipo === 'onagro' ? 10 : 5, 3, 0, 0, Math.PI * 2);
    c.fill();
    const by = p.y - anda;
    this.dibujarFiguraUnidad(c, u.tipo, p.x, by, mira, u.enTestudo, u.atacando);
    if (u.hp < u.hpMax) this.barraVida({ x: p.x, y: by - (def.espacio >= 4 ? 30 : 22) }, 16, u.hp / u.hpMax, '#5FBF4A');
  }

  /** Figura de unidad (también reutilizada para iconos de la interfaz). */
  dibujarFiguraUnidad(c: CanvasRenderingContext2D, tipo: TipoUnidad, x: number, y: number, mira: number, testudo = false, atacando = false): void {
    switch (tipo) {
      case 'legionario': {
        c.fillStyle = PALETA.terracota;
        c.fillRect(x - 3, y - 12, 6, 8);
        c.fillStyle = '#6B5A45';
        c.fillRect(x - 3, y - 4, 2, 4);
        c.fillRect(x + 1, y - 4, 2, 4);
        c.fillStyle = '#A8A8A8';
        c.beginPath();
        c.arc(x, y - 15, 3, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = PALETA.terracota;
        c.fillRect(x - 1, y - 20, 2, 3);
        if (testudo) {
          c.fillStyle = PALETA.purpura;
          c.fillRect(x - 6, y - 21, 12, 4);
          c.strokeStyle = PALETA.oro;
          c.lineWidth = 1;
          c.strokeRect(x - 6, y - 21, 12, 4);
        } else {
          c.fillStyle = PALETA.purpura;
          c.fillRect(x + mira * 2 - (mira > 0 ? 0 : 5), y - 13, 5, 9);
          c.fillStyle = PALETA.oro;
          c.fillRect(x + mira * 4 - 1, y - 10, 2, 2);
        }
        if (atacando) {
          c.strokeStyle = '#E0E0E0';
          c.lineWidth = 1.5;
          this.linea(c, { x: x - mira * 2, y: y - 9 }, { x: x - mira * 8, y: y - 14 });
        }
        break;
      }
      case 'velite': {
        c.fillStyle = '#C9B48A';
        c.fillRect(x - 2.5, y - 11, 5, 7);
        c.fillStyle = '#6B5A45';
        c.fillRect(x - 2, y - 4, 1.5, 4);
        c.fillRect(x + 0.5, y - 4, 1.5, 4);
        c.fillStyle = '#D2A77A';
        c.beginPath();
        c.arc(x, y - 13.5, 2.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#5B3A20';
        c.fillRect(x - 2.5, y - 16.5, 5, 2);
        c.strokeStyle = PALETA.maderaOscura;
        c.lineWidth = 1.2;
        c.beginPath();
        c.arc(x + mira * 3, y - 9, 6, mira > 0 ? -Math.PI / 2 : Math.PI / 2, mira > 0 ? Math.PI / 2 : (3 * Math.PI) / 2);
        c.stroke();
        break;
      }
      case 'equites': {
        c.fillStyle = '#6A4426';
        c.beginPath();
        c.ellipse(x, y - 8, 9, 4.5, 0, 0, Math.PI * 2);
        c.fill();
        c.fillRect(x - 7, y - 6, 2, 6);
        c.fillRect(x + 5, y - 6, 2, 6);
        c.beginPath();
        c.ellipse(x + mira * 9, y - 13, 3, 5, mira * 0.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = PALETA.purpura;
        c.fillRect(x - 2.5, y - 20, 5, 8);
        c.fillStyle = '#B0B0B0';
        c.beginPath();
        c.arc(x, y - 22, 2.8, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = PALETA.oro;
        c.fillRect(x - 1, y - 27, 2, 3);
        break;
      }
      case 'ariete': {
        c.fillStyle = PALETA.maderaOscura;
        c.fillRect(x - 11, y - 4, 4, 4);
        c.fillRect(x + 7, y - 4, 4, 4);
        c.fillStyle = PALETA.madera;
        c.fillRect(x - 12, y - 14, 24, 10);
        c.fillStyle = PALETA.terracota;
        c.beginPath();
        c.moveTo(x - 13, y - 14);
        c.lineTo(x, y - 24);
        c.lineTo(x + 13, y - 14);
        c.fill();
        const golpe = atacando ? Math.sin(this.reloj * 8) * 3 : 0;
        c.fillStyle = PALETA.bronce;
        c.fillRect(x + mira * (12 + golpe) - (mira > 0 ? 0 : 6), y - 11, 6, 4);
        break;
      }
      case 'onagro': {
        c.fillStyle = PALETA.maderaOscura;
        c.fillRect(x - 10, y - 3, 3, 3);
        c.fillRect(x + 7, y - 3, 3, 3);
        c.fillStyle = PALETA.madera;
        c.fillRect(x - 11, y - 7, 22, 4);
        c.fillRect(x - 2, y - 16, 4, 9);
        const brazo = atacando ? -0.4 + Math.sin(this.reloj * 2) * 0.6 : -0.9;
        c.strokeStyle = PALETA.madera;
        c.lineWidth = 2.5;
        this.linea(c, { x, y: y - 8 }, { x: x - mira * Math.cos(brazo) * 14, y: y - 8 + Math.sin(brazo) * 14 });
        break;
      }
    }
  }

  private dibujarProyectil(tipo: string, pos: { x: number; y: number; z: number }, prev: { x: number; y: number; z: number }): void {
    const c = this.ctx;
    const suelo = this.P(pos.x, pos.y);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.ellipse(suelo.x, suelo.y, tipo === 'piedra' ? 5 : 2.5, tipo === 'piedra' ? 2.5 : 1.2, 0, 0, Math.PI * 2);
    c.fill();
    const a = this.P(pos.x, pos.y, pos.z * ALTURA_Z);
    if (tipo === 'piedra') {
      c.fillStyle = '#8C8577';
      c.beginPath();
      c.arc(a.x, a.y, 4.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#B5AE9F';
      c.beginPath();
      c.arc(a.x - 1.5, a.y - 1.5, 1.8, 0, Math.PI * 2);
      c.fill();
      return;
    }
    const b = this.P(prev.x, prev.y, prev.z * ALTURA_Z);
    const ang = Math.atan2(a.y - b.y, a.x - b.x);
    const largo = tipo === 'virote' ? 12 : 8;
    c.strokeStyle = tipo === 'virote' ? PALETA.maderaOscura : '#5B3A20';
    c.lineWidth = tipo === 'virote' ? 2 : 1.2;
    this.linea(c, a, { x: a.x - Math.cos(ang) * largo, y: a.y - Math.sin(ang) * largo });
  }

  // ───────────────────────── Partículas ─────────────────────────

  procesarEventos(eventos: EventoCombate[]): void {
    for (const ev of eventos) {
      if (ev.tipo === 'impacto' && ev.proyectil === 'piedra') this.emitir(ev.x, ev.y, 18, ['#8C8577', '#B5AE9F', '#6E685D'], 3.5, ev.radio);
      else if (ev.tipo === 'destruido') this.emitir(ev.x, ev.y, 30, ['#9A9284', '#C9C0AE', '#4A4436', '#FF9F3A'], 4, 1.2);
      else if (ev.tipo === 'golpe') this.emitir(ev.x, ev.y, 2, ['#E8E8E6', '#BDBDB8'], 1.5, 0.4);
      else if (ev.tipo === 'baja') this.emitir(ev.x, ev.y, 6, ['#8E2A1F', '#6A0DAD'], 1.5, 0.2);
      else if (ev.tipo === 'despliegue') this.emitir(ev.x, ev.y, 8, [PALETA.oro, '#FFF2B3'], 2, 0.2);
    }
  }

  private emitir(x: number, y: number, n: number, colores: string[], fuerza: number, dispersion: number): void {
    for (let k = 0; k < n; k++) {
      const ang = Math.random() * Math.PI * 2;
      const v = Math.random() * fuerza * 0.6;
      this.particulas.push({
        x: x + Math.cos(ang) * dispersion * Math.random(),
        y: y + Math.sin(ang) * dispersion * Math.random(),
        z: 0.1,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v,
        vz: fuerza * (0.4 + Math.random() * 0.6),
        vida: 0,
        vidaMax: 0.6 + Math.random() * 0.6,
        color: colores[k % colores.length],
        tamano: 1.5 + Math.random() * 2.5,
        gravedad: 9,
      });
    }
    if (this.particulas.length > 600) this.particulas.splice(0, this.particulas.length - 600);
  }

  private actualizarParticulas(): void {
    const dt = 1 / 60;
    const c = this.ctx;
    this.particulas = this.particulas.filter((p) => (p.vida += dt) < p.vidaMax);
    for (const p of this.particulas) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vz -= p.gravedad * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      const q = this.P(p.x, p.y, p.z * ALTURA_Z);
      c.globalAlpha = 1 - p.vida / p.vidaMax;
      c.fillStyle = p.color;
      c.fillRect(q.x - p.tamano / 2, q.y - p.tamano / 2, p.tamano, p.tamano);
    }
    c.globalAlpha = 1;
  }
}
