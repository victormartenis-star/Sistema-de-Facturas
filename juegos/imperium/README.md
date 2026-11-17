# IMPERIUM: Legions & Glory

Estrategia isométrica 2.5D ambientada en Roma: gestiona tu ciudad en tiempo real (también mientras
no juegas) y lanza asaltos contra provincias rivales con legiones, caballería, arietes y onagros.

> Proyecto independiente: no forma parte de los workspaces del ERP de la raíz del repositorio.

## Comandos

```bash
cd juegos/imperium
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: economía offline, combate, balística, A*, isométrico
npm run build      # typecheck + build de producción en dist/
```

## Estructura

```
src/
  data/gameConfig.ts        Única fuente de equilibrio: paleta, recursos, Senado, edificios, unidades, bendiciones, botín
  engine/IsoGrid.ts         IsoRenderer (cartesiano ↔ isométrico) y sortEntitiesByDepth (Z-sorting)
  engine/Ballistics.ts      Tiros parabólicos reales (por ángulo y por velocidad), posición en vuelo
  engine/Pathfinding.ts     A* de 8 direcciones con montículo binario y costes por casilla
  systems/Economy.ts        Estado serializable, producción/consumo, obras, cola de entrenamiento, simulación offline
  systems/Combat.ts         Motor de batalla determinista de paso fijo (IA, defensas, proyectiles, Testudo, splash, botín, estrellas)
  systems/BaseGenerator.ts  Provincias rivales procedurales y deterministas (semilla)
  systems/SaveSystem.ts     Guardado en localStorage
  render/Renderer.ts        Canvas 2D: terreno, edificios romanos, unidades, proyectiles, partículas, día/noche y antorchas
  ui/Hud.ts                 Interfaz "Roman Codex" (paneles de piedra, bronce, Cinzel)
  audio/Sfx.ts              Efectos metálicos sintetizados con Web Audio
  main.ts                   Bucle principal y máquina de estados aldea ↔ batalla
tests/                      Pruebas de reglas del GDD
```

## Reglas clave implementadas

- **Senado**: tabla del GDD exacta (coste, tiempo, PV, límite de tropas); su nivel limita copias y niveles de cada edificio.
- **Economía**: 4 recursos almacenables + áureos. Productores, almacenes con capacidad, 2 fabri, aceleración con áureos.
  El ejército consume trigo (2/h por espacio).
- **Simulación offline**: `simular(estado, ahora)` avanza por tramos entre eventos (fin de obras y entrenamientos),
  así una mejora que termina a mitad de la ausencia cambia la producción desde ese instante exacto.
- **Unidades** (stats del GDD): Legionario con *Testudo* (−70 % daño de proyectiles en grupos de 4+),
  Vélite a distancia, Equites ×2.5 contra almacenes, Ariete ×40 contra murallas, Onagro con tiro parabólico,
  salpicadura de radio 2.5 y zona muerta < 3.
- **IA de combate**: objetivo por preferencia, ruta A* hasta una casilla en alcance; las murallas son atravesables
  con coste alto y se atacan si la ruta óptima las cruza; replanificación al caer cualquier edificio.
- **Batalla**: zona roja de despliegue, fase de exploración sin reloj, 3 minutos, estrellas (50 %, Senado, 100 %),
  botín proporcional al daño, bendiciones de Marte/Minerva pagadas con Favor.

## Controles

Arrastrar: mover cámara · Rueda / botones ＋－: zoom · Clic: seleccionar / colocar · Clic derecho o Esc: cancelar ·
En batalla: elegir unidad y tocar (o mantener pulsado) fuera de la zona roja.
