import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // `json` es el que escribe `coverage-final.json` — a diferencia de
      // Jest (que siempre lo escribe internamente, lo pidas o no),
      // Vitest solo lo genera si está en esta lista. Lo necesita
      // `scripts/merge-coverage.mjs` para fusionar esta cobertura con la
      // de `apps/api`.
      reporter: ['text', 'lcov', 'html', 'json'],
      reportsDirectory: './coverage',
      // Solo lógica de negocio pura: nada de tipos/esquemas Zod sin
      // función asociada, que inflarían el % sin decir nada de si está
      // probado el cálculo real.
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/proveedores/**', // ajeno a esta tarea, ver Roadmap y Fases
      ],
      thresholds: {
        // Ver `README de cobertura` en `Estrategia de Testing y Calidad.md`
        // para el porqué del 80 % exacto: es el umbral pedido por la
        // tarea, y `packages/shared` (lógica pura, sin Nest ni DB) es
        // donde tiene sentido exigirlo — medido en vivo antes de fijarlo
        // aquí, no a ciegas.
        lines: 80,
        statements: 80,
        branches: 70,
        functions: 80,
      },
    },
  },
});
