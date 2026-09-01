import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Configuración de ESLint para el monorepo.
 *
 * Criterio: reglas que detectan errores reales, no reglas de estilo. El
 * formato lo decide Prettier (`eslint-config-prettier` desactiva todo lo que
 * se solape), así que aquí nadie discute sobre comillas ni comas finales.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/drizzle/**',
      // Lo genera Next en cada arranque; no es código nuestro.
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Un argumento sin usar puede ser deliberado; se marca con guion bajo.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Los decoradores de NestJS y el tipado de Drizzle obligan a algún any
      // puntual; se avisa para que no pase inadvertido, sin romper el build.
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Los tests pueden ser más laxos con los tipos.
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // Scripts de siembra y migración: la consola es su interfaz.
    files: ['packages/db/src/**', '**/*.config.*'],
    rules: { 'no-console': 'off' },
  },
);
