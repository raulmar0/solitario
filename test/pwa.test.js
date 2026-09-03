// Aplicación instalable: ciclo de vida del service worker, el propio worker
// (cargado en un entorno de mentira) y la coherencia de versión y manifiesto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { esperarEstado, buscarWorkerNuevo, esIos, esStandalone, SIN_RED, registrarServiceWorker, crearInstalador } from '../src/pwa.js';
import { VERSION } from '../src/version.js';
import { ficherosDelApp, huella } from '../scripts/version.js';

const RAIZ = new URL('..', import.meta.url);
const leer = (p) => readFileSync(new URL(p, RAIZ), 'utf8');

// --- dobles ---

function workerFalso(inicial = 'installing') {
  let estado = inicial;
  const oyentes = new Set();
  return {
    get state() { return estado; },
    get oyentes() { return oyentes.size; },
    addEventListener(tipo, fn) { if (tipo === 'statechange') oyentes.add(fn); },
    removeEventListener(tipo, fn) { oyentes.delete(fn); },
    pasarA(nuevo) { estado = nuevo; for (const fn of [...oyentes]) fn(); },
  };
}

function registroFalso({ installing = null, waiting = null, alActualizar } = {}) {
  const oyentes = new Set();
  const reg = {
    installing, waiting,
    llamadasUpdate: 0,
    get oyentes() { return oyentes.size; },
    addEventListener(tipo, fn) { if (tipo === 'updatefound') oyentes.add(fn); },
    removeEventListener(tipo, fn) { oyentes.delete(fn); },
    async update() { reg.llamadasUpdate += 1; return alActualizar?.(reg); },
    emitirUpdateFound() { for (const fn of [...oyentes]) fn(); },
  };
  return reg;
}

// --- esperarEstado ---

test('si el worker ya está en el estado buscado, resuelve al momento', async () => {
  const w = workerFalso('activated');
  assert.equal(await esperarEstado(w, ['activated'], 50), 'activated');
  assert.equal(w.oyentes, 0, 'ni siquiera se suscribe');
});

test('espera al cambio de estado y se da de baja al terminar', async () => {
  const w = workerFalso('installing');
  const promesa = esperarEstado(w, ['installed', 'activated'], 1000);
  assert.equal(w.oyentes, 1);
  w.pasarA('installed');
  assert.equal(await promesa, 'installed');
  assert.equal(w.oyentes, 0, 'no deja el oyente colgado');
});

test('los estados que no interesan no despiertan la espera', async () => {
  const w = workerFalso('installing');
  const promesa = esperarEstado(w, ['activated'], 300);
  w.pasarA('installed');
  w.pasarA('activating');
  w.pasarA('activated');
  assert.equal(await promesa, 'activated');
});

test('si se acaba el tiempo devuelve null, no revienta', async () => {
  const w = workerFalso('installing');
  assert.equal(await esperarEstado(w, ['activated'], 40), null);
  assert.equal(w.oyentes, 0);
});

test('un worker que muere al instalar se reconoce como redundante', async () => {
  const w = workerFalso('installing');
  const promesa = esperarEstado(w, ['installed', 'activated', 'redundant'], 1000);
  w.pasarA('redundant');
  assert.equal(await promesa, 'redundant');
});

// --- buscarWorkerNuevo ---

test('si ya hay uno instalándose o esperando, ese vale', async () => {
  const instalando = workerFalso('installing');
  const reg = registroFalso({ installing: instalando });
  assert.equal(await buscarWorkerNuevo(reg, 10), instalando);
  assert.equal(reg.llamadasUpdate, 0, 'no hace falta preguntar al servidor');

  const esperando = workerFalso('installed');
  assert.equal(await buscarWorkerNuevo(registroFalso({ waiting: esperando }), 10), esperando);
});

test('si no hay ninguno, pregunta al servidor y devuelve el que aparezca', async () => {
  const nuevo = workerFalso('installing');
  const reg = registroFalso({ alActualizar: (r) => { r.installing = nuevo; } });
  assert.equal(await buscarWorkerNuevo(reg, 10), nuevo);
  assert.equal(reg.llamadasUpdate, 1);
});

