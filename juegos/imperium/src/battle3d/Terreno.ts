/**
 * Terreno deformable: malla de alturas que se hunde bajo caligae, cascos y ruedas, y una
 * textura de color pintada en tiempo real (surcos de barro, charcos de sangre).
 */
import * as THREE from 'three';
import type { Weather } from '../engine/HardcoreCombatEngine';

const PX_POR_METRO = 4;

function ruido2D(semilla: number) {
  // Ruido de valor suave (interpolación coseno sobre una rejilla pseudoaleatoria).
  const h = (x: number, z: number) => {
    const s = Math.sin(x * 127.1 + z * 311.7 + semilla * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const suave = (t: number) => t * t * (3 - 2 * t);
  return (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = suave(x - ix), fz = suave(z - iz);
    const a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}

export class Terreno {
  readonly tamano: number;
  readonly segmentos: number;
  readonly malla: THREE.Mesh;
  private readonly base: Float32Array;
  private readonly hundimiento: Float32Array;
  private readonly geometria: THREE.PlaneGeometry;
  private readonly lienzo: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly textura: THREE.CanvasTexture;
  private readonly material: THREE.MeshStandardMaterial;
  private sucio = false;
  private texturaSucia = false;
  private ultimaGeo = 0;
  private ultimaTex = 0;
  private readonly ruido = ruido2D(7);

  constructor(tamano: number, private readonly clima: Weather) {
    this.tamano = tamano + 80; // margen alrededor del campo de batalla
    this.segmentos = 200;
    const n = this.segmentos + 1;
    this.base = new Float32Array(n * n);
    this.hundimiento = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = (i / this.segmentos - 0.5) * this.tamano;
        const z = (j / this.segmentos - 0.5) * this.tamano;
        this.base[j * n + i] = this.alturaBase(x, z);
      }
    }
    this.geometria = new THREE.PlaneGeometry(this.tamano, this.tamano, this.segmentos, this.segmentos);
    this.geometria.rotateX(-Math.PI / 2);
    this.volcarAlturas();

    this.lienzo = document.createElement('canvas');
    this.lienzo.width = this.lienzo.height = Math.min(2048, Math.round(this.tamano * PX_POR_METRO));
    this.ctx = this.lienzo.getContext('2d')!;
    this.pintarBase();
    this.textura = new THREE.CanvasTexture(this.lienzo);
    this.textura.colorSpace = THREE.SRGBColorSpace;
    this.textura.anisotropy = 8;

    const mojado = clima === 'rain';
    this.material = new THREE.MeshStandardMaterial({
      map: this.textura,
      roughness: mojado ? 0.78 : 0.96,
      metalness: 0,
      // El barro apenas refleja el cielo (si no, parece nieve a contraluz).
      envMapIntensity: mojado ? 0.12 : 0.05,
      bumpMap: this.crearRelieve(),
      bumpScale: 2.5,
    });
    this.malla = new THREE.Mesh(this.geometria, this.material);
    this.malla.receiveShadow = true;
  }

  /** Colinas suaves en los bordes, llanura embarrada en el centro. */
  private alturaBase(x: number, z: number): number {
    const r = Math.hypot(x, z) / (this.tamano / 2);
    const colinas = (this.ruido(x / 38, z / 38) - 0.5) * 7 + (this.ruido(x / 12, z / 12) - 0.5) * 1.2;
    const borde = Math.max(0, r - 0.55) * 22;
    return colinas * (0.25 + Math.min(1, r)) + borde + (this.ruido(x / 3, z / 3) - 0.5) * 0.12;
  }

  alturaEn(x: number, z: number): number {
    const s = this.segmentos;
    const fx = (x / this.tamano + 0.5) * s;
    const fz = (z / this.tamano + 0.5) * s;
    const i = Math.max(0, Math.min(s - 1, Math.floor(fx)));
    const j = Math.max(0, Math.min(s - 1, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j));
    const n = s + 1;
    const h = (a: number, b: number) => this.base[b * n + a] - this.hundimiento[b * n + a];
    const h0 = h(i, j) + (h(i + 1, j) - h(i, j)) * tx;
    const h1 = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * tx;
    return h0 + (h1 - h0) * tz;
  }

  /** Multiplicador de velocidad por la profundidad del barro. */
  velocidadSuelo(x: number, z: number): number {
    const s = this.segmentos;
    const i = Math.round((x / this.tamano + 0.5) * s);
    const j = Math.round((z / this.tamano + 0.5) * s);
    const prof = this.hundimiento[Math.max(0, Math.min(s, j)) * (s + 1) + Math.max(0, Math.min(s, i))] ?? 0;
    const factorBarro = this.clima === 'rain' ? 1.6 : 0.6;
    return 1 - Math.min(0.3, prof * factorBarro * 2.2);
  }

  /** Una pisada: hunde el terreno y oscurece el barro. `peso` 1 = legionario, 6 = caballo, 20 = onagro. */
  pisar(x: number, z: number, peso: number): void {
    const s = this.segmentos;
    const i = Math.round((x / this.tamano + 0.5) * s);
    const j = Math.round((z / this.tamano + 0.5) * s);
    if (i < 1 || j < 1 || i >= s || j >= s) return;
    const n = s + 1;
    const blando = this.clima === 'rain' ? 2.2 : this.clima === 'fog' ? 1.3 : 0.7;
    const k = j * n + i;
    const max = 0.08 + 0.1 * blando;
    this.hundimiento[k] = Math.min(max, this.hundimiento[k] + 0.0009 * peso * blando);
    // Los bordes del surco se levantan ligeramente (el barro desplazado).
    for (const v of [k - 1, k + 1, k - n, k + n]) this.hundimiento[v] = Math.max(-0.03, this.hundimiento[v] - 0.00015 * peso * blando);
    this.sucio = true;

    const px = (x / this.tamano + 0.5) * this.lienzo.width;
    const pz = (z / this.tamano + 0.5) * this.lienzo.height;
    this.ctx.fillStyle = this.clima === 'rain' ? 'rgba(42,32,24,0.10)' : 'rgba(60,46,36,0.07)';
    const r = peso > 4 ? 1.6 : 0.9;
    this.ctx.fillRect(px - r, pz - r, r * 2, r * 2);
    this.texturaSucia = true;
  }

  manchaSangre(x: number, z: number, radio: number, intensidad = 1): void {
    const px = (x / this.tamano + 0.5) * this.lienzo.width;
    const pz = (z / this.tamano + 0.5) * this.lienzo.height;
    const r = radio * PX_POR_METRO * (this.lienzo.width / (this.tamano * PX_POR_METRO));
    const g = this.ctx.createRadialGradient(px, pz, 0, px, pz, r);
    g.addColorStop(0, `rgba(75,6,4,${0.75 * intensidad})`);
    g.addColorStop(0.6, `rgba(95,10,6,${0.45 * intensidad})`);
    g.addColorStop(1, 'rgba(90,10,6,0)');
    this.ctx.fillStyle = g;
    this.ctx.beginPath();
    // Forma irregular.
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const rr = r * (0.6 + Math.random() * 0.5);
      if (k === 0) this.ctx.moveTo(px + Math.cos(a) * rr, pz + Math.sin(a) * rr);
      else this.ctx.lineTo(px + Math.cos(a) * rr, pz + Math.sin(a) * rr);
    }
    this.ctx.fill();
    this.texturaSucia = true;
  }

  crater(x: number, z: number): void {
    const s = this.segmentos;
    const n = s + 1;
    const ci = Math.round((x / this.tamano + 0.5) * s);
    const cj = Math.round((z / this.tamano + 0.5) * s);
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 1 || j < 1 || i >= s || j >= s) continue;
        const d = Math.hypot(di, dj);
        if (d <= 2.2) this.hundimiento[j * n + i] += 0.12 * (1 - d / 2.4);
      }
    }
    this.sucio = true;
    const px = (x / this.tamano + 0.5) * this.lienzo.width;
    const pz = (z / this.tamano + 0.5) * this.lienzo.height;
    this.ctx.fillStyle = 'rgba(35,28,22,0.55)';
    this.ctx.beginPath();
    this.ctx.arc(px, pz, 2.2 * PX_POR_METRO * (this.lienzo.width / (this.tamano * PX_POR_METRO)), 0, Math.PI * 2);
    this.ctx.fill();
    this.texturaSucia = true;
  }

  /** Vuelca los cambios a la GPU con moderación (la malla tiene 40.000 vértices). */
  actualizar(ahora: number): void {
    if (this.sucio && ahora - this.ultimaGeo > 400) {
      this.ultimaGeo = ahora;
      this.sucio = false;
      this.volcarAlturas();
    }
    if (this.texturaSucia && ahora - this.ultimaTex > 250) {
      this.ultimaTex = ahora;
      this.texturaSucia = false;
      this.textura.needsUpdate = true;
    }
  }

  private volcarAlturas(): void {
    const pos = this.geometria.attributes.position as THREE.BufferAttribute;
    const n = this.segmentos + 1;
    // PlaneGeometry rotada: los vértices recorren filas de -z a +z ya rotadas; recalculamos por coordenadas.
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), z = pos.getZ(k);
      const i = Math.round((x / this.tamano + 0.5) * this.segmentos);
      const j = Math.round((z / this.tamano + 0.5) * this.segmentos);
      const idx = j * n + i;
      pos.setY(k, this.base[idx] - this.hundimiento[idx]);
    }
    pos.needsUpdate = true;
    this.geometria.computeVertexNormals();
  }

  private pintarBase(): void {
    const c = this.ctx;
    const w = this.lienzo.width;
    const img = c.createImageData(w, w);
    const mojado = this.clima === 'rain';
    for (let py = 0; py < w; py++) {
      for (let px = 0; px < w; px++) {
        const x = (px / w - 0.5) * this.tamano;
        const z = (py / w - 0.5) * this.tamano;
        const n1 = this.ruido(x / 9, z / 9);
        const n2 = this.ruido(x / 2.2, z / 2.2);
        const n3 = this.ruido(x * 1.3, z * 1.3);
        // Más barro en el centro (campo pisoteado) y en la calzada.
        const centro = 1 - Math.min(1, Math.hypot(x, z * 1.4) / 110);
        const calzada = Math.abs(x - Math.sin(z / 40) * 8) < 3.2 && z < -40 ? 1 : 0;
        const barro = Math.min(1, Math.max(0, n1 * 0.9 + centro * 0.55 - 0.35 + calzada));
        // Hierba seca y apagada / barro de calzada (#4A3B32).
        let r = 72 + n2 * 22, g = 78 + n2 * 20, b = 44 + n2 * 12;
        const br = 74 + n3 * 18, bg = 59 + n3 * 14, bb = 50 + n3 * 10;
        r += (br - r) * barro;
        g += (bg - g) * barro;
        b += (bb - b) * barro;
        if (calzada) {
          // Losas de la vía: piedra caliza gastada.
          const losa = (Math.floor(x / 0.9) + Math.floor(z / 0.6)) % 2 ? 0.92 : 1;
          r = (118 + n3 * 25) * losa; g = (112 + n3 * 22) * losa; b = (100 + n3 * 18) * losa;
        }
        const osc = mojado ? 0.72 : 1;
        const k = (py * w + px) * 4;
        img.data[k] = r * osc;
        img.data[k + 1] = g * osc;
        img.data[k + 2] = b * osc;
        img.data[k + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    if (mojado) {
      // Charcos.
      for (let k = 0; k < 140; k++) {
        const x = (Math.random() - 0.5) * this.tamano * 0.8, z = (Math.random() - 0.5) * this.tamano * 0.8;
        const px = (x / this.tamano + 0.5) * w, pz = (z / this.tamano + 0.5) * w;
        c.fillStyle = 'rgba(40,46,52,0.45)';
        c.beginPath();
        c.ellipse(px, pz, 4 + Math.random() * 14, 2 + Math.random() * 7, Math.random() * 3, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  private crearRelieve(): THREE.Texture {
    const t = 256;
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = t;
    const c = lienzo.getContext('2d')!;
    const img = c.createImageData(t, t);
    for (let k = 0; k < t * t; k++) {
      const v = 110 + Math.random() * 60;
      img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = v;
      img.data[k * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(lienzo);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(this.tamano / 3, this.tamano / 3);
    return tex;
  }
}
