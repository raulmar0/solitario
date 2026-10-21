// Simple Analytics: qué se manda, qué no, y que el script está en el HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ajuste, alSalir, definirContexto, evento, eventoPartida,
  limpiarMetadatos, montar, motivo, observarPartida,
} from '../src/analitica.js';
import es from '../src/locales/es.js';
import en from '../src/locales/en.js';
import fr from '../src/locales/fr.js';
import pt from '../src/locales/pt.js';
import ko from '../src/locales/ko.js';

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');

function colaLimpia() {
  delete globalThis.sa_event;
  delete globalThis.saMetadata;
}

function encolados() {
  return globalThis.sa_event?.q ?? [];
}

test('los metadatos tiran el nombre, el correo y lo que no se puede guardar', () => {
  assert.deepEqual(limpiarMetadatos({
    playerName: 'Ada',
    nombre: 'Ada',
    player: 'Ada',
    email: 'ada@example.com',
    correo: 'ada@example.com',
    nota: 'hola@no.es',
    vacio: '   ',
    nada: null,
    infinito: Infinity,
    anidado: { a: 1 },
    lista: [1],
    robo: 0,
    reto: false,
    idioma: 'es',
  }), { robo: 0, reto: false, idioma: 'es' });
});

test('un evento se encola y no arrastra el nombre', () => {
  colaLimpia();
  evento('partida_ganada', { puntos: 10, playerName: 'Ada', nombre: 'Ada' });
  evento('visita');
  assert.deepEqual(encolados(), [
    ['partida_ganada', { puntos: 10 }],
    ['visita'],
  ]);
});

test('el ajuste del nombre solo dice si está vacío', () => {
  colaLimpia();
  ajuste('playerName', 'Ada Lovelace');
  ajuste('lang', 'ko');
  ajuste('drawCount', 3);
  ajuste('sound', false);
  const cola = encolados();
  assert.deepEqual(cola[0][1], { clave: 'nombre', vacio: false });
  assert.equal(JSON.stringify(cola), JSON.stringify(cola).replace('Ada', ''));
  assert.deepEqual(cola[1][1], { clave: 'lang', valor: 'ko' });
  assert.deepEqual(cola[2][1], { clave: 'drawCount', valor: 3 });
  assert.deepEqual(cola[3][1], { clave: 'sound', valor: false });
});

test('el colector no revienta y tampoco deja pasar el nombre', () => {
  definirContexto(() => ({ version: '1.2.3', playerName: 'Ada', idioma: 'es', ancho: 0 }));
  assert.deepEqual(globalThis.saMetadata({ type: 'pageview' }), { version: '1.2.3', idioma: 'es', ancho: 0 });
  definirContexto(() => { throw new Error('roto'); });
  assert.deepEqual(globalThis.saMetadata({}), {});
});

test('repartir, deshacer y atascarse se anotan, y el motivo se consume', () => {
  colaLimpia();
  const oyentes = new Set();
  const game = {
    dealId: 1,
    undos: 0,
    status: 'playing',
    seed: 42,
    dia: null,
    moves: 3,
    hints: 1,
    elapsedMs: 5000,
    score: 20,
    foundationCount: 2,
    mode: { drawCount: 3, scoring: 'vegas', timed: false, penalizeHints: true },
    prefs: { dealBias: 'solvable', playerName: 'Ada' },
    hasAnyMove: true,
    subscribe(fn) { oyentes.add(fn); return () => oyentes.delete(fn); },
  };
  observarPartida(game);
  assert.equal(encolados().length, 0, 'suscribirse no es repartir');

  motivo('reto');
  game.dealId = 2;
  game.dia = '2026-10-21';
  game.seed = 99;
  game.undos = 0;
  for (const fn of oyentes) fn();

  game.undos = 1;
  game.moves = 2;
  for (const fn of oyentes) fn();

  game.status = 'stuck';
  for (const fn of oyentes) fn();
  for (const fn of oyentes) fn();

  const nombres = encolados().map((fila) => fila[0]);
  assert.deepEqual(nombres, ['partida_nueva', 'deshacer', 'partida_atascada']);
  const nueva = encolados()[0][1];
  assert.equal(nueva.motivo, 'reto');
  assert.equal(nueva.dia, '2026-10-21');
  assert.equal(nueva.semilla, 99);
  assert.equal(nueva.robo, 3);
  assert.equal(nueva.puntuacion, 'vegas');
  assert.equal(nueva.contrarreloj, false);
  assert.equal(nueva.playerName, undefined);
  assert.equal(JSON.stringify(nueva).includes('Ada'), false);
  assert.equal(encolados()[1][1].n, 1);
  assert.equal(encolados()[2][1].rescate, true);

  motivo('nueva');
  game.dealId = 3;
  game.status = 'playing';
  for (const fn of oyentes) fn();
  assert.equal(encolados().at(-1)[1].motivo, 'nueva');
  game.dealId = 4;
  for (const fn of oyentes) fn();
  assert.equal(encolados().at(-1)[1].motivo, 'otra', 'el motivo no se queda pegado a la mano siguiente');
});

