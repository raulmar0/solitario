// Interfaz de la 1.5, en jsdom: deshacer sin rehacer, la cabecera nueva (chip de
// modalidad, progreso, pausa y compartir reparto), el ciclo de pistas, los avisos
// dentro del diálogo, los cinco idiomas en caliente, la baraja de cuatro colores,
// la quietud a petición, el tablero en pantallas estrechas y la evolución de
// récords. Mismo montaje que test/dom.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { MARGEN_ANIM } from '../src/ui.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
// jsdom no descarga la hoja de estilos: se inyecta para poder comprobar reglas.
const dom = new JSDOM(html.replace('</head>', `<style>${css}</style></head>`), { url: 'http://localhost:5173/', pretendToBeVisual: true });
const { window } = dom;

// La página se hizo para un navegador; le ponemos lo que jsdom no trae.
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
// jsdom no implementa <dialog>. El remedo tiene que disparar el evento `close`
// igual que un navegador: hay limpieza colgada de ahí (los avisos del panel).
if (!window.HTMLDialogElement.prototype.showModal) {
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function close(valor) {
    if (!this.open) return;
    this.open = false;
    if (valor !== undefined) this.returnValue = valor;
    this.dispatchEvent(new window.Event('close'));
  };
}
window.confirm = () => true;
window.alert = () => {};
window.URL.createObjectURL = () => 'blob:falso';
window.URL.revokeObjectURL = () => {};

// Tamaño de pantalla simulado: jsdom devuelve 0 en clientWidth.
for (const [prop, valor] of [['clientWidth', 1100], ['clientHeight', 760]]) {
  Object.defineProperty(window.HTMLElement.prototype, prop, { get() { return valor; }, configurable: true });
}

// Los temporizadores del juego no deben mantener vivo el proceso de pruebas.
const _setInterval = globalThis.setInterval;
const _setTimeout = globalThis.setTimeout;
globalThis.setInterval = (fn, ms) => { const t = _setInterval(fn, ms); t.unref?.(); return t; };
globalThis.setTimeout = (fn, ms) => { const t = _setTimeout(fn, ms); t.unref?.(); return t; };

globalThis.window = window;
globalThis.document = window.document;
globalThis.matchMedia = window.matchMedia.bind(window);
globalThis.confirm = window.confirm;
globalThis.alert = window.alert;
globalThis.Blob = window.Blob;
globalThis.URL = window.URL;
globalThis.addEventListener = window.addEventListener.bind(window);
globalThis.localStorage = window.localStorage;
// `compartirReparto` y `?seed=` leen `globalThis.location`; en node no existe.
globalThis.location = window.location;
// El navegador de node no tiene portapapeles y el de jsdom tampoco. Se pone uno
// propio y editable: cada prueba le enchufa o le quita `clipboard` a su gusto.
const navegador = { language: 'en-US', languages: ['en-US'], userAgent: window.navigator.userAgent };
Object.defineProperty(globalThis, 'navigator', { value: navegador, configurable: true, writable: true });

// El idioma se resuelve ANTES de importar main.js: en jsdom el navegador habla
// inglés, así que sin esto toda comparación de texto miraría el idioma que no es.
window.localStorage.setItem('solitario.v1.prefs', JSON.stringify({ lang: 'es' }));
// Con una partida ya apuntada, el juego no abre solo la ayuda de bienvenida.
window.localStorage.setItem('solitario.v1.stats', JSON.stringify({ 'standard-1': { played: 1, won: 0 } }));

await import('../src/main.js');
const { game, board, panels, refresh, store, i18n } = globalThis.solitario;
const { t } = i18n;
game.newGame(1);          // reparto fijo: las pruebas de interacción deben ser repetibles
board.cancel();           // sin la animación de reparto por medio

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];
const cssVar = (name) => parseFloat(window.document.documentElement.style.getPropertyValue(name));
const cartaEl = (id) => $(`.card[data-id="${id}"]`);
const carta = (rank, suit, faceUp = true) => ({ id: `${rank === 1 ? 'A' : rank === 11 ? 'J' : rank === 12 ? 'Q' : rank === 13 ? 'K' : rank}${suit}`, rank, suit, faceUp });

// Las reglas anidadas (dentro de @media) no salen del primer nivel: se bajan a mano.
const reglas = (lista = [...window.document.styleSheets].flatMap((h) => [...h.cssRules])) =>
  lista.flatMap((r) => (r.cssRules ? [r, ...reglas([...r.cssRules])] : [r]));
const regla = (selector) => reglas().find((r) => r.selectorText === selector);
function variables(selector) {
  const r = regla(selector);
  const salida = {};
  for (const nombre of r.style) salida[nombre] = r.style.getPropertyValue(nombre).trim();
  return salida;
}

/** Vacía el tablero y coloca solo las cartas del caso: si no, quedan duplicadas del reparto. */
function escenario({ tableau = [], waste = [], stock = [], foundations = [[], [], [], []] }) {
  for (const d of window.document.querySelectorAll('dialog')) d.close();
  game.newGame(1);
  board.cancel();
  Object.assign(game.state, {
    tableau: Array.from({ length: 7 }, (_, i) => tableau[i] ?? []),
    waste, stock, foundations,
  });
  board.settle();
  refresh();     // tocar el estado a mano no dispara la suscripción de la interfaz
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));


// ---------- deshacer, y ni rastro de rehacer ----------

