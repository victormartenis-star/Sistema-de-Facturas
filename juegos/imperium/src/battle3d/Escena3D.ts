/**
 * Escena Three.js de la batalla campal: luz y clima, ejércitos instanciados con animación
 * procedural, cadáveres persistentes, escudos caídos, pila clavados en el barro, sangre y restos.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { posicionEnVuelo } from '../engine/Ballistics';
import {
  FORMATIONS,
  type CombatEvent,
  type HardcoreCombatEngine,
  type Projectile,
  type Squad,
  type UnitEntity,
  type Weather,
} from '../engine/HardcoreCombatEngine';
import { mulberry32 } from '../systems/BaseGenerator';
import * as M from './Modelos';
import { Terreno } from './Terreno';

const OCULTO = new THREE.Matrix4().makeScale(0, 0, 0);

interface Pieza {
  malla: THREE.InstancedMesh;
  /** ¿Usa esta unidad la pieza? (índice de unidad → bool) */
  usa: Uint8Array;
}

interface Particula {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  vida: number;
  tipo: 'sangre' | 'polvo';
}

interface Resto {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; rz: number;
  quieto: boolean;
}

const LUZ: Record<Weather, { cielo: number; niebla: number; densidad: number; sol: number; colorSol: number; hemi: number; elevacion: number; exposicion: number }> = {
  clear: { cielo: 0x8d98a1, niebla: 0x8d98a1, densidad: 0.0032, sol: 2.6, colorSol: 0xfff1de, hemi: 0.9, elevacion: 0.9, exposicion: 0.95 },
  rain: { cielo: 0x575d61, niebla: 0x4d5150, densidad: 0.0052, sol: 1.1, colorSol: 0xc9d3dc, hemi: 1.0, elevacion: 1.2, exposicion: 1.05 },
  fog: { cielo: 0x9aa09f, niebla: 0x979d9c, densidad: 0.019, sol: 0.8, colorSol: 0xe8e4da, hemi: 1.0, elevacion: 0.8, exposicion: 0.9 },
  dusk: { cielo: 0xa06a45, niebla: 0x7f5a40, densidad: 0.0058, sol: 2.4, colorSol: 0xff8f4a, hemi: 0.55, elevacion: 0.16, exposicion: 1.0 },
};

