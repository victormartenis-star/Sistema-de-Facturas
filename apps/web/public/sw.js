/**
 * Service worker de la app de obra — cachea el cascarón de la app (HTML de
 * navegación + estáticos propios) para que abrir la PWA sin cobertura
 * siga funcionando; la escritura offline (partes diarios, fichajes,
 * checklist PRL, fotos de avance) no pasa por aquí, vive en la cola de
 * IndexedDB de `apps/web/src/lib/offline-queue.ts` y se sincroniza sola
 * al recuperar conexión.
 *
 * Deliberadamente NO cachea `/_next/static/*` (los chunks JS con hash):
 * eso exigiría un manifiesto de precaché generado en build (Workbox/
 * next-pwa), fuera de alcance aquí. Con esto, la navegación offline sirve
 * el HTML cacheado de la última visita — suficiente para que la PWA abra
 * y el usuario rellene un formulario sin cobertura — pero no garantiza
 * que cada chunk JS esté disponible si nunca se visitó esa ruta antes.
 */

const CACHE_NAME = 'erp-obra-shell-v1';
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        // Sin red en la instalación (poco común, pero no debe romper el SW).
      }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Nunca intercepta escrituras: van directas a la API o a la cola offline.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // La API vive en otro origen (NEXT_PUBLIC_API_URL) — nunca se cachea aquí.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/')),
        ),
    );
    return;
  }

  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/wasm/') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
