// Ejecuta sw.js de verdad dentro de un entorno de service worker fingido.
// Es la única forma de comprobar la caché sin navegador, y es justo donde
// duelen los fallos: una precarga a medias deja la aplicación rota sin conexión.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = 'https://raulmar0.github.io/solitario/';
const CODIGO = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

const normalizar = (clave, { sinBusqueda = false } = {}) => {
  const url = new URL(typeof clave === 'string' ? clave : clave.url, BASE);
  if (sinBusqueda) url.search = '';
  return url.href;
};

class RespuestaFalsa {
  constructor(cuerpo, { status = 200, statusText = '' } = {}) {
    this.cuerpo = cuerpo;
    this.status = status;
    this.statusText = statusText;
  }
  get ok() { return this.status >= 200 && this.status < 300; }
}

class PeticionFalsa {
  constructor(url, { method = 'GET', mode = 'no-cors', cache = 'default' } = {}) {
    this.url = new URL(url, BASE).href;
    this.method = method;
    this.mode = mode;
    this.cache = cache;
  }
}

function almacenFalso() {
  const cajas = new Map();
  return {
    cajas,
    async open(nombre) {
      if (!cajas.has(nombre)) cajas.set(nombre, new Map());
      const caja = cajas.get(nombre);
      return {
        async put(clave, respuesta) { caja.set(normalizar(clave), respuesta); },
        async match(clave, opciones = {}) {
          const directo = caja.get(normalizar(clave));
          if (directo || !opciones.ignoreSearch) return directo;
          return caja.get(normalizar(clave, { sinBusqueda: true }));
        },
        get claves() { return [...caja.keys()]; },
      };
    },
    async keys() { return [...cajas.keys()]; },
    async delete(nombre) { return cajas.delete(nombre); },
  };
}

/** Carga sw.js con un `self`, `caches` y `fetch` de mentira. */
function montarWorker({ fetchFalso } = {}) {
  const oyentes = new Map();
  const peticiones = [];
  const caches = almacenFalso();
  const self = {
    location: new URL(BASE),
    registration: { scope: BASE },
    saltoDeEspera: 0,
    reclamos: 0,
    skipWaiting() { self.saltoDeEspera += 1; },
    clients: { claim: async () => { self.reclamos += 1; } },
    addEventListener(tipo, fn) { oyentes.set(tipo, fn); },
  };

  // El envoltorio de abajo ya apunta cada petición; aquí solo se responde.
  const fetch = fetchFalso ?? (async (peticion) => new RespuestaFalsa(`contenido de ${peticion.url ?? peticion}`));

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', CODIGO)(
    self, caches, (p) => { peticiones.push(p); return fetch(p); },
    PeticionFalsa, RespuestaFalsa, URL,
  );

  const lanzar = async (tipo, evento = {}) => {
    const fn = oyentes.get(tipo);
    assert.ok(fn, `sw.js no escucha «${tipo}»`);
    let esperado = null;
    let respondido = null;
    fn({ ...evento, waitUntil: (p) => { esperado = p; }, respondWith: (p) => { respondido = p; } });
    if (esperado) await esperado;
    return respondido ? await respondido : null;
  };

  return { self, caches, peticiones, lanzar, oyentes };
}

const FICHEROS = [...CODIGO.matchAll(/^\s{2}'([^']+)',$/gm)].map((m) => m[1]);
const VERSION = /const VERSION = '([^']+)'/.exec(CODIGO)[1];
const BUILD = /const BUILD = '([^']+)'/.exec(CODIGO)[1];
const CACHE = `solitario-v${VERSION}-${BUILD}`;

test('al instalar precarga todos los ficheros de la aplicación', async () => {
  const w = montarWorker();
  await w.lanzar('install');

  const caja = await w.caches.open(CACHE);
  assert.equal(caja.claves.length, FICHEROS.length);
  for (const f of FICHEROS) {
    assert.ok(await caja.match(f), `${f} no quedó guardado`);
  }
});

test('la precarga salta la caché del navegador', async () => {
  const w = montarWorker();
  await w.lanzar('install');
  assert.equal(w.peticiones.length, FICHEROS.length);
  for (const p of w.peticiones) {
    assert.equal(p.cache, 'reload', `${p.url} se pidió con la caché del navegador`);
  }
});