export class Escena3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly escena = new THREE.Scene();
  readonly camara: THREE.PerspectiveCamera;
  readonly controles: OrbitControls;
  readonly terreno: Terreno;
  private readonly sol: THREE.DirectionalLight;
  private readonly mats: ReturnType<typeof M.crearMateriales>;
  private readonly piezas: Record<string, Pieza> = {};
  private readonly prev: Float32Array;
  private readonly fase: Float32Array;
  private readonly sangreArma: Float32Array;
  private readonly tmp = new THREE.Matrix4();
  private readonly tmp2 = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  // Persistentes
  private readonly cadaveres: THREE.InstancedMesh;
  private readonly caballosMuertos: THREE.InstancedMesh;
  private readonly scutaCaidos: THREE.InstancedMesh;
  private readonly redondosCaidos: THREE.InstancedMesh;
  private readonly clavados: THREE.InstancedMesh;
  private readonly flechasClavadas: THREE.InstancedMesh;
  private readonly miembros: THREE.InstancedMesh;
  private nClavados = 0;
  private nFlechas = 0;
  private restos: Resto[] = [];
  // Proyectiles en vuelo
  private readonly vuelaPila: THREE.InstancedMesh;
  private readonly vuelaFlecha: THREE.InstancedMesh;
  private readonly vuelaPiedra: THREE.InstancedMesh;
  // Partículas
  private particulas: Particula[] = [];
  private readonly puntosSangre: THREE.Points;
  private readonly puntosPolvo: THREE.Points;
  private readonly lluvia: THREE.LineSegments | null = null;
  // Estandartes y selección
  private readonly estandartes = new Map<string, THREE.Group>();
  private readonly anilloSeleccion: THREE.Mesh;
  private readonly marcaDestino: THREE.Mesh;
  private readonly rnd = mulberry32(99);
  private readonly raycaster = new THREE.Raycaster();

  constructor(
    private readonly contenedor: HTMLElement,
    private readonly motor: HardcoreCombatEngine,
    private readonly clima: Weather,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const luz = LUZ[clima];
    this.renderer.toneMappingExposure = luz.exposicion;
    contenedor.appendChild(this.renderer.domElement);

    this.camara = new THREE.PerspectiveCamera(50, 1, 0.3, 900);
    this.camara.position.set(-16, 11, -78);
    this.controles = new OrbitControls(this.camara, this.renderer.domElement);
    this.controles.target.set(4, 1, -30);
    this.controles.enableDamping = true;
    this.controles.maxPolarAngle = Math.PI * 0.47;
    this.controles.minDistance = 4;
    this.controles.maxDistance = 260;
    this.controles.screenSpacePanning = false;
    this.controles.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    // ── Luz y atmósfera ──
    this.escena.background = new THREE.Color(luz.cielo);
    // Mapa de entorno para que el hierro y el bronce tengan algo que reflejar (PBR).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.escena.environmentIntensity = clima === 'clear' ? 0.45 : clima === 'dusk' ? 0.3 : 0.35;
    pmrem.dispose();
    this.escena.fog = new THREE.FogExp2(luz.niebla, luz.densidad);
    this.escena.add(new THREE.HemisphereLight(0xb6c0c8, 0x3a3026, luz.hemi));
    this.sol = new THREE.DirectionalLight(luz.colorSol, luz.sol);
    const ang = luz.elevacion;
    this.sol.position.set(Math.cos(ang) * -120, Math.sin(ang) * 160 + 10, 80);
    this.sol.castShadow = true;
    this.sol.shadow.mapSize.set(2048, 2048);
    const sc = this.sol.shadow.camera;
    sc.left = sc.bottom = -75;
    sc.right = sc.top = 75;
    sc.near = 1;
    sc.far = 500;
    this.sol.shadow.bias = -0.0004;
    this.sol.shadow.normalBias = 0.04;
    this.escena.add(this.sol, this.sol.target);

    // ── Terreno ──
    this.terreno = new Terreno(motor.config.fieldSize, clima);
    this.escena.add(this.terreno.malla);
    this.mats = M.crearMateriales(clima === 'rain');

    // ── Ejércitos ──
    const n = motor.units.length;
    this.prev = new Float32Array(n * 2);
    this.fase = new Float32Array(n);
    this.sangreArma = new Float32Array(n);
    motor.units.forEach((u, i) => {
      this.prev[i * 2] = u.position.x;
      this.prev[i * 2 + 1] = u.position.z;
      this.fase[i] = this.rnd() * 10;
    });
    this.crearPiezas();

    // ── Persistentes ──
    const max = n + 50;
    this.cadaveres = this.instanciada(M.geoCadaver(), this.mats.tela, max, false);
    this.caballosMuertos = this.instanciada(M.geoCaballoMuerto(), this.mats.cuero, Math.max(10, n / 4), false);
    this.scutaCaidos = this.instanciada(M.geoScutum(), this.mats.cuero, max, false);
    this.redondosCaidos = this.instanciada(M.geoEscudoRedondo(), this.mats.madera, max, false);
    this.clavados = this.instanciada(M.geoPilum(), this.mats.metal, 1200, false);
    this.flechasClavadas = this.instanciada(M.geoFlecha(), this.mats.madera, 2000, false);
    this.miembros = this.instanciada(M.geoMiembro(), this.mats.piel, 400, false);
    for (const m of [this.cadaveres, this.caballosMuertos, this.scutaCaidos, this.redondosCaidos, this.clavados, this.flechasClavadas, this.miembros]) m.count = 0;
    this.vuelaPila = this.instanciada(M.geoPilum(), this.mats.metal, 600, false);
    this.vuelaFlecha = this.instanciada(M.geoFlecha(), this.mats.madera, 800, false);
    this.vuelaPiedra = this.instanciada(M.geoPiedra(), this.mats.madera, 40, true);
    this.vuelaPiedra.material = new THREE.MeshStandardMaterial({ color: 0x7d776c, roughness: 0.95 });

    // ── Partículas ──
    this.puntosSangre = this.crearPuntos(0x420201, 0.08, 3000);
    this.puntosPolvo = this.crearPuntos(clima === 'rain' ? 0x3b3027 : 0x8a7a64, 0.35, 1500, 0.55);
    if (clima === 'rain') this.lluvia = this.crearLluvia();
    if (clima === 'dusk') this.crearPolvoAmbiental();

    // ── Selección ──
    this.anilloSeleccion = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.anilloSeleccion.visible = false;
    this.escena.add(this.anilloSeleccion);
    this.marcaDestino = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xd4af37 }));
    this.marcaDestino.visible = false;
    this.escena.add(this.marcaDestino);

    this.crearEstandartes();
    this.crearDecorado();
    this.redimensionar();
  }

  // ───────────────────────── Construcción ─────────────────────────

  private instanciada(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, sombra = true): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, Math.ceil(n)));
    m.castShadow = sombra;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.escena.add(m);
    return m;
  }

  private crearPiezas(): void {
    const u = this.motor.units;
    const n = u.length;
    const pieza = (nombre: string, geo: THREE.BufferGeometry, mat: THREE.Material, usa: (x: UnitEntity) => boolean, color: (x: UnitEntity, r: () => number) => number) => {
      const malla = this.instanciada(geo, mat, n);
      const mascara = new Uint8Array(n);
      const r = mulberry32(nombre.length * 31 + 7);
      u.forEach((x, i) => {
        mascara[i] = usa(x) ? 1 : 0;
        malla.setColorAt(i, this.color.setHex(color(x, r)));
        malla.setMatrixAt(i, OCULTO);
      });
      this.piezas[nombre] = { malla, usa: mascara };
    };
    const romano = (x: UnitEntity) => x.faction === 'rome';
    const humano = (x: UnitEntity) => x.unitClass !== 'onager';
    const variar = (base: number, r: () => number, amp = 0.18) => {
      const c = new THREE.Color(base);
      const f = 1 - amp / 2 + r() * amp;
      return c.multiplyScalar(f).getHex();
    };
    const tunicasBarbaras = [0x4b3a2a, 0x5a4a32, 0x3d4430, 0x5b3a26, 0x6b5a3e, 0x3a3530, 0x4f2b22];

    pieza('piernas', M.geoCuerpo(), this.mats.tela, (x) => humano(x) && !(x.unitClass === 'legionary' || x.unitClass === 'centurion'),
      (x, r) => (x.unitClass === 'velite' ? variar(M.COLOR.lino, r) : variar(tunicasBarbaras[Math.floor(r() * tunicasBarbaras.length)], r)));
    // Legionarios y centuriones: lorica de hierro sobre túnica roja pompeyana.
    pieza('lorica', M.geoCuerpo(), this.mats.metal, (x) => x.unitClass === 'legionary' || x.unitClass === 'centurion' || x.unitClass === 'eques' || x.unitClass === 'chieftain',
      (x, r) => (x.unitClass === 'centurion' ? 0x8c8f8c : x.unitClass === 'chieftain' ? 0x4c4f4e : variar(0x565c5f, r, 0.25)));
    pieza('tunica', new THREE.BoxGeometry(0.46, 0.32, 0.29).translate(0, 0.72, 0), this.mats.tela, (x) => x.unitClass === 'legionary' || x.unitClass === 'centurion',
      (_x, r) => variar(M.COLOR.rojoPompeyano, r, 0.2));
    pieza('cabeza', M.geoCabeza(), this.mats.piel, humano, (_x, r) => variar(M.COLOR.piel, r, 0.3));
    pieza('cascoR', M.geoCascoRomano(), this.mats.metal, (x) => romano(x) && humano(x) && x.unitClass !== 'velite',
      (x, r) => (x.unitClass === 'centurion' ? 0xb8b8b0 : r() < 0.5 ? variar(M.COLOR.bronce, r) : variar(0x5c6164, r)));
    pieza('cascoG', M.geoCascoConico(), this.mats.metal, (x) => !romano(x) && humano(x) && (x.unitClass === 'chieftain' || x.unitClass === 'horseman' || (x.id.charCodeAt(x.id.length - 1) % 3 === 0)),
      (_x, r) => variar(0x4a4d4e, r, 0.3));
    pieza('scutum', M.geoScutum(), this.mats.cuero, (x) => romano(x) && (x.unitClass === 'legionary' || x.unitClass === 'centurion' || x.unitClass === 'eques'),
      (_x, r) => variar(0x5e1914, r, 0.2));
    pieza('redondo', M.geoEscudoRedondo(), this.mats.madera, (x) => !romano(x) && (x.unitClass === 'warrior' || x.unitClass === 'chieftain' || x.unitClass === 'horseman') || x.unitClass === 'velite',
      (x, r) => (x.unitClass === 'velite' ? variar(0x6b4b30, r) : variar([0x5a4330, 0x6b5233, 0x3f3a2c, 0x5e2a1c][Math.floor(r() * 4)], r)));
    pieza('gladius', M.geoGladius(), this.mats.metal, (x) => x.unitClass === 'legionary' || x.unitClass === 'centurion' || x.unitClass === 'chieftain' || x.unitClass === 'eques', () => 0x9aa0a3);
    pieza('lanza', M.geoLanza(), this.mats.madera, (x) => x.unitClass === 'warrior' || x.unitClass === 'horseman', () => 0x6a5440);
    pieza('arco', M.geoArco(), this.mats.madera, (x) => x.unitClass === 'archer' || x.unitClass === 'velite', () => 0x4a3523);
    pieza('caballo', M.geoCaballo(), this.mats.cuero, (x) => x.mounted, (_x, r) => variar([0x3d2a1e, 0x2a1d14, 0x5a3e2a, 0x4d4540][Math.floor(r() * 4)], r));
    const onagro = M.geoOnagro();
    pieza('onagro', onagro.bastidor, this.mats.madera, (x) => x.unitClass === 'onager', () => 0x6a5038);
    pieza('brazo', onagro.brazo, this.mats.madera, (x) => x.unitClass === 'onager', () => 0x5a4430);
    for (const p of Object.values(this.piezas)) if (p.malla.instanceColor) p.malla.instanceColor.needsUpdate = true;
  }

  private crearPuntos(color: number, tamano: number, max: number, opacidad = 0.95): THREE.Points {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geo.setDrawRange(0, 0);
    const p = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: tamano, transparent: true, opacity: opacidad, depthWrite: false }));
    p.frustumCulled = false;
    this.escena.add(p);
    return p;
  }

  private crearLluvia(): THREE.LineSegments {
    const n = 7000;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 140, y = Math.random() * 60, z = (Math.random() - 0.5) * 140;
      pos.set([x, y, z, x + 0.12, y + 0.9, z + 0.05], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaab4bd, transparent: true, opacity: 0.22 }));
    l.frustumCulled = false;
    this.escena.add(l);
    return l;
  }

  private crearPolvoAmbiental(): void {
    const n = 1200;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 300, Math.random() * 12, (Math.random() - 0.5) * 300], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd9a46a, size: 0.25, transparent: true, opacity: 0.35, depthWrite: false }));
    p.name = 'polvo';
    this.escena.add(p);
  }

  private crearEstandartes(): void {
    for (const s of this.motor.squads) {
      const g = new THREE.Group();
      const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 3.6, 6).translate(0, 1.8, 0), this.mats.madera);
      poste.material = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.8 });
      g.add(poste);
      if (s.faction === 'rome') {
        const tela = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.9, 6, 6).translate(0, 2.9, 0.02), new THREE.MeshStandardMaterial({ color: 0x5e1510, roughness: 0.9, side: THREE.DoubleSide }));
        tela.name = 'tela';
        const travesano = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5).rotateZ(Math.PI / 2).translate(0, 3.36, 0), new THREE.MeshStandardMaterial({ color: 0x8a6a2e, metalness: 0.9, roughness: 0.4 }));
        const aguila = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6).translate(0, 3.7, 0), new THREE.MeshStandardMaterial({ color: 0xa8842e, metalness: 0.95, roughness: 0.3 }));
        g.add(tela, travesano, aguila);
      } else {
        const craneo = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6).translate(0, 3.7, 0), new THREE.MeshStandardMaterial({ color: 0xbdb39c, roughness: 0.8 }));
        const cuernos = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 4, 10, Math.PI).translate(0, 3.75, 0), new THREE.MeshStandardMaterial({ color: 0x8c8270, roughness: 0.7 }));
        const pieles = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.8, 3, 3).translate(0, 3.05, 0.02), new THREE.MeshStandardMaterial({ color: 0x3e2c1e, roughness: 1, side: THREE.DoubleSide }));
        pieles.name = 'tela';
        g.add(craneo, cuernos, pieles);
      }
      g.traverse((o) => (o.castShadow = true));
      this.estandartes.set(s.id, g);
      this.escena.add(g);
    }
  }

  /** Castrum romano con tiendas de cuero y empalizada; bosque germano al fondo. */
  private crearDecorado(): void {
    const tiendas: [number, number][] = [];
    for (let i = -4; i <= 4; i++) for (let j = 0; j < 3; j++) tiendas.push([i * 5, -150 - j * 6]);
    const mt = new THREE.InstancedMesh(M.geoTienda(), new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.85 }), tiendas.length);
    tiendas.forEach(([x, z], k) => {
      this.tmp.compose(new THREE.Vector3(x, this.terreno.alturaEn(x, z), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(1, 0.8 + (k % 3) * 0.05, 1));
      mt.setMatrixAt(k, this.tmp);
    });
    mt.castShadow = mt.receiveShadow = true;
    this.escena.add(mt);

    const postes: [number, number][] = [];
    for (let x = -30; x <= 30; x += 0.45) postes.push([x, -134], [x, -172]);
    for (let z = -172; z <= -134; z += 0.45) if (Math.abs(z + 134) > 0.1) postes.push([-30, z], [30, z]);
    const mp = new THREE.InstancedMesh(M.geoPoste(), new THREE.MeshStandardMaterial({ color: 0x3e2f22, roughness: 0.9 }), postes.length);
    postes.forEach(([x, z], k) => {
      if (Math.abs(x) < 3 && z > -136) {
        mp.setMatrixAt(k, OCULTO); // puerta pretoria
        return;
      }
      this.tmp.makeTranslation(x, this.terreno.alturaEn(x, z) - 0.3, z);
      this.tmp2.makeRotationY(this.rnd() * 3);
      mp.setMatrixAt(k, this.tmp.multiply(this.tmp2));
    });
    mp.castShadow = mp.receiveShadow = true;
    this.escena.add(mp);

    const arboles: [number, number, number][] = [];
    for (let k = 0; k < 420; k++) {
      const a = this.rnd() * Math.PI * 2;
      const lado = this.rnd();
      let x: number, z: number;
      if (lado < 0.5) {
        x = (this.rnd() - 0.5) * 320;
        z = 140 + this.rnd() * 30;
      } else {
        const r = 145 + this.rnd() * 25;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
      if (z < -125 && Math.abs(x) < 40) continue;
      arboles.push([x, z, 0.8 + this.rnd() * 0.7]);
    }
    const ma = new THREE.InstancedMesh(M.geoCipres(), new THREE.MeshStandardMaterial({ color: 0x1f2a19, roughness: 0.95 }), arboles.length);
    arboles.forEach(([x, z, e], k) => {
      this.tmp.compose(new THREE.Vector3(x, this.terreno.alturaEn(x, z) - 0.2, z), new THREE.Quaternion(), new THREE.Vector3(e, e * (0.9 + this.rnd() * 0.4), e));
      ma.setMatrixAt(k, this.tmp);
    });
    ma.castShadow = true;
    this.escena.add(ma);
  }

  // ───────────────────────── Entrada ─────────────────────────

  redimensionar(): void {
    const w = this.contenedor.clientWidth || window.innerWidth;
    const h = this.contenedor.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
  }

  /** Punto del suelo bajo el cursor. */
  puntoSuelo(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camara);
    const hit = this.raycaster.intersectObject(this.terreno.malla, false)[0];
    return hit?.point ?? null;
  }

  enfocar(x: number, z: number): void {
    const dx = x - this.controles.target.x;
    const dz = z - this.controles.target.z;
    this.controles.target.x += dx;
    this.controles.target.z += dz;
    this.camara.position.x += dx;
    this.camara.position.z += dz;
  }

  // ───────────────────────── Fotograma ─────────────────────────

  /** Guarda las posiciones previas antes de un paso de simulación (para interpolar). */
  antesDePaso(): void {
    this.motor.units.forEach((u, i) => {
      this.prev[i * 2] = u.position.x;
      this.prev[i * 2 + 1] = u.position.z;
    });
  }

  dibujar(alfa: number, dt: number, seleccion: Squad | null, ahora: number): void {
    this.actualizarUnidades(alfa, dt);
    this.actualizarProyectiles();
    this.actualizarParticulas(dt);
    this.actualizarRestos(dt);
    this.actualizarEstandartes(seleccion, ahora);
    if (this.lluvia) this.actualizarLluvia(dt);
    const polvo = this.escena.getObjectByName('polvo');
    if (polvo) polvo.rotation.y += dt * 0.004;
    this.terreno.actualizar(ahora);
    // La sombra sigue a la cámara.
    const t = this.controles.target;
    this.sol.target.position.copy(t);
    const luz = LUZ[this.clima];
    this.sol.position.set(t.x + Math.cos(luz.elevacion) * -120, Math.sin(luz.elevacion) * 160 + 10, t.z + 80);
    this.controles.update();
    this.renderer.render(this.escena, this.camara);
  }

  private actualizarUnidades(alfa: number, dt: number): void {
    const P = this.piezas;
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const uno = new THREE.Vector3(1, 1, 1);
    const base = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const lq = new THREE.Quaternion();
    const le = new THREE.Euler();
    const set = (nombre: string, i: number, m: THREE.Matrix4 | null) => {
      const p = P[nombre];
      p.malla.setMatrixAt(i, m && p.usa[i] ? m : OCULTO);
    };
    const parte = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      le.set(rx, ry, rz);
      lq.setFromEuler(le);
      local.compose(new THREE.Vector3(x, y, z), lq, uno);
      return this.tmp2.multiplyMatrices(base, local);
    };

    this.motor.units.forEach((u, i) => {
      if (u.state === 'dead' || u.state === 'fled') {
        for (const k in P) P[k].malla.setMatrixAt(i, OCULTO);
        return;
      }
      const x = this.prev[i * 2] + (u.position.x - this.prev[i * 2]) * alfa;
      const z = this.prev[i * 2 + 1] + (u.position.z - this.prev[i * 2 + 1]) * alfa;
      const y = this.terreno.alturaEn(x, z);
      const rapidez = Math.hypot(u.velocity.x, u.velocity.z);
      this.fase[i] += rapidez * dt * (u.mounted ? 2.2 : 4.2);
      // Huellas en el barro.
      if (rapidez > 0.6 && Math.floor(this.fase[i]) !== Math.floor(this.fase[i] - rapidez * dt * (u.mounted ? 2.2 : 4.2))) {
        this.terreno.pisar(x, z, u.mounted ? 6 : u.unitClass === 'onager' ? 20 : 1);
      }
      const huye = u.state === 'routing';
      const aturdido = u.stun > 0;
      const bote = Math.abs(Math.sin(this.fase[i])) * (u.mounted ? 0.12 : 0.06) * Math.min(1, rapidez);
      const inclinacion = (huye ? 0.45 : Math.min(0.2, rapidez * 0.05)) + (aturdido ? -0.6 : 0);
      e.set(0, u.facing, 0);
      q.setFromEuler(e);
      pos.set(x, y + bote - (aturdido ? 0.25 : 0), z);
      base.compose(pos, q, uno);

      if (u.unitClass === 'onager') {
        set('onagro', i, base);
        const carga = u.attackAnim > 0 ? (u.attackAnim / 0.5) : 0;
        set('brazo', i, parte(0, 0.55, -0.2, -1.25 + carga * 1.9, 0, 0));
        return;
      }

      if (u.mounted) {
        set('caballo', i, base);
        // El jinete va sentado a lomos (+1.05 m).
        base.multiply(local.makeTranslation(0, 1.0, -0.1));
      } else set('caballo', i, null);

      // Cuerpo con inclinación (carrera, huida, derribo).
      const cuerpo = parte(0, 0, 0, inclinacion, 0, 0).clone();
      set('piernas', i, cuerpo);
      set('lorica', i, cuerpo);
      set('tunica', i, cuerpo);
      set('cabeza', i, cuerpo);
      set('cascoR', i, cuerpo);
      set('cascoG', i, cuerpo);

      // Escudo: frente, sobre la cabeza (testudo) o caído.
      const s = this.motor.squad(u.squadId)!;
      if (u.hasShield) {
        let m: THREE.Matrix4;
        if (s.formation === 'testudo' && !this.esPrimeraFila(u, s)) m = parte(0, 2.0, 0.05, -Math.PI / 2, 0, 0);
        else if (s.formation === 'testudo') m = parte(0, 1.0, 0.42, 0, 0, 0);
        else m = parte(-0.3, 1.05, 0.3, 0.05, -0.25, 0);
        set('scutum', i, m);
        set('redondo', i, m);
      } else {
        set('scutum', i, null);
        set('redondo', i, null);
      }

      // Arma: estocada de gladius / lanza, o arco tenso.
      const t = u.attackAnim > 0 ? 1 - u.attackAnim / 0.45 : 0;
      const golpe = Math.sin(Math.min(1, t) * Math.PI);
      if (huye) {
        set('gladius', i, null);
        set('lanza', i, null);
        set('arco', i, null);
      } else {
        set('gladius', i, parte(0.3, 1.0 + golpe * 0.15, 0.18 + golpe * 0.35, 1.2 + golpe * 0.5 - (u.mounted ? 0.4 : 0), 0, 0));
        set('lanza', i, parte(0.28, 1.15, 0.1 + golpe * 0.5, u.mounted ? 1.35 : 1.15 + golpe * 0.2, 0, 0));
        set('arco', i, parte(-0.25, 1.15, 0.35, 0, 0, 0.1));
      }
      // Sangre en el filo.
      if (Math.abs(this.sangreArma[i] - u.bloodiness) > 0.04) {
        this.sangreArma[i] = u.bloodiness;
        this.color.setHex(0x9aa0a3).lerp(this.color.clone().setHex(M.COLOR.sangreSeca), Math.min(0.85, u.bloodiness));
        P.gladius.malla.setColorAt(i, this.color);
        this.color.setHex(0x6a5440).lerp(this.color.clone().setHex(M.COLOR.sangreSeca), Math.min(0.7, u.bloodiness));
        P.lanza.malla.setColorAt(i, this.color);
        P.gladius.malla.instanceColor!.needsUpdate = true;
        P.lanza.malla.instanceColor!.needsUpdate = true;
      }
    });
    for (const p of Object.values(P)) p.malla.instanceMatrix.needsUpdate = true;
  }

  private esPrimeraFila(u: UnitEntity, s: Squad): boolean {
    const fx = Math.sin(s.facing), fz = Math.cos(s.facing);
    return (u.position.x - s.anchor.x) * fx + (u.position.z - s.anchor.z) * fz > -FORMATIONS.testudo.spacing * 0.6;
  }

  private orientarSegun(dir: THREE.Vector3, p: THREE.Vector3, escala = 1): THREE.Matrix4 {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return this.tmp.compose(p, q, new THREE.Vector3(escala, escala, escala));
  }

  private actualizarProyectiles(): void {
    let np = 0, nf = 0, nr = 0;
    for (const p of this.motor.projectiles) {
      const a = this.posProyectil(p, p.t);
      const b = this.posProyectil(p, p.t + 0.03);
      const dir = b.clone().sub(a);
      if (p.kind === 'stone') {
        this.tmp.compose(a, new THREE.Quaternion().setFromEuler(new THREE.Euler(p.t * 5, p.t * 3, 0)), new THREE.Vector3(1, 1, 1));
        this.vuelaPiedra.setMatrixAt(nr++, this.tmp);
      } else if (p.kind === 'pilum') {
        if (np < 600) this.vuelaPila.setMatrixAt(np++, this.orientarSegun(dir, a));
      } else if (nf < 800) this.vuelaFlecha.setMatrixAt(nf++, this.orientarSegun(dir, a));
    }
    this.vuelaPila.count = np;
    this.vuelaFlecha.count = nf;
    this.vuelaPiedra.count = nr;
    for (const m of [this.vuelaPila, this.vuelaFlecha, this.vuelaPiedra]) m.instanceMatrix.needsUpdate = true;
  }

  private posProyectil(p: Projectile, t: number): THREE.Vector3 {
    const q = posicionEnVuelo(p.tiro, t);
    return new THREE.Vector3(q.x, q.z + this.terreno.alturaEn(q.x, q.y), q.y);
  }

  // ───────────────────────── Eventos → efectos ─────────────────────────

  procesarEventos(eventos: CombatEvent[], proyectilesAntes: Map<number, Projectile>): void {
    for (const ev of eventos) {
      switch (ev.type) {
        case 'hit':
          this.salpicar(ev.x, ev.y, ev.z, 8 + Math.min(20, ev.damage));
          break;
        case 'death': {
          const u = this.motor.unit(ev.unitId)!;
          this.anadirCadaver(u, ev.dismembered);
          this.terreno.manchaSangre(ev.x, ev.z, u.mounted ? 1.8 : 1.0, 0.9);
          this.salpicar(ev.x, this.terreno.alturaEn(ev.x, ev.z) + 1, ev.z, ev.dismembered ? 60 : 18);
          if (ev.dismembered) this.desmembrar(ev.x, ev.z);
          break;
        }
        case 'impact':
          this.levantarPolvo(ev.x, ev.z, Math.min(30, ev.energy / 100));
          this.salpicar(ev.x, this.terreno.alturaEn(ev.x, ev.z) + 1.2, ev.z, Math.min(25, ev.energy / 150));
          break;
        case 'missileLand':
          if (ev.kind === 'stone') {
            this.terreno.crater(ev.x, ev.z);
            this.levantarPolvo(ev.x, ev.z, 45);
          } else if (!ev.hit) this.clavar(ev.kind, ev.x, ev.z, proyectilesAntes);
          break;
        case 'shieldDropped': {
          const u = this.motor.unit(ev.unitId);
          if (u) this.soltarEscudo(u, ev.x, ev.z, ev.rotation);
          break;
        }
      }
    }
  }

  private anadirCadaver(u: UnitEntity, desmembrado: boolean): void {
    const c = this.motor.corpses[this.motor.corpses.length - 1];
    const y = this.terreno.alturaEn(u.position.x, u.position.z);
    const i = this.cadaveres.count++;
    this.tmp.compose(new THREE.Vector3(u.position.x, y - 0.04, u.position.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, c?.rotation ?? 0, 0)), new THREE.Vector3(1, 1, desmembrado ? 0.7 : 1));
    this.cadaveres.setMatrixAt(i, this.tmp);
    const col = u.faction === 'rome' ? (u.unitClass === 'velite' ? M.COLOR.lino : 0x4a2420) : 0x463828;
    this.cadaveres.setColorAt(i, this.color.setHex(col).lerp(new THREE.Color(M.COLOR.barro), 0.3));
    this.cadaveres.instanceMatrix.needsUpdate = true;
    if (this.cadaveres.instanceColor) this.cadaveres.instanceColor.needsUpdate = true;
    if (u.mounted && this.caballosMuertos.count < this.caballosMuertos.instanceMatrix.count) {
      const j = this.caballosMuertos.count++;
      this.tmp.compose(new THREE.Vector3(u.position.x, y, u.position.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (c?.rotation ?? 0) + 1, 0)), new THREE.Vector3(1, 1, 1));
      this.caballosMuertos.setMatrixAt(j, this.tmp);
      this.caballosMuertos.setColorAt(j, this.color.setHex(M.COLOR.caballo));
      this.caballosMuertos.instanceMatrix.needsUpdate = true;
      if (this.caballosMuertos.instanceColor) this.caballosMuertos.instanceColor.needsUpdate = true;
    }
  }

  private soltarEscudo(u: UnitEntity, x: number, z: number, rot: number): void {
    const malla = u.faction === 'rome' && u.unitClass !== 'velite' ? this.scutaCaidos : this.redondosCaidos;
    if (malla.count >= malla.instanceMatrix.count) return;
    const i = malla.count++;
    const ox = Math.sin(rot) * 0.8, oz = Math.cos(rot) * 0.8;
    this.tmp.compose(new THREE.Vector3(x + ox, this.terreno.alturaEn(x + ox, z + oz) + 0.06, z + oz), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.15, rot, 0)), new THREE.Vector3(1, 1, 1));
    malla.setMatrixAt(i, this.tmp);
    malla.setColorAt(i, this.color.setHex(malla === this.scutaCaidos ? 0x4e1612 : 0x4a3a2a));
    malla.instanceMatrix.needsUpdate = true;
    if (malla.instanceColor) malla.instanceColor.needsUpdate = true;
  }

  private clavar(tipo: string, x: number, z: number, antes: Map<number, Projectile>): void {
    // Buscar la dirección de llegada del proyectil que acaba de aterrizar.
    let dir = new THREE.Vector3(0, -1, 0.4);
    for (const p of antes.values()) {
      if (Math.abs(p.tiro.destino.x - x) < 0.01 && Math.abs(p.tiro.destino.y - z) < 0.01) {
        dir = this.posProyectil(p, p.tiro.duracion).sub(this.posProyectil(p, p.tiro.duracion - 0.05));
        break;
      }
    }
    const pilum = tipo === 'pilum';
    const malla = pilum ? this.clavados : this.flechasClavadas;
    const max = malla.instanceMatrix.count;
    const i = (pilum ? this.nClavados++ : this.nFlechas++) % max;
    malla.count = Math.min(max, malla.count + 1);
    const y = this.terreno.alturaEn(x, z);
    // Hundido en el barro, inclinado según la llegada.
    const d = dir.normalize();
    const p = new THREE.Vector3(x, y, z).addScaledVector(d, pilum ? -0.25 : -0.1).add(new THREE.Vector3(0, pilum ? 0.75 : 0.3, 0));
    malla.setMatrixAt(i, this.orientarSegun(d.clone().negate().multiplyScalar(-1), p));
    malla.instanceMatrix.needsUpdate = true;
  }

  private salpicar(x: number, y: number, z: number, n: number): void {
    for (let k = 0; k < n; k++) {
      this.particulas.push({
        x, y, z,
        vx: (Math.random() - 0.5) * 3,
        vy: 1 + Math.random() * 3.2,
        vz: (Math.random() - 0.5) * 3,
        vida: 1.4,
        tipo: 'sangre',
      });
    }
  }

  private levantarPolvo(x: number, z: number, n: number): void {
    const y = this.terreno.alturaEn(x, z);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 1 + Math.random() * 4;
      this.particulas.push({ x, y: y + 0.2, z, vx: Math.cos(a) * v, vy: 1 + Math.random() * 4, vz: Math.sin(a) * v, vida: 1.6, tipo: 'polvo' });
    }
  }

  private desmembrar(x: number, z: number): void {
    const y = this.terreno.alturaEn(x, z) + 1;
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI * 2;
      this.restos.push({ x, y, z, vx: Math.cos(a) * (3 + Math.random() * 4), vy: 4 + Math.random() * 4, vz: Math.sin(a) * (3 + Math.random() * 4), rx: Math.random() * 6, rz: Math.random() * 6, quieto: false });
    }
  }

  private actualizarRestos(dt: number): void {
    let cambio = false;
    for (const r of this.restos) {
      if (r.quieto) continue;
      cambio = true;
      r.vy -= 9.81 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      r.rx += dt * 9;
      r.rz += dt * 7;
      const suelo = this.terreno.alturaEn(r.x, r.z) + 0.06;
      if (r.y <= suelo) {
        r.y = suelo;
        if (Math.abs(r.vy) < 1.5) {
          r.quieto = true;
          r.rx = Math.PI / 2;
          this.terreno.manchaSangre(r.x, r.z, 0.4, 0.8);
        }
        r.vy *= -0.3;
        r.vx *= 0.5;
        r.vz *= 0.5;
      }
    }
    if (!cambio) return;
    this.restos = this.restos.slice(-400);
    this.restos.forEach((r, i) => {
      this.tmp.compose(new THREE.Vector3(r.x, r.y, r.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r.rx, 0, r.rz)), new THREE.Vector3(1, 1, 1));
      this.miembros.setMatrixAt(i, this.tmp);
      this.miembros.setColorAt(i, this.color.setHex(0x6b3a2c));
    });
    this.miembros.count = this.restos.length;
    this.miembros.instanceMatrix.needsUpdate = true;
    if (this.miembros.instanceColor) this.miembros.instanceColor.needsUpdate = true;
  }

  private actualizarParticulas(dt: number): void {
    const vivas: Particula[] = [];
    for (const p of this.particulas) {
      p.vida -= dt;
      if (p.vida <= 0) continue;
      p.vy -= (p.tipo === 'polvo' ? 2.5 : 9.81) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.tipo === 'polvo') {
        p.vx *= 0.96;
        p.vz *= 0.96;
      }
      const suelo = this.terreno.alturaEn(p.x, p.z);
      if (p.y < suelo) {
        if (p.tipo === 'sangre' && Math.random() < 0.15) this.terreno.manchaSangre(p.x, p.z, 0.18, 0.7);
        continue;
      }
      vivas.push(p);
    }
    this.particulas = vivas.slice(-4000);
    const sangre = this.puntosSangre.geometry.attributes.position as THREE.BufferAttribute;
    const polvo = this.puntosPolvo.geometry.attributes.position as THREE.BufferAttribute;
    let ns = 0, np = 0;
    for (const p of this.particulas) {
      if (p.tipo === 'sangre' && ns < sangre.count) sangre.setXYZ(ns++, p.x, p.y, p.z);
      else if (p.tipo === 'polvo' && np < polvo.count) polvo.setXYZ(np++, p.x, p.y, p.z);
    }
    this.puntosSangre.geometry.setDrawRange(0, ns);
    this.puntosPolvo.geometry.setDrawRange(0, np);
    sangre.needsUpdate = polvo.needsUpdate = true;
  }

  private actualizarLluvia(dt: number): void {
    const l = this.lluvia!;
    const pos = l.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const c = this.controles.target;
    for (let i = 0; i < arr.length; i += 6) {
      arr[i + 1] -= 22 * dt;
      arr[i + 4] -= 22 * dt;
      arr[i] -= 2.5 * dt;
      arr[i + 3] -= 2.5 * dt;
      if (arr[i + 1] < 0) {
        const x = (Math.random() - 0.5) * 140, z = (Math.random() - 0.5) * 140, y = 40 + Math.random() * 20;
        arr.set([x, y, z, x + 0.12, y + 0.9, z + 0.05], i);
      }
    }
    l.position.set(c.x, this.terreno.alturaEn(c.x, c.z), c.z);
    pos.needsUpdate = true;
  }

  private actualizarEstandartes(seleccion: Squad | null, ahora: number): void {
    for (const s of this.motor.squads) {
      const g = this.estandartes.get(s.id)!;
      const lider = this.motor.unit(s.leaderId);
      const vivoLider = lider && lider.state !== 'dead' && lider.state !== 'fled';
      const centro = vivoLider ? { x: lider!.position.x, z: lider!.position.z } : this.motor.centroide(s);
      if (!centro || (s.routed && !vivoLider)) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      g.position.set(centro.x + 0.5, this.terreno.alturaEn(centro.x, centro.z), centro.z);
      g.rotation.y = s.facing;
      const tela = g.getObjectByName('tela');
      if (tela) tela.rotation.y = Math.sin(ahora / 400 + s.anchor.x) * 0.25;
    }
    if (seleccion) {
      const c = this.motor.centroide(seleccion);
      if (c) {
        const miembros = this.motor.miembros(seleccion);
        let r = 2;
        for (const u of miembros) r = Math.max(r, Math.hypot(u.position.x - c.x, u.position.z - c.z) + 1);
        this.anilloSeleccion.visible = true;
        this.anilloSeleccion.position.set(c.x, this.terreno.alturaEn(c.x, c.z) + 0.15, c.z);
        this.anilloSeleccion.scale.setScalar(r);
      } else this.anilloSeleccion.visible = false;
      const destino = seleccion.target;
      if (destino && (seleccion.order === 'move' || seleccion.order === 'retreat')) {
        this.marcaDestino.visible = true;
        this.marcaDestino.position.set(destino.x, this.terreno.alturaEn(destino.x, destino.z) + 1.2 + Math.sin(ahora / 200) * 0.2, destino.z);
      } else this.marcaDestino.visible = false;
    } else {
      this.anilloSeleccion.visible = false;
      this.marcaDestino.visible = false;
    }
  }

  liberar(): void {
    this.controles.dispose();
    this.renderer.dispose();
    this.escena.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
    this.renderer.domElement.remove();
  }
}
