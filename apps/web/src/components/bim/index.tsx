'use client';

import dynamic from 'next/dynamic';

/**
 * `BimViewer` usa WebGL + WASM (`three` + `web-ifc`): no puede renderizarse
 * en el servidor. `ssr: false` lo carga solo en el navegador, con un
 * fallback simple mientras llega el chunk.
 */
export const BimViewer = dynamic(
  () => import('./BimViewer').then((m) => m.BimViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[560px] w-full items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-500">
        Cargando visor 3D…
      </div>
    ),
  },
);

export type { ElementClickInfo } from './BimViewer';