test('la foto de la partida no incluye el nombre', () => {
  colaLimpia();
  eventoPartida('partida_retomada', {
    seed: 7,
    dia: null,
    moves: 4,
    hints: 0,
    undos: 1,
    elapsedMs: 1500,
    score: -10,
    foundationCount: 3,
    status: 'playing',
    mode: { drawCount: 1, scoring: 'standard', timed: true },
    prefs: { dealBias: 'random', playerName: 'Nadie' },
  });
  const meta = encolados()[0][1];
  assert.equal(meta.semilla, 7);
  assert.equal(meta.reto, false);
  assert.equal(meta.segundos, 1);
  assert.equal(meta.puntos, -10);
  assert.equal(JSON.stringify(meta).includes('Nadie'), false);
});

test('el script está en el HTML, que es lo que mira el comprobador de Simple Analytics', () => {
  const html = leer('index.html');
  const etiqueta = /<script async src="https:\/\/scripts\.simpleanalyticscdn\.com\/latest\.js"[^>]*>/.exec(html)?.[0];
  assert.ok(etiqueta, 'sin esta etiqueta el comprobador dice que no está instalado');
  assert.match(etiqueta, /data-collect-dnt="true"/);
  assert.match(etiqueta, /data-allow-params="seed,reto"/);
  assert.match(etiqueta, /data-metadata-collector="saMetadata"/);
  // Delante de la política el navegador todavía no la ha leído y bloquea el script.
  const politica = html.indexOf('Content-Security-Policy');
  const script = html.indexOf('scripts.simpleanalyticscdn.com/latest.js');
  assert.ok(politica >= 0 && politica < script, 'la política tiene que ir antes que el script');
});

test('cerrar la pestaña manda la foto y un enlace externo se anota sin soltar el clic', () => {
  colaLimpia();
  const oyentes = {};
  const doc = {
    head: { append() {} },
    createElement() { return { dataset: {} }; },
    querySelector() { return null; },
    addEventListener(tipo, fn, captura) {
      assert.equal(tipo, 'click');
      assert.equal(captura, true);
      oyentes.click = fn;
    },
  };
  const destino = {
    addEventListener(tipo, fn) { oyentes[tipo] = fn; },
  };
  let salidas = 0;
  alSalir(() => {
    salidas += 1;
    return { partida: 'playing', jugadas: 4, playerName: 'Ada' };
  });
  montar({ document: doc, destino, hostname: 'localhost', userAgent: 'Mozilla' });
  oyentes.pagehide();
  assert.equal(salidas, 1);
  assert.equal(encolados().at(-1)[0], 'salida');
  assert.equal(encolados().at(-1)[1].jugadas, 4);
  assert.equal(encolados().at(-1)[1].playerName, undefined);

  const enlace = {
    href: 'https://apolar.co/camino',
    getAttribute: () => 'https://apolar.co/',
  };
  let seguido = false;
  const eventoClic = {
    target: { closest: (sel) => (sel === 'a[href]' ? enlace : null) },
    preventDefault() { seguido = true; },
  };
  oyentes.click(eventoClic);
  assert.equal(seguido, false, 'anotar el clic no puede frenar el enlace');
  assert.equal(encolados().at(-1)[0], 'enlace_saliente');
  assert.equal(encolados().at(-1)[1].dominio, 'apolar.co');
  assert.equal(encolados().at(-1)[1].ruta, '/camino');

  oyentes.offline();
  assert.equal(encolados().at(-1)[0], 'sin_conexion');
});

function politica(texto) {
  return (/Content-Security-Policy" content="([^"]+)"/.exec(texto)
    ?? /Content-Security-Policy "([^"]+)"/.exec(texto))[1];
}

test('la política de seguridad deja pasar el script y el píxel, y sigue sin manejadores en línea', () => {
  for (const ruta of ['index.html', 'nginx.conf']) {
    const csp = politica(leer(ruta));
    assert.match(csp, /script-src [^;]*https:\/\/scripts\.simpleanalyticscdn\.com/);
    assert.match(csp, /img-src [^;]*https:\/\/queue\.simpleanalyticscdn\.com/);
    assert.match(csp, /connect-src [^;]*https:\/\/queue\.simpleanalyticscdn\.com/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.match(csp, /default-src 'none'/);
  }
});

test('la ayuda, en los cinco idiomas, cuenta que las visitas se miden y el nombre no', () => {
  for (const dic of [es, en, fr, pt, ko]) {
    assert.match(dic['help.privacidad'], /Simple Analytics/);
    assert.doesNotMatch(dic['help.privacidad'], /No sale nada|Nothing goes out|Rien ne part|Não sai nada|나가는 건 하나도/);
  }
});