test('la barra, el sprite y la ayuda hablan de deshacer y ya no prometen rehacer', () => {
  assert.equal($('#btn-redo'), null, 'el botón de rehacer se fue en la 1.5');
  assert.equal($('symbol#i-rehacer'), null, 'y su icono con él');

  const undo = $('#btn-undo');
  assert.ok(undo, 'en su sitio está el de deshacer');
  assert.equal(undo.closest('#tools') != null, true, 'abajo, donde llega el pulgar');
  assert.equal(undo.querySelector('.rotulo').textContent, 'Deshacer');
  assert.equal(undo.getAttribute('aria-label'), 'Deshacer (Ctrl+Z)');
  assert.equal(undo.querySelector('.ico use').getAttribute('href'), '#i-deshacer');
  assert.ok($('symbol#i-deshacer'), 'y el dibujo existe');

  assert.deepEqual($$('#tools .tool').map((b) => b.id),
    ['btn-new', 'btn-restart', 'btn-undo', 'btn-hint', 'btn-settings']);

  // La ayuda es el contrato con el jugador: si nombrara rehacer, mentiría.
  const ayuda = $('#panel-ayuda').textContent;
  assert.match(ayuda, /Ctrl\+Z/);
  assert.match(ayuda, /deshacer/);
  assert.equal(/rehacer|Ctrl\+Y/i.test(ayuda), false, 'la ayuda sigue prometiendo rehacer');
  assert.equal(/rehacer/i.test($('#tools').textContent), false, 'ni la barra');
});

test('lo deshecho, deshecho se queda: Ctrl+Y y Ctrl+Shift+Z ya no lo devuelven', () => {
  escenario({
    foundations: [[carta(1, 'S')], [], [], []],
    tableau: [[carta(2, 'S')]],
    stock: [carta(5, 'H', false)],
  });
  const subir = { type: 'move', from: { pile: 'tableau', index: 0 }, to: { pile: 'foundation', index: 0 }, count: 1 };
  assert.equal(game.play(subir), true);
  const conElDosArriba = JSON.stringify(game.state);
  const jugadas = game.moves;

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  assert.equal(game.moves, jugadas - 1, 'Ctrl+Z sigue deshaciendo');
  const sinDeshacerNada = JSON.stringify(game.state);
  assert.notEqual(sinDeshacerNada, conElDosArriba);

  // Los tres atajos de rehacer de antes. Ninguno puede devolver la jugada.
  for (const tecla of [
    { key: 'y', ctrlKey: true },
    { key: 'Y', ctrlKey: true },
    { key: 'Z', ctrlKey: true, shiftKey: true },
  ]) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { ...tecla, bubbles: true }));
    assert.notEqual(JSON.stringify(game.state), conElDosArriba,
      `${tecla.shiftKey ? 'Ctrl+Shift+' : 'Ctrl+'}${tecla.key} ha vuelto a subir el 2S`);
    assert.equal(game.state.tableau[0].length, 1, 'el 2S sigue abajo');
  }

  // Y la API tampoco lo ofrece: si volviera, la barra volvería a enseñarlo.
  assert.equal(typeof game.redo, 'undefined');
  assert.equal(game.canRedo, undefined);

  // La U es el otro atajo de deshacer, y ese sí tiene que funcionar.
  assert.equal(game.play(subir), true);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'u', bubbles: true }));
  assert.equal(game.state.tableau[0].length, 1, 'la U deshace');
});


// ---------- cabecera ----------

test('el chip enseña la modalidad con la que se repartió, no la preferencia de ahora', () => {
  for (const d of window.document.querySelectorAll('dialog')) d.close();
  game.setPrefs({ scoring: 'standard', drawCount: 1, timed: true });
  game.newGame(1);
  board.cancel();
  assert.equal($('#mode-chip').textContent, 'Estándar · 1 carta · crono');

  // Cambiar el crono no reparte de nuevo: la partida en curso sigue siendo la de antes.
  game.setPrefs({ timed: false });
  assert.equal(game.mode.timed, true, 'la modalidad se congela al repartir');
  assert.equal($('#mode-chip').textContent, 'Estándar · 1 carta · crono', 'y el chip cuenta esa, no la preferencia');

  game.newGame(2);
  board.cancel();
  assert.equal($('#mode-chip').textContent, 'Estándar · 1 carta · sin crono', 'el reparto siguiente ya va sin crono');
  game.setPrefs({ timed: true });
  game.newGame(1);
  board.cancel();
});

test('pulsar el chip de modalidad lleva a los Ajustes, que es donde se cambia', () => {
  for (const d of window.document.querySelectorAll('dialog')) d.close();
  assert.equal($('#mode-chip').title, 'Modalidad de juego: toca para cambiarla en Ajustes');
  $('#mode-chip').click();
  assert.equal($('#dlg-settings').open, true);
  assert.equal(panels.section, 'ajustes');
  $('#dlg-settings').close();
});

test('subir una carta mueve el contador de fundaciones y estira la barra de progreso', () => {
  escenario({ tableau: [[carta(1, 'S')]], stock: [carta(5, 'H', false)] });
  assert.equal(game.foundationCount, 0);
  assert.equal($('#foundations').textContent, '0/52');
  assert.equal(parseFloat($('#progress i').style.width) || 0, 0);

  assert.equal(game.play({ type: 'move', from: { pile: 'tableau', index: 0 }, to: { pile: 'foundation', index: 0 }, count: 1 }), true);
  assert.equal(game.foundationCount, 1);
  assert.equal($('#foundations').textContent, '1/52');
  assert.equal(parseFloat($('#progress i').style.width), 1.9, 'una de 52 es el 1,9 % del camino');
  assert.equal($('#progress').getAttribute('aria-hidden'), 'true', 'es un vistazo, no un dato que leer');
});

