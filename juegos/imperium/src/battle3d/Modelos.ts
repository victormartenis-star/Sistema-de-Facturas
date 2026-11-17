/**
 * Geometrías y materiales PBR procedurales (sin archivos externos).
 * Cada pieza es una geometría fusionada que se dibuja con InstancedMesh.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Paleta cruda de campaña. */
export const COLOR = {
  hierro: 0x2f3538,
  acero: 0x6b7378,
  bronce: 0x7a5a2e,
  sangre: 0x8b0000,
  sangreSeca: 0x4a0a06,
  barro: 0x4a3b32,
  rojoPompeyano: 0x6e1e18,
  lino: 0x9c917c,
  cuero: 0x4b3424,
  madera: 0x5a4330,
  maderaMojada: 0x3b2d22,
  piel: 0xa77a5c,
  caballo: 0x3d2a1e,
};

function lienzo(t: number, pintar: (c: CanvasRenderingContext2D, t: number) => void): THREE.CanvasTexture {
  const l = document.createElement('canvas');
  l.width = l.height = t;
  const c = l.getContext('2d')!;
  pintar(c, t);
  const tex = new THREE.CanvasTexture(l);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function ruidoGrano(c: CanvasRenderingContext2D, t: number, base: number, amp: number): void {
  const img = c.createImageData(t, t);
  for (let k = 0; k < t * t; k++) {
    const v = base + (Math.random() - 0.5) * amp;
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = v;
    img.data[k * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}

/** Texturas de rugosidad/relieve compartidas: hierro picado, cuero curtido, madera veteada. */
export function crearMateriales(mojado: boolean) {
  const oxido = lienzo(128, (c, t) => {
    ruidoGrano(c, t, 150, 90);
    for (let k = 0; k < 60; k++) {
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.25})`;
      c.beginPath();
      c.arc(Math.random() * t, Math.random() * t, Math.random() * 6, 0, Math.PI * 2);
      c.fill();
    }
  });
  const veta = lienzo(128, (c, t) => {
    ruidoGrano(c, t, 128, 30);
    for (let y = 0; y < t; y += 3) {
      c.strokeStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.2})`;
      c.beginPath();
      c.moveTo(0, y + Math.random() * 2);
      c.bezierCurveTo(t / 3, y + Math.random() * 4, (2 * t) / 3, y - Math.random() * 4, t, y);
      c.stroke();
    }
  });
  const tejido = lienzo(64, (c, t) => {
    ruidoGrano(c, t, 140, 50);
    c.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let k = 0; k < t; k += 2) {
      c.beginPath();
      c.moveTo(k, 0);
      c.lineTo(k, t);
      c.stroke();
    }
  });
  const humedad = mojado ? 0.65 : 1;
  return {
    // Las piezas usan color por instancia (setColorAt): el material lleva el blanco base.
    metal: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.85, roughness: 0.55 * humedad, roughnessMap: oxido, bumpMap: oxido, bumpScale: 0.6 }),
    tela: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.92 * humedad, bumpMap: tejido, bumpScale: 0.4, envMapIntensity: 0.35 }),
    cuero: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.05, roughness: 0.7 * humedad, bumpMap: oxido, bumpScale: 0.3 }),
    madera: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.85 * humedad, map: veta, bumpMap: veta, bumpScale: 0.8, envMapIntensity: 0.4 }),
    piel: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0, roughness: 0.75, envMapIntensity: 0.4 }),
  };
}

const caja = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cilindro = (r1: number, r2: number, h: number, seg: number, x = 0, y = 0, z = 0) =>
  new THREE.CylinderGeometry(r1, r2, h, seg).translate(x, y, z);

/** Cuerpo humano (piernas + torso + brazos), origen en los pies, mirando a +Z. */
export function geoCuerpo(): THREE.BufferGeometry {
  return mergeGeometries([
    caja(0.13, 0.82, 0.16, -0.1, 0.41, 0),
    caja(0.13, 0.82, 0.16, 0.1, 0.41, 0),
    caja(0.44, 0.62, 0.27, 0, 1.12, 0),
    caja(0.12, 0.55, 0.13, -0.29, 1.12, 0.02),
    caja(0.12, 0.55, 0.13, 0.29, 1.12, 0.02),
    cilindro(0.07, 0.08, 0.1, 6, 0, 1.47, 0),
  ])!;
}

export const geoCabeza = () => new THREE.SphereGeometry(0.125, 10, 8).translate(0, 1.6, 0);

/** Casco romano (galea) con guardanuca y cimera. */
export function geoCascoRomano(): THREE.BufferGeometry {
  const cupula = new THREE.SphereGeometry(0.145, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.62, 0);
  const nuca = caja(0.26, 0.05, 0.1, 0, 1.6, -0.14).rotateX(0);
  const cimera = caja(0.035, 0.09, 0.22, 0, 1.79, 0);
  return mergeGeometries([cupula, nuca, cimera])!;
}

/** Casco cónico germano. */
export const geoCascoConico = () => new THREE.ConeGeometry(0.15, 0.24, 10).translate(0, 1.77, 0);

/** Scutum curvo: cilindro parcial. Origen en el centro del escudo. */
export function geoScutum(): THREE.BufferGeometry {
  const s = new THREE.CylinderGeometry(0.55, 0.55, 1.05, 10, 1, true, -0.55, 1.1);
  s.translate(0, 0, -0.55);
  const umbo = new THREE.SphereGeometry(0.07, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 0.02);
  return mergeGeometries([s.toNonIndexed(), umbo.toNonIndexed()])!;
}

export const geoEscudoRedondo = () =>
  mergeGeometries([
    cilindro(0.38, 0.38, 0.04, 16).rotateX(Math.PI / 2).toNonIndexed(),
    new THREE.SphereGeometry(0.07, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 0.02).toNonIndexed(),
  ])!;

