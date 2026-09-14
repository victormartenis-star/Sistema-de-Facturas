import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@erp/shared'],
  // Genera .next/standalone: un node_modules propio con solo lo que se usa
  // de verdad, para no depender de la instalación completa del monorepo en
  // la imagen Docker de producción. Ver apps/web/Dockerfile.
  output: 'standalone',
  // Sin esto, en un monorepo Next a veces detecta la raíz de trazado a
  // partir de apps/web en vez de la raíz real del repo (donde está
  // package-lock.json), y se deja fuera del standalone lo que hace falta
  // de packages/shared. Explícito en vez de fiarlo a la autodetección.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  experimental: {
    // Desactiva symlinks en Windows (causa EINVAL en interception routes)
    webpackBuildWorker: false,
  },
};

export default nextConfig;