test('un crono parado con la partida en marcha se avisa, y al reanudar se calla', () => {
  escenario({ tableau: [[carta(1, 'S')]], stock: [carta(5, 'H', false)] });
  assert.equal(game.mode.timed, true);
  assert.equal($('#clock-paused').hidden, true, 'antes de la primera jugada no hay reloj que pausar');

  assert.equal(game.draw(), true);          // el reloj arranca con la primera jugada
  assert.equal(game.clockRunning, true);
  assert.equal($('#clock-paused').hidden, true);

  game.pause();
  assert.equal(game.clockRunning, false);
  assert.equal($('#clock-paused').hidden, false, 'un crono parado sin decirlo parece un crono roto');
  assert.match($('#clock-paused').textContent, /En pausa/);
  assert.equal($('#clock-paused').closest('#stat-clock') != null, true,
    'el aviso vive en la caja del reloj, no en otra esquina de la pantalla');

  game.resumeClock();
  assert.equal(game.clockRunning, true);
  assert.equal($('#clock-paused').hidden, true);
});

test('pulsar el reparto copia su enlace y lo dice; sin portapapeles, enseña la URL', async () => {
  for (const d of window.document.querySelectorAll('dialog')) d.close();
  game.newGame(4321);
  board.cancel();

  const copiadas = [];
  navegador.clipboard = { writeText: async (texto) => { copiadas.push(texto); } };
  $('#seed').click();
  await espera(0);       // el copiado es asíncrono: el aviso llega después

  assert.deepEqual(copiadas, ['http://localhost:5173/?seed=4321'],
    'el enlace lleva el reparto puesto: compartir una mano no es dictar un número');
  assert.match($('#banner').textContent, /Enlace del reparto #4321 copiado/);
  assert.equal($('#seed').classList.contains('copiado'), true, 'y el chip lo acusa un momento');
  assert.equal($('#seed').tagName, 'BUTTON', 'por eso es un botón y no un texto suelto');

  // Sin portapapeles (permiso denegado, http, navegador viejo) se enseña la URL.
  delete navegador.clipboard;
  $('#seed').click();
  await espera(0);
  assert.match($('#banner').textContent, /Copia este enlace/);
  assert.match($('#banner').textContent, /http:\/\/localhost:5173\/\?seed=4321/);
  assert.deepEqual(copiadas, ['http://localhost:5173/?seed=4321'], 'y no se copia nada a escondidas');
});


// ---------- pista con ciclo ----------

const idDe = (el) => el.dataset.id ?? `${el.dataset.pile ?? el.className}${el.dataset.index ?? ''}`;
const marcadas = (clase) => $$(`.${clase}`).map(idDe).sort().join('+');
/** Firma de lo que está señalado ahora mismo: qué se toca y a dónde va. */
const pistaMarcada = () => `${marcadas('hint')} → ${marcadas('hint-destino')}`;

/** Un tablero con varias jugadas razonables: si no, no hay alternativas que recorrer. */
function tableroConAlternativas() {
  escenario({
    tableau: [
      [carta(8, 'S')],
      [carta(4, 'H', false), carta(7, 'H')],
      [carta(3, 'D')],
      [carta(4, 'S', false), carta(6, 'C')],
      [carta(13, 'H')],
      [],
      [carta(9, 'D')],
    ],
    stock: [carta(2, 'C', false)],
  });
}

test('jugar o repartir se lleva las marcas de la pista, que ya no señalan nada', () => {
  escenario({
    tableau: [
      [{ id: '8S', rank: 8, suit: 'S', faceUp: true }],
      [{ id: '4H', rank: 4, suit: 'H', faceUp: false }, { id: '7H', rank: 7, suit: 'H', faceUp: true }],
    ],
    stock: [{ id: '2C', rank: 2, suit: 'C', faceUp: false }],
  });
  $('#btn-hint').click();
  assert.ok($$('.hint, .hint-destino').length > 0, 'la pista marca algo');

  // Una jugada cualquiera deja esas marcas sobre cartas que ya se movieron.
  game.stockClick();
  assert.equal($$('.hint, .hint-destino').length, 0, 'jugar se lleva la pista');

  $('#btn-hint').click();
  assert.ok($$('.hint, .hint-destino').length > 0);
  game.newGame(9);
  board.cancel();
  assert.equal($$('.hint, .hint-destino').length, 0,
    'y repartir no deja cartas del reparto anterior latiendo sobre el nuevo');
});

// El aviso de «te enseño otra» lleva ahora la descripción detrás, así que se
// reconoce por su principio, no por la cadena entera.
const marcaAlternativa = () => t('pista.mas', { detalle: '\u00a7' }).split('\u00a7')[0];

test('pedir pista dos veces sin jugar propone otra jugada, y al agotarlas vuelve a la primera', () => {
  tableroConAlternativas();
  const rec = game.hint();
  assert.ok(rec, 'hay jugada que recomendar');
  assert.ok(rec.alternatives.length >= 2, `el montaje necesita alternativas; hay ${rec.alternatives.length}`);

  const total = 1 + rec.alternatives.length;
  const marcas = [];
  const avisos = [];
  for (let i = 0; i <= total; i++) {         // una vuelta entera más el regreso a la primera
    $('#btn-hint').click();
    marcas.push(pistaMarcada());
    avisos.push($('#banner').textContent);
  }

  assert.ok(!avisos[0].startsWith(marcaAlternativa()), 'la primera describe la jugada entera');
  assert.notEqual(marcas[1], marcas[0], 'la segunda pulsación señala otra cosa');
  assert.ok(avisos[1].startsWith(marcaAlternativa()), 'y avisa de que la buena era la anterior');
  assert.ok(avisos[1].length > marcaAlternativa().length + 10,
    'y además dice cuál es: la alternativa también se describe');
  assert.equal(marcas[total], marcas[0], 'agotadas las alternativas, se vuelve a la mejor');
  assert.equal(avisos[total], avisos[0], 'y se vuelve a describir entera, no como «te enseño otra»');

  // Una sola pista a la vez: nunca quedan dos cartas latiendo.
  assert.equal($$('.hint').length, 1, 'solo late la carta que hay que tocar');
});

test('cualquier jugada reinicia el ciclo: la pista siguiente vuelve a ser la mejor', () => {
  tableroConAlternativas();
  $('#btn-hint').click();
  const primera = pistaMarcada();
  $('#btn-hint').click();
  assert.notEqual(pistaMarcada(), primera, 'vamos por la segunda del ciclo');
  assert.ok($('#banner').textContent.startsWith(marcaAlternativa()));

  assert.equal(game.draw(), true, 'se juega: el tablero ya no es el mismo');
  $('#btn-hint').click();
  assert.ok(!$('#banner').textContent.startsWith(marcaAlternativa()),
    'tras jugar, «pista» vuelve a significar la mejor jugada y no «la siguiente»');
  $('#btn-hint').click();
  assert.ok($('#banner').textContent.startsWith(marcaAlternativa()), 'y el ciclo empieza otra vez desde arriba');
});

test('deshacer también reinicia el ciclo de pistas', () => {
  tableroConAlternativas();
  $('#btn-hint').click();
  $('#btn-hint').click();
  assert.ok($('#banner').textContent.startsWith(marcaAlternativa()));

  assert.equal(game.draw(), true);
  assert.equal(game.undo(), true);
  $('#btn-hint').click();
  assert.ok(!$('#banner').textContent.startsWith(marcaAlternativa()));
});

test('sin ninguna jugada que ofrecer, la pista lo dice y no señala nada', () => {
  escenario({
    tableau: [[carta(9, 'S')], [carta(9, 'H')], [carta(9, 'D')], [carta(9, 'C')], [carta(5, 'H')], [carta(5, 'S')], [carta(5, 'D')]],
  });
  assert.equal(game.hint(), null);
  $('#btn-hint').click();
  assert.equal($('#banner').textContent, t('pista.ninguna'));
  assert.equal($('#banner').classList.contains('warn'), true);
  assert.equal(pistaMarcada(), ' → ', 'no queda ninguna marca de la pista anterior');
});


// ---------- diálogos ----------

test('un reparto mal escrito se avisa dentro del panel y también junto al campo', async () => {
  game.newGame(1);
  board.cancel();
  game.draw();                    // con la partida empezada, cambiar de reparto pide confirmación
  panels.openSettings();

  $('#seed-input').value = '0';
  $('#btn-seed-go').click();

  const status = $('#dlg-status');
  assert.equal(status.closest('#dlg-settings') != null, true,
    'con el panel abierto el banner del tablero queda tapado: lo de dentro se cuenta dentro');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.match(status.textContent, /entre 1 y 999999/);
  assert.equal(status.classList.contains('err'), true);

  const error = $('#seed-error');
  assert.equal(error.hidden, false, 'y quien mira lo ve junto al campo');
  assert.match(error.textContent, /entre 1 y 999999/);
  assert.equal($('#seed-input').getAttribute('aria-invalid'), 'true');
  assert.equal($('#dlg-settings').open, true, 'el panel no se cierra con el reparto sin repartir');
  assert.equal(game.seed, 1, 'y no se ha repartido nada');

  // Con un número válido el error se retira antes que nada. Aquí se rechaza la
  // confirmación a propósito: así se ve el campo ya limpio sin que el panel cierre.
  globalThis.confirm = () => false;
  $('#seed-input').value = '4321';
  $('#btn-seed-go').click();
  globalThis.confirm = () => true;

  assert.equal($('#seed-error').hidden, true, 'corregido el número, el error se va');
  assert.equal($('#seed-input').hasAttribute('aria-invalid'), false);
  assert.equal(game.seed, 1, 'y sin confirmar no se reparte');

  // Al cerrar se limpia: lo que se dijo entonces no viene a cuento la próxima vez.
  $('#dlg-settings').close();
  await espera(0);            // el evento `close` del diálogo se encola, no es inmediato
  panels.openSettings();
  assert.equal($('#dlg-status').textContent, '');
  assert.equal($('#seed-error').hidden, true);
  $('#dlg-settings').close();
});

test('el cartel de bloqueo distingue quedarse sin jugadas de quedarse sin salida', async () => {
  const columnas = () => [[carta(6, 'H')], [carta(7, 'S')], [carta(9, 'S')], [carta(9, 'H')], [carta(9, 'D')], [carta(9, 'C')], [carta(3, 'D')]];
  // La única jugada legal deja la posición muerta: el 6H sobre el 7S vacía la columna 0.
  const bajarElSeis = { type: 'move', from: { pile: 'tableau', index: 0 }, to: { pile: 'tableau', index: 1 }, count: 1 };

  // Con cinco picas arriba queda el rescate: el 5S todavía puede bajar sobre el 6H.
  escenario({ foundations: [[1, 2, 3, 4, 5].map((r) => carta(r, 'S')), [], [], []], tableau: columnas() });
  assert.equal(game.play(bajarElSeis), true);
  assert.equal(game.status, 'stuck');
  assert.equal(game.hasAnyMove, true);
  await espera(600);
  assert.equal($('#dlg-stuck').open, true);
  assert.match($('#stuck-note').textContent, /bajar una carta de las pilas de arriba/,
    'no está todo perdido, y eso se cuenta');
  assert.equal($('#dlg-stuck [data-action="undo"]').disabled, false);
  $('#dlg-stuck').close();

  // Sin nada arriba que bajar, la partida está muerta de verdad.
  escenario({ tableau: columnas() });
  assert.equal(game.play(bajarElSeis), true);
  assert.equal(game.status, 'stuck');
  assert.equal(game.hasAnyMove, false);
  await espera(600);
  assert.equal($('#dlg-stuck').open, true);
  assert.match($('#stuck-note').textContent, /no tiene salida/);
  assert.equal(/pilas de arriba/.test($('#stuck-note').textContent), false,
    'prometer un rescate que no existe es peor que no decir nada');
  assert.match($('#banner').textContent, /no tiene salida/, 'y lo mismo, fijo, en el tablero');
  $('#dlg-stuck').close();
});


// ---------- idiomas ----------

const cambiarIdioma = (code) => {
  const select = $('#pref-lang');
  select.value = code;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
};

test('cambiar de idioma traduce el documento entero sin tocar la partida ni cerrar el panel', () => {
  for (const d of window.document.querySelectorAll('dialog')) d.close();
  game.newGame(4321);
  board.cancel();
  game.draw();
  panels.openStats();       // así los récords quedan pintados y también hay que retraducirlos
  panels.openSettings();
  const jugadas = game.moves;
  const semilla = game.seed;
  const descarte = game.state.waste.at(-1).id;

  cambiarIdioma('en');
  assert.equal(window.document.documentElement.lang, 'en', '<html lang> también cambia: los lectores lo leen de ahí');
  assert.equal($('.brand h1').textContent, 'Solitaire', 'texto estático del HTML');
  assert.equal($('#mode-chip').textContent, 'Standard · 1 card · timed', 'texto que pinta el JS');
  assert.equal($('#btn-undo').getAttribute('aria-label'), 'Undo (Ctrl+Z)', 'nombre para el lector de pantalla');
  assert.equal($('#panel-titulo').textContent, 'Settings', 'y el título del panel abierto');
  // Estos dos los escribe el JS de los paneles y no llevan data-i18n: si nadie
  // los repinta, el panel se queda medio en español.
  assert.match($('#scoring-hint').textContent, /^Standard:/, 'la nota de la puntuación');
  assert.equal($('#stats-grid dt').textContent, 'Games', 'y las etiquetas de los récords');
  assert.equal($('#dlg-settings').open, true, 'el panel desde el que se acaba de elegir no se cierra');
  assert.equal(panels.section, 'ajustes', 'ni se cambia de sección');
  assert.equal(game.moves, jugadas, 'la partida sigue exactamente donde estaba');
  assert.equal(game.seed, semilla);
  assert.equal(game.state.waste.at(-1).id, descarte);

  cambiarIdioma('ko');
  assert.equal(window.document.documentElement.lang, 'ko');
  assert.equal($('.brand h1').textContent, '솔리테어');
  assert.equal($('#mode-chip').textContent, '표준 · 1장 · 타이머');
  assert.equal($('#btn-undo').getAttribute('aria-label'), '되돌리기(Ctrl+Z)');
  assert.match($('#scoring-hint').textContent, /^표준:/);
  assert.equal($('#stats-grid dt').textContent, '판수');
  assert.equal($('#dlg-settings').open, true);
  assert.equal(game.moves, jugadas);

  cambiarIdioma('es');
  assert.equal(window.document.documentElement.lang, 'es');
  assert.equal($('.brand h1').textContent, 'Solitario');
  assert.equal($('#mode-chip').textContent, 'Estándar · 1 carta · crono');
  assert.equal($('#btn-undo').getAttribute('aria-label'), 'Deshacer (Ctrl+Z)');
  assert.match($('#scoring-hint').textContent, /^Estándar:/);
  assert.equal($('#stats-grid dt').textContent, 'Partidas');
  assert.equal(game.prefs.lang, 'es');
  $('#dlg-settings').close();
});

test('un idioma que no conocemos vuelve a la detección automática', () => {
  store.setPrefs({ lang: 'kl' });
  assert.equal(store.getPrefs().lang, 'auto',
    'media interfaz en un idioma vacío sería peor que no acertar el idioma');
  assert.equal(i18n.resolverIdioma(store.getPrefs().lang, ['ko-KR', 'en-US']), 'ko', 'y entonces manda el navegador');
  assert.equal(i18n.resolverIdioma('auto', ['de-DE']), 'es', 'y si tampoco lo hablamos, el de referencia');
  store.setPrefs({ lang: 'es' });
  assert.equal(store.getPrefs().lang, 'es');
});


// ---------- baraja, huecos y contador ----------

test('la baraja de cuatro colores se enciende desde los Ajustes y da color propio a ♦ y ♣', () => {
  panels.openSettings();
  const casilla = $('input[data-pref="fourColor"]');
  assert.equal(casilla.checked, false, 'de serie, la baraja de siempre');
  assert.equal(window.document.documentElement.dataset.deck, '2');

  casilla.checked = true;
  casilla.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(game.prefs.fourColor, true);
  assert.equal(window.document.documentElement.dataset.deck, '4');

  const rombos = regla('html[data-deck="4"] .card[data-suit="D"] .face');
  const treboles = regla('html[data-deck="4"] .card[data-suit="C"] .face');
  assert.ok(rombos && treboles, 'hay reglas propias para rombos y tréboles');
  assert.equal(rombos.style.getPropertyValue('color'), 'var(--card-diamond)');
  assert.equal(treboles.style.getPropertyValue('color'), 'var(--card-club)');

  // Y que sean tres colores distintos de verdad: si no, no se resuelve nada.
  const raiz = variables(':root');
  for (const [a, b] of [['--card-diamond', '--card-red'], ['--card-club', '--card-red'], ['--card-diamond', '--card-club']]) {
    assert.notEqual(raiz[a], raiz[b], `${a} y ${b} tendrían que verse distintos`);
  }

  // El eslabón que une las dos cosas: sin `data-suit` en la carta, la regla de
  // arriba no casaría con nada y el ajuste no pintaría absolutamente nada.
  assert.equal(cartaEl('7D').dataset.suit, 'D');
  assert.equal(cartaEl('7C').dataset.suit, 'C');
  assert.ok(cartaEl('7D').matches('.card[data-suit="D"]'), 'la regla del CSS llega a la carta');

  casilla.checked = false;
  casilla.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(window.document.documentElement.dataset.deck, '2', 'y se apaga igual de fácil');
  $('#dlg-settings').close();
});

test('los huecos del tableau enseñan la K: ahí solo baja un rey', () => {
  const marcas = $$('.slot-tableau .slot-mark');
  assert.equal(marcas.length, 7, 'una por columna');
  for (const m of marcas) {
    assert.equal(m.textContent, 'K');
    assert.equal(m.getAttribute('aria-hidden'), 'true', 'es un recordatorio a la vista, no algo que leer');
  }
  // Tenue, pero no invisible: al .16 de la primera versión la K no se distinguía
  // del tapete en el tema claro. El techo es el .3 de los glifos de las
  // fundaciones, que son la misma clase de marca y sí se leen.
  const opacidad = parseFloat(regla('.slot-tableau .slot-mark').style.getPropertyValue('opacity'));
  assert.ok(opacidad >= 0.2 && opacidad <= 0.3, `la K del hueco va a ${opacidad} de opacidad`);

  // Y con la columna vacía nada la tapa: es justo cuando hace falta.
  escenario({ tableau: [[], [], [], [], [], [], [carta(13, 'S')]] });
  assert.equal(game.state.tableau[0].length, 0);
  assert.equal($('.slot-tableau[data-index="0"] .slot-mark').textContent, 'K');
  assert.equal($('.slot-tableau[data-index="0"]').hidden, false);
});

test('el contador del mazo salta al cambiar de número y luego se queda quieto', async () => {
  const contador = $('#stock-count');
  escenario({ tableau: [[carta(13, 'S')]], stock: [carta(2, 'C', false), carta(3, 'C', false), carta(4, 'C', false)] });
  await espera(500);          // se apaga el salto de colocar el tablero
  assert.equal(contador.hidden, false);
  assert.equal(contador.firstElementChild.textContent, '3');
  assert.equal(contador.classList.contains('bump'), false);

  assert.equal(game.draw(), true);
  assert.equal(contador.firstElementChild.textContent, '2');
  assert.equal(contador.classList.contains('bump'), true, 'el salto de la cifra es lo que dice «has robado»');

  await espera(500);
  assert.equal(contador.classList.contains('bump'), false, 'y se quita sola, que si no no vuelve a saltar');

  board.settle();
  assert.equal(contador.classList.contains('bump'), false, 'repintar sin robar no salta');

  // El JS y la hoja de estilos tienen que durar lo mismo, o la clase se quita a media animación.
  assert.match(regla('.stock-count.bump span').style.getPropertyValue('animation'), /\b320ms\b/);
});


// ---------- movimiento ----------

test('apagar las animaciones deja el documento quieto', () => {
  panels.openSettings();
  const casilla = $('input[data-pref="animations"]');
  assert.equal(casilla.checked, true);
  assert.equal(window.document.documentElement.dataset.motion, 'si');
  assert.equal($('#board').classList.contains('anim'), true);

  casilla.checked = false;
  casilla.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(window.document.documentElement.dataset.motion, 'no', 'el CSS se entera por el atributo');
  assert.equal($('#board').classList.contains('anim'), false, 'y sin la clase no hay transición que valga');

  casilla.checked = true;
  casilla.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(window.document.documentElement.dataset.motion, 'si');
  assert.equal($('#board').classList.contains('anim'), true);
  $('#dlg-settings').close();
});

test('la quietud se enciende con una sola variable y nada la esquiva', () => {
  // Las dos condiciones no repiten el bloque entero: se limitan a encender --quieto.
  const encienden = reglas().filter((r) => r.style && [...r.style].includes('--quieto'));
  assert.equal(encienden.length, 2, 'solo dos sitios encienden la quietud');
  for (const r of encienden) {
    assert.equal(r.style.getPropertyValue('--quieto').trim(), 'none');
    assert.equal([...r.style].length, 1, `${r.selectorText} debería encender la variable y nada más`);
  }
  assert.ok(encienden.some((r) => r.parentRule?.conditionText?.includes('prefers-reduced-motion')),
    'lo pide el sistema…');
  assert.ok(encienden.some((r) => r.selectorText === 'html[data-motion="no"]'), '…y lo pide el jugador');

  // El vuelo de las cartas es una transición, no una animación con nombre.
  const vuelo = regla('.anim .card').style.getPropertyValue('transition');
  assert.match(vuelo, /^var\(--quieto,/, `el vuelo se mueve pase lo que pase: ${vuelo}`);
  assert.match(vuelo, /var\(--card-speed\) var\(--vuelo\)/, 'y por dentro sigue siendo el vuelo de siempre');
  assert.match(regla('.anim .card .face, .anim .card .back').style.getPropertyValue('transition'), /^var\(--quieto,/);
  assert.match(regla('.anim .card.volando, .anim .card.dragging').style.getPropertyValue('translate'), /^var\(--quieto,/);

  // Las demás familias van por nombre de @keyframes. Cada declaración que use una
  // tiene que llevar su valor de siempre como respaldo de var(--quieto, …).
  const declaraciones = (nombre) => reglas().filter((r) => new RegExp(`\\b${nombre}\\b`)
    .test(r.style?.getPropertyValue('animation') ?? ''));
  for (const [familia, nombres] of Object.entries({
    pista: ['pista', 'pista-cara', 'pista-destino'],
    nope: ['nope'],
    bump: ['bump'],
    latido: ['latido'],
    confeti: ['fall'],
  })) {
    assert.match(css, new RegExp(`@keyframes\\s+${nombres[0]}\\b`), `falta la animación de ${familia}`);
    for (const nombre of nombres) {
      const usos = declaraciones(nombre);
      assert.ok(usos.length, `nadie usa la animación ${nombre}`);
      for (const r of usos) {
        const valor = r.style.getPropertyValue('animation').trim();
        assert.match(valor, /^var\(--quieto,/, `«${r.selectorText}» se mueve aunque se pida quietud: ${valor}`);
        assert.equal(/^var\(--quieto,\s*none\s*\)$/.test(valor), false,
          `«${r.selectorText}» tiene el respaldo vacío: entonces no se mueve nunca`);
      }
    }
  }
  // El confeti no se anima: directamente no se dibuja.
  assert.equal(regla('.confetti').style.getPropertyValue('display'), 'var(--quieto, block)');

  // Y ninguna declaración con nombre de animación puede quedarse fuera del var().
  for (const r of reglas()) {
    const valor = r.style?.getPropertyValue('animation')?.trim();
    if (!valor || valor === 'none') continue;      // apagarla del todo también es quedarse quieto
    assert.match(valor, /^var\(--quieto,/, `«${r.selectorText}» no respeta la quietud: ${valor}`);
  }
});

test('la capa de composición se reserva al vuelo, no para las 52 cartas en reposo', () => {
  assert.equal(regla('.card').style.getPropertyValue('will-change'), '',
    'un will-change permanente son 52 capas que el navegador mantiene sin usar');
  assert.match(regla('.card.volando, .card.dragging').style.getPropertyValue('will-change'), /transform/);
});


// ---------- el tablero en pantallas pequeñas ----------

const anchoTablero = () => 7 * cssVar('--cw') + 6 * cssVar('--gap');
const conPantalla = (ancho, alto, fn) => {
  const proto = window.HTMLElement.prototype;
  const antesW = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
  const antesH = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
  Object.defineProperty(proto, 'clientWidth', { get() { return ancho; }, configurable: true });
  Object.defineProperty(proto, 'clientHeight', { get() { return alto; }, configurable: true });
  try {
    board.settle();
    fn();
  } finally {
    Object.defineProperty(proto, 'clientWidth', antesW);
    Object.defineProperty(proto, 'clientHeight', antesH);
    board.settle();
  }
};

test('a 320 y a 280 px el tablero cabe entero y llena la pantalla', () => {
  game.newGame(1);
  board.cancel();
  for (const [ancho, alto] of [[320, 568], [280, 653]]) {
    conPantalla(ancho, alto, () => {
      assert.ok(anchoTablero() + 2 * MARGEN_ANIM <= ancho + 0.5,
        `con ${ancho} px el tablero mide ${anchoTablero().toFixed(1)} y no deja hueco a las animaciones`);
      assert.ok(anchoTablero() + 2 * MARGEN_ANIM >= ancho - 1,
        `con ${ancho} px sobran ${(ancho - anchoTablero() - 2 * MARGEN_ANIM).toFixed(1)} px sin usar: la carta puede ser más grande`);
    });
  }
});

test('en cuanto la pantalla da de sí, la carta mantiene los 44 px del objetivo táctil', () => {
  // Siete columnas de 44 px piden 7·44 + 6·5 de hueco + 2·8 de margen = 354 px
  // de pantalla. Por debajo de eso el objetivo táctil no cabe y la carta se
  // queda con lo que hay (a 320 px son 39, a 280 px son 33): no es un descuido,
  // es que no hay sitio. De 375 px en adelante sí tiene que cumplirse.
  assert.ok(7 * 44 + 6 * 5 + 2 * MARGEN_ANIM > 320, 'a 320 px no caben siete cartas de 44');
  game.newGame(1);
  board.cancel();
  for (const [ancho, alto] of [[375, 667], [390, 844], [430, 932], [768, 1024], [1100, 760]]) {
    conPantalla(ancho, alto, () => {
      assert.ok(cssVar('--cw') >= 44,
        `con ${ancho} px la carta se queda en ${cssVar('--cw').toFixed(1)} px y el dedo deja de acertar`);
      assert.ok(anchoTablero() + 2 * MARGEN_ANIM <= ancho + 0.5, `y con ${ancho} px sigue cabiendo`);
    });
  }
});

test('con la columna más larga posible el tablero sigue cabiendo y no saca barra', () => {
  // Lo más largo que llega a ser una columna en Klondike: seis tapadas y el rey
  // con toda su escalera encima.
  const larga = [
    ...['2C', '3C', '4C', '5C', '6C', '7C'].map((id) => ({ id, rank: Number(id.slice(0, -1)), suit: 'C', faceUp: false })),
    ...[[13, 'S'], [12, 'H'], [11, 'S'], [10, 'H'], [9, 'S'], [8, 'H'], [7, 'S'], [6, 'H'], [5, 'S'], [4, 'H'], [3, 'S'], [2, 'H'], [1, 'S']]
      .map(([r, s]) => carta(r, s)),
  ];
  assert.equal(larga.length, 19);
  escenario({ tableau: [larga] });

  // El tapete recorta a lo ancho y desplaza a lo alto: si el tablero pide más
  // alto del que hay, sale la barra. Que no salga nunca es el contrato.
  assert.equal(regla('.table').style.getPropertyValue('overflow-y'), 'auto');
  for (const [ancho, alto] of [[1100, 760], [1100, 420], [1100, 320], [430, 932], [375, 667], [375, 420], [320, 568], [280, 653]]) {
    conPantalla(ancho, alto, () => {
      // El mismo presupuesto que calcula `altoDisponible` en ui.js: el alto del
      // contenedor menos su relleno. Los hermanos (el cartel de avisos, el botón
      // de rematar) solo se pueden medir en un navegador de verdad —jsdom los da
      // con alto cero—, así que este es el techo que se puede exigir aquí; que no
      // haya barra de verdad se comprueba en un navegador.
      const cs = window.getComputedStyle($('.table'));
      const relleno = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const disponible = Math.max(120, alto - relleno);
      const pide = parseFloat($('#board').style.minHeight);
      assert.ok(pide <= disponible + 0.5,
        `con ${ancho}×${alto} el tablero pide ${pide.toFixed(1)} px de alto y solo hay ${disponible}`);
      assert.ok(anchoTablero() + 2 * MARGEN_ANIM <= ancho + 0.5, `y a lo ancho, con ${ancho} px`);
      // Y la columna sigue siendo legible: los escalones se aprietan, no se anulan.
      assert.ok(pide > cssVar('--ch') * 2, 'las diecinueve cartas no pueden acabar una encima de otra');
    });
  }
});


// ---------- récords: la evolución ----------

test('la evolución se calla con dos partidas y se dibuja con cinco', () => {
  for (const d of window.document.querySelectorAll('dialog')) d.close();
  game.setPrefs({ scoring: 'standard', drawCount: 1 });
  const partidas = (n) => Array.from({ length: n }, (_, i) => ({
    scoring: 'standard', drawCount: 1, score: 100 + i * 10, won: i % 2 === 0,
    timeMs: 60000 + i, moves: 80 + i, seed: 100 + i, at: `2026-0${i + 1}-01T10:00:00.000Z`,
  }));

  window.localStorage.setItem('solitario.v1.scores', JSON.stringify(partidas(2)));
  panels.openStats();
  assert.equal($('#spark-wrap').hidden, true, 'una línea entre dos puntos no dice nada');
  assert.equal($('#stats-spark').children.length, 0);
  assert.equal($('#spark-note').textContent, '');
  assert.equal($('#stats-spark').hasAttribute('aria-label'), false, 'ni hay nada que anunciar');

  window.localStorage.setItem('solitario.v1.scores', JSON.stringify(partidas(5)));
  panels.openStats();
  assert.equal($('#spark-wrap').hidden, false);

  const linea = $('#stats-spark polyline');
  assert.ok(linea, 'la evolución es una línea');
  const puntos = linea.getAttribute('points').trim().split(/\s+/);
  assert.equal(puntos.length, 5, 'un punto por partida');
  // Las partidas van en orden de cuándo se jugaron, no de puntuación: si no,
  // «evolución» sería un ranking disfrazado de línea de tiempo.
  const ys = puntos.map((p) => parseFloat(p.split(',')[1]));
  assert.deepEqual(ys, [...ys].sort((a, b) => b - a), 'las cinco fueron a mejor, y así se ve');

  const circulo = $('#stats-spark .punto');
  assert.ok(circulo, 'la última se marca aparte');
  // No es un <circle>: con preserveAspectRatio="none" saldría ovalado. Es un
  // trazo de longitud cero con la punta redonda, así que su sitio va en la `d`.
  const [, px, py] = /^M([\d.-]+) ([\d.-]+)l0 0$/.exec(circulo.getAttribute('d'));
  assert.deepEqual([px, py], puntos.at(-1).split(','), 'el punto va justo donde acaba la línea');

  assert.match($('#spark-note').textContent, /últimas 5 partidas/);
  assert.match($('#stats-spark').getAttribute('aria-label'), /5 partidas/,
    'dentro del SVG no va texto: lo que hay que leer lo dice el aria-label');
  $('#dlg-settings').close();
});