/** Gladius (hoja + empuñadura). Origen en la empuñadura, hoja hacia +Y. */
export const geoGladius = () => mergeGeometries([caja(0.05, 0.55, 0.012, 0, 0.32, 0), caja(0.12, 0.03, 0.04, 0, 0.04, 0), caja(0.035, 0.12, 0.035, 0, -0.04, 0)])!;

/** Lanza / framea larga. */
export const geoLanza = () => mergeGeometries([cilindro(0.018, 0.022, 2.3, 5, 0, 0.6, 0), new THREE.ConeGeometry(0.04, 0.22, 5).translate(0, 1.85, 0)])!;

/** Arco. */
export const geoArco = () => new THREE.TorusGeometry(0.55, 0.018, 4, 12, Math.PI).rotateZ(-Math.PI / 2).translate(0, 0.4, 0);

/** Caballo (origen en los cascos, mirando a +Z). */
export function geoCaballo(): THREE.BufferGeometry {
  return mergeGeometries([
    caja(0.5, 0.62, 1.55, 0, 1.25, 0),
    caja(0.22, 0.7, 0.3, 0, 1.75, 0.82).rotateX(0),
    caja(0.2, 0.22, 0.52, 0, 2.05, 1.02),
    caja(0.12, 0.95, 0.14, -0.17, 0.48, 0.58),
    caja(0.12, 0.95, 0.14, 0.17, 0.48, 0.58),
    caja(0.12, 0.95, 0.14, -0.17, 0.48, -0.58),
    caja(0.12, 0.95, 0.14, 0.17, 0.48, -0.58),
    caja(0.06, 0.6, 0.06, 0, 1.2, -0.85).rotateX(0.3),
  ])!;
}

/** Onagro de torsión: bastidor, haz de tendones y brazo. */
export function geoOnagro(): { bastidor: THREE.BufferGeometry; brazo: THREE.BufferGeometry } {
  const bastidor = mergeGeometries([
    caja(0.22, 0.22, 3.2, -0.7, 0.35, 0),
    caja(0.22, 0.22, 3.2, 0.7, 0.35, 0),
    caja(1.6, 0.2, 0.22, 0, 0.35, 1.3),
    caja(1.6, 0.2, 0.22, 0, 0.35, -1.3),
    caja(0.2, 1.3, 0.2, -0.7, 1.0, 0.6),
    caja(0.2, 1.3, 0.2, 0.7, 1.0, 0.6),
    caja(1.6, 0.22, 0.24, 0, 1.6, 0.6),
    cilindro(0.2, 0.2, 1.2, 8, 0, 0.55, -0.2).rotateZ(Math.PI / 2),
    cilindro(0.38, 0.38, 0.12, 10, -0.86, 0.38, -1.0).rotateZ(Math.PI / 2),
    cilindro(0.38, 0.38, 0.12, 10, 0.86, 0.38, -1.0).rotateZ(Math.PI / 2),
    cilindro(0.38, 0.38, 0.12, 10, -0.86, 0.38, 1.0).rotateZ(Math.PI / 2),
    cilindro(0.38, 0.38, 0.12, 10, 0.86, 0.38, 1.0).rotateZ(Math.PI / 2),
  ])!;
  const brazo = mergeGeometries([caja(0.14, 2.2, 0.14, 0, 1.1, 0), new THREE.SphereGeometry(0.22, 8, 6).translate(0, 2.25, 0)])!;
  return { bastidor, brazo };
}

/** Cadáver tendido (cuerpo + cabeza), origen en el suelo. */
export function geoCadaver(): THREE.BufferGeometry {
  return mergeGeometries([
    caja(0.44, 0.24, 0.62, 0, 0.13, 0),
    caja(0.3, 0.2, 0.82, 0.03, 0.1, -0.7),
    new THREE.SphereGeometry(0.13, 8, 6).translate(0, 0.13, 0.42),
    caja(0.12, 0.1, 0.55, -0.35, 0.07, 0.15).rotateY(0.4),
  ])!;
}

export const geoCaballoMuerto = () => geoCaballo().rotateZ(Math.PI / 2).translate(1.2, 0.25, 0);

export const geoPilum = () => mergeGeometries([cilindro(0.018, 0.018, 1.3, 5, 0, -0.35, 0), cilindro(0.008, 0.008, 0.7, 4, 0, 0.65, 0), new THREE.ConeGeometry(0.02, 0.08, 4).translate(0, 1.04, 0)])!;
export const geoFlecha = () => mergeGeometries([cilindro(0.008, 0.008, 0.75, 4, 0, 0, 0), new THREE.ConeGeometry(0.015, 0.06, 4).translate(0, 0.4, 0)])!;
export const geoPiedra = () => new THREE.DodecahedronGeometry(0.28, 0);

/** Restos de un desmembramiento (miembro suelto). */
export const geoMiembro = () => caja(0.11, 0.42, 0.12);

/** Tienda de cuero del castrum (papilio). */
export function geoTienda(): THREE.BufferGeometry {
  const forma = new THREE.Shape();
  forma.moveTo(-1.5, 0);
  forma.lineTo(0, 2.1);
  forma.lineTo(1.5, 0);
  forma.lineTo(-1.5, 0);
  return new THREE.ExtrudeGeometry(forma, { depth: 3, bevelEnabled: false }).translate(0, 0, -1.5);
}

export const geoPoste = () => cilindro(0.16, 0.2, 3.2, 6, 0, 1.4, 0);
export const geoCipres = () => mergeGeometries([cilindro(0.15, 0.2, 1.2, 5, 0, 0.6, 0), new THREE.ConeGeometry(1.1, 7, 7).translate(0, 4.4, 0)])!;
