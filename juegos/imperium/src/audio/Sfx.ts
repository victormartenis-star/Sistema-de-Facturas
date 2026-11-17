/**
 * Efectos de sonido sintetizados con Web Audio (sin archivos externos).
 * Timbre "metálico": parciales inarmónicos con caída exponencial, como bronce golpeado.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private maestro: GainNode | null = null;
  silenciado = false;
  private ultimo = new Map<string, number>();

  /** Debe llamarse tras un gesto del usuario (política de autoplay). */
  desbloquear(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.maestro = this.ctx.createGain();
    this.maestro.gain.value = 0.35;
    this.maestro.connect(this.ctx.destination);
  }

  private listo(clave: string, intervaloMs: number): AudioContext | null {
    if (this.silenciado || !this.ctx || !this.maestro) return null;
    const ahora = performance.now();
    if (ahora - (this.ultimo.get(clave) ?? 0) < intervaloMs) return null;
    this.ultimo.set(clave, ahora);
    return this.ctx;
  }

  private parcial(frecuencia: number, duracion: number, volumen: number, tipo: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = tipo;
    osc.frequency.value = frecuencia;
    g.gain.setValueAtTime(volumen, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duracion);
    osc.connect(g).connect(this.maestro!);
    osc.start();
    osc.stop(ctx.currentTime + duracion);
  }

  private ruido(duracion: number, volumen: number, frecuenciaFiltro: number): void {
    const ctx = this.ctx!;
    const muestras = Math.floor(ctx.sampleRate * duracion);
    const buffer = ctx.createBuffer(1, muestras, ctx.sampleRate);
    const canal = buffer.getChannelData(0);
    for (let i = 0; i < muestras; i++) canal[i] = (Math.random() * 2 - 1) * (1 - i / muestras) ** 2;
    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = frecuenciaFiltro;
    const g = ctx.createGain();
    g.gain.value = volumen;
    fuente.connect(filtro).connect(g).connect(this.maestro!);
    fuente.start();
  }

  /** Golpe de bronce: clics de interfaz y confirmaciones. */
  metal(): void {
    if (!this.listo('metal', 40)) return;
    for (const [f, v] of [[523, 0.25], [1307, 0.12], [2153, 0.08], [3361, 0.04]] as const) this.parcial(f, 0.5, v);
  }

  construir(): void {
    if (!this.listo('construir', 80)) return;
    this.ruido(0.15, 0.6, 900);
    this.parcial(196, 0.3, 0.3, 'triangle');
  }

  espada(): void {
    if (!this.listo('espada', 90)) return;
    for (const [f, v] of [[1870, 0.08], [2950, 0.05], [4410, 0.03]] as const) this.parcial(f * (0.95 + Math.random() * 0.1), 0.18, v);
  }

  flecha(): void {
    if (!this.listo('flecha', 70)) return;
    this.ruido(0.12, 0.25, 3500);
  }

  impactoPiedra(): void {
    if (!this.listo('piedra', 60)) return;
    this.ruido(0.45, 1, 400);
    this.parcial(70, 0.4, 0.5, 'sine');
  }

  derrumbe(): void {
    if (!this.listo('derrumbe', 100)) return;
    this.ruido(0.9, 1.1, 600);
    this.parcial(55, 0.7, 0.4, 'triangle');
  }

  fanfarria(victoria: boolean): void {
    if (!this.listo('fanfarria', 500)) return;
    const notas = victoria ? [392, 523, 659, 784] : [392, 349, 311, 262];
    notas.forEach((f, i) => setTimeout(() => this.parcial(f, 0.6, 0.18, 'sawtooth'), i * 180));
  }
}