test('si un fichero falla, la instalación entera falla', async () => {
  // Media instalación es peor que ninguna: dejaría la aplicación rota sin conexión.
  const w = montarWorker({
    fetchFalso: async (p) => (p.url.endsWith('src/ui.js')
      ? new RespuestaFalsa('', { status: 404 })
      : new RespuestaFalsa('ok')),
  });
  await assert.rejects(() => w.lanzar('install'), /ui\.js: 404/);
});

test('al activarse borra las versiones viejas y solo las suyas', async () => {
  const w = montarWorker();
  w.caches.cajas.set('solitario-v0.9.0-aaaaaaaa', new Map());
  w.caches.cajas.set(`solitario-v${VERSION}-99999999`, new Map());   // misma versión, otro contenido
  w.caches.cajas.set('otra-app-cache', new Map());
  await w.lanzar('install');
  await w.lanzar('activate');

  const quedan = await w.caches.keys();
  assert.deepEqual(quedan.sort(), [CACHE, 'otra-app-cache'].sort());
  assert.equal(w.self.reclamos, 1, 'toma el control de las pestañas abiertas');
});

test('navegar devuelve la portada guardada, también sin conexión', async () => {
  const w = montarWorker();
  await w.lanzar('install');
  const sinRed = montarWorker({ fetchFalso: async () => { throw new Error('sin conexión'); } });
  sinRed.caches.cajas.set(CACHE, w.caches.cajas.get(CACHE));

  const r = await sinRed.lanzar('fetch', {
    request: new PeticionFalsa(`${BASE}alguna/ruta`, { mode: 'navigate' }),
  });
  assert.ok(r, 'responde el worker');
  assert.match(r.cuerpo, /contenido de .*solitario\/$/, 'sirve la portada');
});

test('los ficheros guardados salen de la caché sin tocar la red', async () => {
  const w = montarWorker();
  await w.lanzar('install');
  const antes = w.peticiones.length;

  const r = await w.lanzar('fetch', { request: new PeticionFalsa(`${BASE}src/engine.js`) });
  assert.match(r.cuerpo, /src\/engine\.js/);
  assert.equal(w.peticiones.length, antes, 'ni una petición más');
});

test('un fichero con ?v=algo también se reconoce', async () => {
  const w = montarWorker();
  await w.lanzar('install');
  const r = await w.lanzar('fetch', { request: new PeticionFalsa(`${BASE}styles.css?v=3`) });
  assert.match(r.cuerpo, /styles\.css/);
});

test('lo que no está guardado y no hay red devuelve 503, no una excepción', async () => {
  const w = montarWorker();
  await w.lanzar('install');
  const sinRed = montarWorker({ fetchFalso: async () => { throw new Error('sin conexión'); } });
  sinRed.caches.cajas.set(CACHE, w.caches.cajas.get(CACHE));

  const r = await sinRed.lanzar('fetch', { request: new PeticionFalsa(`${BASE}no-existe.js`) });
  assert.equal(r.status, 503);
});

test('no se mete donde no le llaman: otros dominios y peticiones que no son GET', async () => {
  const w = montarWorker();
  await w.lanzar('install');

  assert.equal(await w.lanzar('fetch', { request: new PeticionFalsa('https://ejemplo.com/x.js') }), null);
  assert.equal(await w.lanzar('fetch', { request: new PeticionFalsa(`${BASE}src/ui.js`, { method: 'POST' }) }), null);
});

test('obedece la orden de dejar de esperar, y solo esa', async () => {
  const w = montarWorker();
  await w.lanzar('message', { data: { type: 'OTRA_COSA' } });
  assert.equal(w.self.saltoDeEspera, 0);
  await w.lanzar('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(w.self.saltoDeEspera, 1);
});

test('sabe decir en qué versión está', async () => {
  const w = montarWorker();
  const recibido = [];
  await w.lanzar('message', { data: { type: 'VERSION' }, source: { postMessage: (m) => recibido.push(m) } });
  assert.deepEqual(recibido, [{ type: 'VERSION', version: VERSION }]);
});


test('la huella del contenido va en el nombre de la caché', () => {
  assert.match(BUILD, /^[0-9a-f]{8}$/);
  assert.ok(CACHE.includes(VERSION) && CACHE.includes(BUILD));
});

test('una instalación fallida no deja media caché escrita', async () => {
  const w = montarWorker({
    fetchFalso: async (p) => (p.url.endsWith('src/ui.js')
      ? new RespuestaFalsa('', { status: 404 })
      : new RespuestaFalsa('ok')),
  });
  await assert.rejects(() => w.lanzar('install'));
  assert.equal((await w.caches.keys()).includes(CACHE), false, 'la caja a medias se borra');
});
