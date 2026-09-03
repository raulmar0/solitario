/* Service worker del solitario. Escrito a mano: el proyecto no tiene build.
 *
 * La lista de ficheros y la versión las escribe `npm run version` a partir de
 * package.json, y hay una prueba que comprueba que no se hayan descolgado.
 *
 * A propósito NO se llama a skipWaiting() al instalar: el worker nuevo se queda
 * esperando y el jugador decide cuándo saltar, con el botón de actualizar. Así
 * no se le cambia la aplicación debajo de los pies a media partida.
 */

/* === generado: versión === */
const VERSION = '1.6.1';
/* === fin generado === */

/* La huella del contenido de los ficheros. Va en el nombre de la caché para que
 * (a) una versión nueva nunca escriba encima de la caja que está sirviendo la
 * anterior, y (b) un cambio de código sin subir la versión también renueve la
 * caché en vez de dejar a los ya instalados atrapados en lo viejo. */
/* === generado: huella === */
const BUILD = '4dc27290';
/* === fin generado === */

const CACHE = `solitario-v${VERSION}-${BUILD}`;

/* === generado: ficheros === */
const FICHEROS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon.svg',
  'icons/maskable-512.png',
  'src/advisor.js',
  'src/cards.js',
  'src/engine.js',
  'src/game.js',
  'src/i18n.js',
  'src/main.js',
  'src/motion.js',
  'src/panels.js',
  'src/pwa.js',
  'src/reto.js',
  'src/scoring.js',
  'src/solvable-seeds.js',
  'src/sonidos.js',
  'src/storage.js',
  'src/ui.js',
  'src/version.js',
  'src/locales/en.js',
  'src/locales/es.js',
  'src/locales/fr.js',
  'src/locales/ko.js',
  'src/locales/pt.js',
];
/* === fin generado === */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      // `cache: 'reload'` salta la caché HTTP del navegador: GitHub Pages sirve
      // los ficheros con max-age, y sin esto una versión nueva podría precargar
      // los ficheros viejos que aún estén frescos.
      await Promise.all(FICHEROS.map(async (ruta) => {
        const respuesta = await fetch(new Request(ruta, { cache: 'reload' }));
        if (!respuesta.ok) throw new Error(`${ruta}: ${respuesta.status}`);
        await cache.put(ruta, respuesta);
      }));
    } catch (error) {
      await caches.delete(CACHE);   // media precarga es peor que ninguna
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres
      .filter((n) => n.startsWith('solitario-v') && n !== CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/** El único mensaje que entiende: «deja de esperar y toma el control». */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'VERSION') event.source?.postMessage({ type: 'VERSION', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // el juego no pide nada fuera

  // Navegar siempre devuelve la portada: es una aplicación de una sola página.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match('./')) || (await cache.match('index.html'))
        || fetch(request).catch(() => new Response('Sin conexión', { status: 503 }));
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(request, { ignoreSearch: true });
    if (guardado) return guardado;
    try {
      return await fetch(request);
    } catch {
      return new Response('Sin conexión', { status: 503, statusText: 'Sin conexión' });
    }
  })());
});