test('estamos al día: devuelve null tras el respiro', async () => {
  const reg = registroFalso();
  const t = Date.now();
  assert.equal(await buscarWorkerNuevo(reg, 60), null);
  assert.ok(Date.now() - t >= 55, 'da el respiro completo a updatefound');
  assert.equal(reg.oyentes, 0, 'y se da de baja');
});

test('updatefound tardío durante el respiro también se recoge', async () => {
  const reg = registroFalso();
  const promesa = buscarWorkerNuevo(reg, 500);
  await new Promise((r) => setTimeout(r, 20));
  const tardio = workerFalso('installing');
  reg.installing = tardio;
  reg.emitirUpdateFound();
  assert.equal(await promesa, tardio);
  assert.equal(reg.oyentes, 0);
});

test('sin conexión no se dice «estás al día»: se distingue del caso de verdad', async () => {
  const reg = registroFalso({ alActualizar: () => { throw new Error('offline'); } });
  assert.equal(await buscarWorkerNuevo(reg, 10), SIN_RED);
  assert.notEqual(SIN_RED, null, 'que no se confunda con «no hay versión nueva»');
});

// --- detección de entorno ---

test('esIos y esStandalone reconocen cada entorno', () => {
  // En Node `navigator` es solo de lectura: hay que redefinir la propiedad.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const ventana = globalThis.window;
  const ponerNavegador = (valor) => Object.defineProperty(globalThis, 'navigator', { value: valor, configurable: true, writable: true });
  try {
    ponerNavegador({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    globalThis.window = { matchMedia: () => ({ matches: false }), navigator: globalThis.navigator };
    assert.equal(esIos(), true);
    assert.equal(esStandalone(), false, 'en el navegador, no instalada');

    globalThis.window = { matchMedia: () => ({ matches: true }), navigator: {} };
    assert.equal(esStandalone(), true, 'display-mode: standalone');

    ponerNavegador({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
    globalThis.window = { matchMedia: () => ({ matches: false }), navigator: { standalone: true } };
    assert.equal(esIos(), false);
    assert.equal(esStandalone(), true, 'el modo de iOS de toda la vida');
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    globalThis.window = ventana;
  }
});

// --- versión y ficheros: una sola fuente de verdad ---

test('el manifiesto no fija un id relativo, que apuntaría a la raíz del dominio', () => {
  const m = JSON.parse(leer('manifest.webmanifest'));
  const identidad = new URL(m.id ?? m.start_url, 'https://raulmar0.github.io/solitario/').href;
  assert.equal(identidad, 'https://raulmar0.github.io/solitario/',
    'con «./» el id se resuelve contra el origen y choca con las demás PWA del mismo github.io');
});

test('nginx amplía el mapa MIME en vez de sustituirlo', () => {
  const conf = leer('nginx.conf');
  if (!/^\s*types \{/m.test(conf)) return;
  const indiceInclude = conf.indexOf('include /etc/nginx/mime.types;');
  const indiceTypes = conf.search(/^\s*types \{/m);
  assert.ok(indiceInclude >= 0,
    'un bloque `types` SUSTITUYE el mapa heredado: sin el include, nginx sirve todo como octet-stream');
  assert.ok(indiceInclude < indiceTypes, 'y el include tiene que ir antes');
});

test('la versión es la misma en package.json, src/version.js y sw.js', () => {
  const pkg = JSON.parse(leer('package.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(VERSION, pkg.version, 'src/version.js descolgado: ejecuta `npm run version`');
  const enSw = /const VERSION = '([^']+)'/.exec(leer('sw.js'))[1];
  assert.equal(enSw, pkg.version, 'sw.js descolgado: ejecuta `npm run version`');
});

test('el worker precarga exactamente lo que la aplicación necesita', () => {
  const enSw = [...leer('sw.js').matchAll(/^\s{2}'([^']+)',$/gm)].map((m) => m[1]);
  assert.deepEqual(enSw, ficherosDelApp(), 'lista descolgada: ejecuta `npm run version`');
  for (const ruta of enSw) {
    if (ruta === './') continue;
    assert.ok(existsSync(new URL(ruta, RAIZ)), `${ruta} no existe`);
  }
});

test('todo lo que carga la página está en la precarga', () => {
  const html = leer('index.html');
  const enSw = new Set([...leer('sw.js').matchAll(/^\s{2}'([^']+)',$/gm)].map((m) => m[1]));
  const referidos = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    .filter((r) => !r.startsWith('data:') && !r.startsWith('http') && !r.startsWith('#'));
  for (const r of referidos) assert.ok(enSw.has(r), `${r} sale en el HTML pero no se precarga`);

  // Y todos los módulos que importa el juego.
  for (const fichero of ficherosDelApp().filter((f) => f.startsWith('src/'))) {
    for (const [, rel] of leer(fichero).matchAll(/from '\.\/([^']+)'/g)) {
      assert.ok(enSw.has(`src/${rel}`), `src/${rel} se importa desde ${fichero} y no se precarga`);
    }
  }
});

// --- manifiesto ---

test('el manifiesto es válido y todo lo que promete existe', () => {
  const m = JSON.parse(leer('manifest.webmanifest'));
  assert.equal(m.name, 'Solitario Klondike');
  assert.ok(m.short_name.length <= 12, 'el nombre corto cabe bajo el icono');
  assert.equal(m.display, 'standalone');
  assert.match(m.start_url, /^\.\//, 'ruta relativa: la aplicación vive en /solitario/, no en la raíz');
  assert.match(m.scope, /^\.\//);
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);

  for (const icono of m.icons) {
    assert.ok(!icono.src.startsWith('/'), `${icono.src} debe ser relativo`);
    assert.ok(existsSync(new URL(icono.src, RAIZ)), `falta ${icono.src}`);
  }
  const tamanos = m.icons.map((i) => i.sizes);
  assert.ok(tamanos.includes('192x192') && tamanos.includes('512x512'), 'hacen falta 192 y 512');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'y uno recortable para Android');
});

test('la página enlaza el manifiesto, el icono de Apple y deja pasar el worker', () => {
  const html = leer('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /manifest-src 'self'/, "sin esto default-src 'none' bloquea el manifiesto");
  assert.match(csp, /worker-src 'self'/);
});

test('los PNG del icono son PNG de verdad y del tamaño que dicen', () => {
  const m = JSON.parse(leer('manifest.webmanifest'));
  for (const icono of m.icons.filter((i) => i.type === 'image/png')) {
    const datos = readFileSync(new URL(icono.src, RAIZ));
    assert.deepEqual([...datos.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'cabecera PNG');
    const ancho = datos.readUInt32BE(16);
    const alto = datos.readUInt32BE(20);
    assert.equal(`${ancho}x${alto}`, icono.sizes, `${icono.src} mide ${ancho}x${alto}`);
  }
});

// --- el propio service worker ---

test('el worker no se cuela solo: nada de skipWaiting al instalar', () => {
  const sw = leer('sw.js');
  const instalar = /addEventListener\('install'[\s\S]*?addEventListener\('activate'/.exec(sw)[0];
  assert.equal(/skipWaiting/.test(instalar), false,
    'si se colara, cambiaría la aplicación a media partida sin avisar');
  assert.match(sw, /data\?\.type === 'SKIP_WAITING'/, 'pero obedece cuando el jugador lo pide');
  assert.match(sw, /cache: 'reload'/, 'la precarga salta la caché HTTP del navegador');
});

test('la imagen de Docker copia todo lo que la aplicación precarga', () => {
  const docker = leer('Dockerfile');
  const copiados = [...docker.matchAll(/^COPY (.+) \/usr\/share\/nginx\/html/gm)]
    .flatMap((m) => m[1].trim().split(/\s+/));
  for (const ruta of ficherosDelApp()) {
    if (ruta === './') continue;
    const raizDeLaRuta = ruta.split('/')[0];
    assert.ok(copiados.includes(raizDeLaRuta) || copiados.includes(ruta),
      `${ruta} se precarga pero el Dockerfile no lo copia`);
  }
});

test('el servidor de desarrollo sabe servir el manifiesto', () => {
  assert.match(leer('scripts/dev.js'), /'\.webmanifest': 'application\/manifest\+json/);
});

// --- registro y actualización de punta a punta, con un navigator de mentira ---

function navegadorFalso({ conControlador = true, alActualizar } = {}) {
  const oyentes = new Map();
  const registro = {
    installing: null,
    waiting: null,
    scriptURL: null,
    opciones: null,
    oyentesReg: new Map(),
    addEventListener(t, fn) { registro.oyentesReg.set(t, fn); },
    removeEventListener(t) { registro.oyentesReg.delete(t); },
    async update() { registro.actualizado = (registro.actualizado ?? 0) + 1; return alActualizar?.(registro); },
    emitir(t) { registro.oyentesReg.get(t)?.(); },
  };
  const sw = {
    controller: conControlador ? { state: 'activated' } : null,
    async register(url, opciones) { registro.scriptURL = String(url); registro.opciones = opciones; return registro; },
    addEventListener(t, fn) { oyentes.set(t, fn); },
    emitir(t) { oyentes.get(t)?.(); },
  };
  return { sw, registro };
}

function conNavegador(sw, cuerpo) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const ventana = globalThis.window;
  let recargas = 0;
  Object.defineProperty(globalThis, 'navigator', {
    value: { serviceWorker: sw, userAgent: 'node' }, configurable: true, writable: true,
  });
  globalThis.window = {
    location: { reload() { recargas += 1; } },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    navigator: globalThis.navigator,
  };
  const restaurar = () => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    globalThis.window = ventana;
  };
  return { cuenta: () => recargas, restaurar, resultado: cuerpo?.() };
}

test('el worker se registra con la caché HTTP desactivada', async () => {
  const { sw, registro } = navegadorFalso();
  const ctx = conNavegador(sw);
  try {
    const pwa = registrarServiceWorker();
    assert.equal(pwa.soportado, true);
    await new Promise((r) => setImmediate(r));
    assert.equal(registro.opciones.updateViaCache, 'none', 'si no, el navegador podría servir un sw.js viejo');
    assert.match(registro.scriptURL, /sw\.js$/);
  } finally { ctx.restaurar(); }
});

test('al abrir comprueba si hay una versión nueva y la anuncia cuando queda instalada', async () => {
  const nuevo = workerFalso('installing');
  const { sw, registro } = navegadorFalso({
    alActualizar: (r) => {
      r.installing = nuevo;
      r.emitir('updatefound');
    },
  });
  const ctx = conNavegador(sw);
  try {
    const avisos = [];
    registrarServiceWorker({ onVersionNueva: (w) => avisos.push(w) });
    await new Promise((r) => setImmediate(r));

    assert.equal(registro.actualizado, 1, 'la pestaña pregunta al servidor al arrancar');
    assert.deepEqual(avisos, [], 'mientras se instala todavía no se avisa');
    nuevo.pasarA('installed');
    assert.deepEqual(avisos, [nuevo], 'cuando queda lista aparece el aviso');
  } finally { ctx.restaurar(); }
});

test('avisa cuando queda una versión nueva esperando', async () => {
  const { sw, registro } = navegadorFalso();
  const ctx = conNavegador(sw);
  try {
    const avisos = [];
    registrarServiceWorker({ onVersionNueva: (w) => avisos.push(w) });
    await new Promise((r) => setImmediate(r));

    const entrante = workerFalso('installing');
    registro.installing = entrante;
    registro.emitir('updatefound');
    assert.deepEqual(avisos, [], 'todavía se está instalando');

    entrante.pasarA('installed');
    assert.deepEqual(avisos, [entrante], 'ya lista: se avisa al jugador');
  } finally { ctx.restaurar(); }
});

test('la primerísima instalación no se anuncia como versión nueva', async () => {
  const { sw, registro } = navegadorFalso({ conControlador: false });
  const ctx = conNavegador(sw);
  try {
    const avisos = [];
    registrarServiceWorker({ onVersionNueva: (w) => avisos.push(w) });
    await new Promise((r) => setImmediate(r));

    const entrante = workerFalso('installing');
    registro.installing = entrante;
    registro.emitir('updatefound');
    entrante.pasarA('installed');
    assert.deepEqual(avisos, [], 'no hay «versión nueva» cuando no había ninguna vieja');
  } finally { ctx.restaurar(); }
});

test('actualizar manda dejar de esperar y recarga cuando el worker toma el control', async () => {
  const { sw, registro } = navegadorFalso();
  const ctx = conNavegador(sw);
  try {
    const esperando = workerFalso('installed');
    const mensajes = [];
    esperando.postMessage = (m) => {
      mensajes.push(m);
      setImmediate(() => esperando.pasarA('activated'));
    };
    registro.waiting = esperando;

    const pwa = registrarServiceWorker();
    await new Promise((r) => setImmediate(r));
    const resultado = await pwa.actualizar();

    assert.deepEqual(mensajes, [{ type: 'SKIP_WAITING' }]);
    assert.equal(resultado, 'actualizando');
    sw.emitir('controllerchange');
    assert.ok(ctx.cuenta() >= 1, 'la página se recarga en la versión nueva');
  } finally { ctx.restaurar(); }
});

test('un controllerchange que no hemos pedido no recarga nada', async () => {
  const { sw } = navegadorFalso();
  const ctx = conNavegador(sw);
  try {
    registrarServiceWorker();
    await new Promise((r) => setImmediate(r));
    sw.emitir('controllerchange');          // clients.claim() de la primera visita
    assert.equal(ctx.cuenta(), 0, 'recargar aquí tiraría la partida sin motivo');
  } finally { ctx.restaurar(); }
});

test('en la primera visita, buscar actualización no recarga: no hay a qué saltar', async () => {
  const { sw } = navegadorFalso({ conControlador: false });
  const ctx = conNavegador(sw);
  try {
    const pwa = registrarServiceWorker();
    await new Promise((r) => setImmediate(r));
    assert.equal(await pwa.actualizar(), 'primera-vez');
    assert.equal(ctx.cuenta(), 0);
  } finally { ctx.restaurar(); }
});

test('sin service worker en el navegador, todo responde sin romperse', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'viejo' }, configurable: true, writable: true });
    const pwa = registrarServiceWorker();
    assert.equal(pwa.soportado, false);
  } finally { if (original) Object.defineProperty(globalThis, 'navigator', original); }
});

// --- alta en el dispositivo ---

function ventanaFalsa() {
  const oyentes = new Map();
  return {
    matchMedia: () => ({ matches: false }),
    navigator: {},
    addEventListener(t, fn) { oyentes.set(t, fn); },
    emitir(t, evento) { oyentes.get(t)?.(evento); },
  };
}

test('la petición de instalar es de un solo uso, gane o pierda', async () => {
  const ventana = ventanaFalsa();
  const original = globalThis.window;
  globalThis.window = ventana;
  try {
    const instalador = crearInstalador();
    assert.equal(instalador.puede, false);

    let veces = 0;
    ventana.emitir('beforeinstallprompt', {
      preventDefault() {},
      prompt: async () => { veces += 1; },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    assert.equal(instalador.puede, true);

    assert.equal(await instalador.instalar(), 'dismissed');
    assert.equal(veces, 1);
    // Reutilizar el evento lanza InvalidStateError: no se puede volver a pedir.
    assert.equal(instalador.puede, false, 'el botón deja de ofrecerse');
    assert.equal(await instalador.instalar(), 'no-disponible');
    assert.equal(veces, 1);
  } finally { globalThis.window = original; }
});

test('si el navegador rechaza el diálogo, se informa en vez de reventar', async () => {
  const ventana = ventanaFalsa();
  const original = globalThis.window;
  globalThis.window = ventana;
  try {
    const instalador = crearInstalador();
    ventana.emitir('beforeinstallprompt', {
      preventDefault() {},
      prompt: async () => { throw new Error('InvalidStateError'); },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    assert.equal(await instalador.instalar(), 'error');
    assert.equal(instalador.puede, false);
  } finally { globalThis.window = original; }
});

test('la huella cambia en cuanto cambia un byte de la aplicación', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'solitario-'));
  try {
    writeFileSync(join(tmp, 'a.js'), 'export const x = 1;');
    const antes = huella(tmp, ['a.js']);
    writeFileSync(join(tmp, 'a.js'), 'export const x = 2;');
    const despues = huella(tmp, ['a.js']);
    assert.notEqual(antes, despues,
      'sin esto, tocar código sin subir la versión dejaría a los instalados en la versión vieja');
    assert.match(antes, /^[0-9a-f]{8}$/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('la huella escrita en sw.js es la del contenido de ahora mismo', () => {
  const enSw = /const BUILD = '([^']+)'/.exec(leer('sw.js'))[1];
  assert.equal(enSw, huella(), 'huella descolgada: ejecuta `npm run version`');
});
