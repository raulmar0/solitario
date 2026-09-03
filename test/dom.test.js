// Prueba de integración con jsdom: comprueba que la página se monta,
// que el tablero refleja el estado y que los gestos mueven cartas de verdad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { COLUMNA, VUELO_POR_DEFECTO, MARGEN_ANIM } from '../src/ui.js';
// Los textos se comprueban leyendo su clave, no clavando la cadena: así la
// prueba sigue valiendo aunque se retoque la redacción de un mensaje.
import { t } from '../src/i18n.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
// jsdom no descarga la hoja de estilos: se inyecta para poder comprobar reglas.
const dom = new JSDOM(html.replace('</head>', `<style>${css}</style></head>`), { url: 'http://localhost:5173/', pretendToBeVisual: true });
const { window } = dom;

// La página se hizo para un navegador; le ponemos lo que jsdom no trae.
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
if (!window.HTMLDialogElement.prototype.showModal) {
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  // El evento importa: `panels.js` cuelga de él la limpieza de los avisos del
  // panel, y sin dispararlo esa limpieza sería invisible para las pruebas.
  window.HTMLDialogElement.prototype.close = function close() {
    this.open = false;
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
// La ayuda se abre sola la primera vez que alguien entra, y al ser el mismo
// panel que los ajustes se cruzaba con las pruebas a los 500 ms. Con una
// partida ya apuntada, el juego entiende que no es un recién llegado.
window.localStorage.setItem('solitario.v1.stats', JSON.stringify({ 'standard-1': { played: 1, won: 0 } }));
// Toda la interfaz está traducida y en jsdom el navegador dice hablar inglés, así
// que la aplicación arrancaría en inglés. Aquí se comparan textos en español: el
// idioma se deja escrito antes de importar main.js, que es quien lee las
// preferencias al arrancar; después ya sería tarde.
window.localStorage.setItem('solitario.v1.prefs', JSON.stringify({ lang: 'es' }));

await import('../src/main.js');
const { game, board, panels, refresh, instalador, VERSION } = globalThis.solitario;
game.newGame(1);          // reparto fijo: las pruebas de interacción deben ser repetibles
board.cancel();           // sin la animación de reparto por medio
const $ = (sel) => window.document.querySelector(sel);
const cssVar = (name) => parseFloat(window.document.documentElement.style.getPropertyValue(name));

function puntero(tipo, target, x, y) {
  const ev = new window.MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  target.dispatchEvent(ev);
}

const cartaEl = (id) => $(`.card[data-id="${id}"]`);
const centro = (col, fila = 0) => {
  const cw = cssVar('--cw');
  const ch = cssVar('--ch');
  const gap = cssVar('--gap');
  return { x: col * (cw + gap) + cw / 2, y: fila === 0 ? ch / 2 : ch + Math.max(9, ch * 0.13) + ch / 2 };
};

test('la página arranca sin errores y pinta las 52 cartas', () => {
  assert.equal($('#cards').children.length, 52);
  assert.equal(game.status, 'playing');
  assert.equal($('#score').textContent, '0');
  assert.equal($('#moves').textContent, '0');
  assert.match($('#seed').textContent, /^#\d+/);
});

test('las cartas tapadas se dibujan boca abajo y las de arriba no', () => {
  const columna = game.state.tableau[3];
  assert.equal(cartaEl(columna[0].id).classList.contains('down'), true);
  assert.equal(cartaEl(columna.at(-1).id).classList.contains('down'), false);
  assert.equal(cartaEl(columna.at(-1).id).classList.contains('playable'), true);
  assert.equal(cartaEl(game.state.stock.at(-1).id).classList.contains('down'), true);
});

test('cada carta se coloca en su sitio y las de la misma columna se escalonan', () => {
  const [a, b] = game.state.tableau[6];
  const ta = cartaEl(a.id).style.transform;
  const tb = cartaEl(b.id).style.transform;
  assert.match(ta, /translate3d\(/);
  assert.notEqual(ta, tb, 'dos cartas de la misma columna no pueden pisarse');
});

test('tocar el mazo roba una carta: sale boca abajo y se destapa al llegar al descarte', async () => {
  const antes = game.state.stock.length;
  const p = centro(COLUMNA.stock, 0);
  puntero('pointerdown', $('.slot-stock'), p.x, p.y);
  assert.equal(game.state.stock.length, antes - 1);
  assert.equal(game.state.waste.length, 1);
  assert.equal($('#moves').textContent, '1');
  const carta = cartaEl(game.state.waste[0].id);
  // Como en la mesa: la carta se voltea al posarse, no al despegar. Verla ya de
  // cara mientras cruza el tablero es lo único que no hace una mano de verdad.
  assert.equal(carta.classList.contains('down'), true, 'mientras vuela sigue boca abajo');
  assert.equal(carta.classList.contains('playable'), true);
  await new Promise((r) => setTimeout(r, board.flightMs + 120));
  assert.equal(carta.classList.contains('down'), false, 'y al llegar se destapa');
});

test('deshacer un robo a medio vuelo devuelve la carta al mazo, y boca abajo', async () => {
  // La carta robada se destapa al aterrizar, con un temporizador. Si por el
  // camino se deshace la jugada, ese temporizador llegaba igual y le quitaba la
  // tapa a una carta que ya había vuelto al mazo: se veía su cara desde arriba.
  board.cancel();
  game.newGame(3);
  board.cancel();
  const antes = game.state.stock.length;
  game.draw();
  const id = game.state.waste.at(-1).id;
  assert.equal(cartaEl(id).classList.contains('down'), true, 'sale del mazo tapada');

  assert.equal(game.undo(), true, 'se deshace antes de que aterrice');
  assert.equal(game.state.stock.length, antes, 'la carta ha vuelto al mazo');
  await new Promise((r) => setTimeout(r, board.flightMs + 200));
  assert.equal(cartaEl(id).classList.contains('down'), true,
    'en el mazo se queda boca abajo, por mucho que el reloj del robo llegue tarde');
});

test('arrastrar una carta hasta su fundación la sube', () => {
  board.cancel();
  const col = 4;
  game.state.tableau[col].push({ id: 'AD', rank: 1, suit: 'D', faceUp: true });
  board.paint();

  const el = cartaEl('AD');
  const desde = centro(col, 1);
  const hasta = centro(COLUMNA.foundation(2), 0);   // fundación de diamantes

  puntero('pointerdown', el, desde.x, desde.y);
  assert.equal(el.classList.contains('dragging'), true, 'la carta se levanta');
  assert.ok($$dropOk() > 0, 'se marcan los sitios donde puede caer');
  puntero('pointermove', el, hasta.x, hasta.y);
  puntero('pointerup', el, hasta.x, hasta.y);

  assert.equal(el.classList.contains('dragging'), false);
  assert.equal(game.state.foundations[2].at(-1)?.id, 'AD', 'el as acabó en su fundación');
  assert.equal($$dropOk(), 0, 'se apagan las marcas al soltar');
  assert.equal(game.state.tableau[col].some((c) => c.id === 'AD'), false);
});

test('arrastrar una secuencia entera de una columna a otra', () => {
  board.cancel();
  game.state.tableau[5] = [
    { id: '4C', rank: 4, suit: 'C', faceUp: false },
    { id: '9H', rank: 9, suit: 'H', faceUp: true },
    { id: '8S', rank: 8, suit: 'S', faceUp: true },
  ];
  game.state.tableau[6] = [{ id: '10S', rank: 10, suit: 'S', faceUp: true }];
  board.paint();

  const el = cartaEl('9H');
  const desde = centro(5, 1);
  const hasta = centro(6, 1);
  puntero('pointerdown', el, desde.x, desde.y);
  assert.equal(cartaEl('8S').classList.contains('dragging'), true, 'arrastra también la carta de debajo');
  puntero('pointermove', el, hasta.x, hasta.y);
  puntero('pointerup', el, hasta.x, hasta.y);

  assert.deepEqual(game.state.tableau[6].map((c) => c.id), ['10S', '9H', '8S']);
  assert.equal(game.state.tableau[5].length, 1);
  assert.equal(game.state.tableau[5][0].faceUp, true, 'la carta que queda se destapa');
  assert.equal(cartaEl('4C').classList.contains('down'), false);
});

function $$dropOk() { return window.document.querySelectorAll('.slot.drop-ok').length; }

test('soltar en un sitio ilegal devuelve la carta a su columna', () => {
  board.cancel();
  const col = game.state.tableau.findIndex((p) => p.at(-1)?.faceUp && p.at(-1).rank !== 1);
  const carta = game.state.tableau[col].at(-1);
  const el = cartaEl(carta.id);
  const antes = JSON.stringify(game.state);
  const desde = centro(col, 1);
  const hasta = centro(COLUMNA.foundation(0), 0);   // fundación de picas, casi seguro que no le toca

  puntero('pointerdown', el, desde.x, desde.y);
  puntero('pointermove', el, hasta.x, hasta.y);
  puntero('pointerup', el, hasta.x, hasta.y);

  if (!(carta.suit === 'S' && carta.rank === 1)) {
    assert.equal(JSON.stringify(game.state), antes, 'una jugada ilegal no cambia nada');
    assert.equal(el.classList.contains('dragging'), false);
  }
});

test('picar una carta la sube sola a su fundación', () => {
  board.cancel();
  const palo = game.state.foundations.findIndex((f) => f.length === 1);
  assert.ok(palo >= 0, 'hay un as colocado de la prueba anterior');
  const suit = ['S', 'H', 'D', 'C'][palo];
  const columna = 2;
  game.state.tableau[columna] = [{ id: `2${suit}`, rank: 2, suit, faceUp: true }];
  board.paint();

  const el = cartaEl(`2${suit}`);
  const p = centro(columna, 1);
  puntero('pointerdown', el, p.x, p.y);
  puntero('pointerup', el, p.x, p.y);

  assert.equal(game.state.foundations[palo].length, 2, 'un solo toque y arriba');
  assert.equal(game.state.tableau[columna].length, 0);
  assert.match(el.style.transitionDuration, /^\d+ms, 140ms$/, 'al picar la carta vuela con su transición intacta');
});

test('los botones de la barra responden', () => {
  // Reparto limpio: hace falta una partida sin historial para ver el botón apagado.
  game.newGame(1);
  board.cancel();
  assert.equal($('#btn-undo').disabled, true, 'recién repartida no hay nada que deshacer');

  const p = centro(COLUMNA.stock, 0);
  puntero('pointerdown', $('.slot-stock'), p.x, p.y);   // una jugada cualquiera: robar
  const jugadas = game.moves;
  assert.equal(jugadas, 1, 'robar cuenta como jugada');
  assert.equal($('#btn-undo').disabled, false, 'con una jugada hecha, el botón se enciende');

  $('#btn-undo').click();
  assert.equal(game.moves, jugadas - 1, 'y al pulsarlo se deshace de verdad');
  assert.equal($('#btn-undo').disabled, true, 'sin historial vuelve a apagarse');

  // Rehacer se retiró: no basta con quitar la acción, no puede quedar ni el dibujo.
  assert.equal(window.document.querySelector('#btn-redo'), null, 'ya no hay botón de rehacer');
  assert.equal(window.document.querySelector('symbol#i-rehacer'), null, 'ni su icono en el sprite');

  $('#btn-hint').click();
});

test('el panel de récords se rellena', () => {
  panels.openStats();
  assert.equal($('#dlg-settings').open, true, 'récords y ajustes son el mismo panel');
  assert.equal(panels.section, 'records');
  assert.equal($('#panel-records').hidden, false);
  assert.equal($('#panel-ajustes').hidden, true);
  assert.equal($('#panel-titulo').textContent, t('dlg.titulo.records'));
  assert.equal($('#stats-tabs').children.length, 4);
  const activa = $('#stats-tabs [aria-selected="true"]');
  assert.ok(activa, 'siempre hay una pestaña activa');
  assert.equal($('#stats-panel').getAttribute('aria-labelledby'), activa.id);
  assert.equal(activa.getAttribute('aria-controls'), 'stats-panel');
  assert.equal($('#stats-grid').children.length, 9);
  assert.match($('#stats-grid').textContent, /Partidas/);
  $('#dlg-settings').close();
});

test('las cuatro secciones viven en el mismo panel y se cambia entre ellas', () => {
  assert.equal(window.document.querySelector('#dlg-stats'), null, 'ya no hay diálogo de récords aparte');
  assert.equal(window.document.querySelector('#dlg-help'), null, 'ni de ayuda');

  panels.openSettings();
  assert.equal(panels.section, 'ajustes');
  assert.equal($('#panel-titulo').textContent, t('dlg.titulo.ajustes'));

  $('#tab-ayuda').click();
  assert.equal(panels.section, 'ayuda');
  assert.equal($('#panel-ayuda').hidden, false);
  assert.equal($('#panel-ajustes').hidden, true);
  assert.match($('#panel-ayuda').textContent, /Sube las 52 cartas/);
  assert.equal($('#tab-ayuda').getAttribute('aria-selected'), 'true');
  assert.equal($('#tab-ajustes').tabIndex, -1, 'el tabulador entra una vez y dentro se va con flechas');

  // La tecla llega desde la pestaña que tiene el foco, y sube por burbuja.
  $('#tab-ayuda').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(panels.section, 'reto', 'la última da la vuelta a la primera');

  // Y las teclas de siempre siguen abriendo cada cosa por su sección.
  panels.openHelp();
  assert.equal(panels.section, 'ayuda');
  panels.openStats();
  assert.equal(panels.section, 'records');
  panels.openReto();
  assert.equal(panels.section, 'reto');
  assert.equal($('#dlg-settings').open, true, 'sin cerrar y volver a abrir por el camino');
  $('#dlg-settings').close();
});

test('exportar, importar y borrar están en el panel, dentro de Ajustes', () => {
  panels.openSettings();
  for (const id of ['#btn-export', '#btn-import', '#btn-wipe', '#import-file']) {
    assert.ok($(id), `falta ${id}`);
    assert.equal($(id).closest('#panel-ajustes') != null, true, `${id} debería estar en Ajustes`);
  }
  $('#dlg-settings').close();
});

test('los ajustes reflejan las preferencias y las cambian', () => {
  $('#btn-settings').click();
  assert.equal($('#dlg-settings').open, true);
  const btn3 = $('.seg-btn[data-pref="drawCount"][data-value="3"]');
  assert.equal(btn3.getAttribute('aria-checked'), 'false');
  assert.equal(btn3.getAttribute('role'), 'radio');
  btn3.click();
  assert.equal(game.prefs.drawCount, 3);
  assert.equal(btn3.getAttribute('aria-checked'), 'true');
  assert.equal(btn3.tabIndex, 0, 'el seleccionado es el que recibe el tabulador');
  assert.equal($('.seg-btn[data-pref="drawCount"][data-value="1"]').tabIndex, -1);
  assert.equal(game.state.drawCount, 3, 'cambiar de modalidad reparte otra vez');

  const vegas = $('.seg-btn[data-pref="scoring"][data-value="vegas"]');
  vegas.click();
  assert.equal(game.prefs.scoring, 'vegas');
  assert.equal($('#score').textContent, '−52 $');

  $('.seg-btn[data-pref="scoring"][data-value="standard"]').click();
  $('.seg-btn[data-pref="drawCount"][data-value="1"]').click();
  $('#dlg-settings').close();
});

test('se puede pedir un reparto concreto por su número', () => {
  $('#btn-settings').click();
  $('#seed-input').value = '4321';
  $('#btn-seed-go').click();
  assert.equal(game.seed, 4321);
  assert.equal($('#seed').textContent.startsWith('#4321'), true);
  assert.equal($('#dlg-settings').open, false);
});

test('teclado: espacio roba y Ctrl+Z deshace', () => {
  const antes = game.state.stock.length;
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  assert.equal(game.state.stock.length, antes - 1);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  assert.equal(game.state.stock.length, antes);
});

test('al ganar se abre el diálogo con el resumen', async () => {
  const { store } = globalThis.solitario;
  const engine = await import('../src/engine.js');
  const estado = engine.cloneState(game.state);
  estado.stock = [];
  estado.waste = [];
  estado.tableau = [[], [], [], [], [], [], []];
  estado.foundations = ['S', 'H', 'D', 'C'].map((suit) => Array.from({ length: 13 }, (_, i) => ({
    id: `${i + 1}${suit}`, rank: i + 1, suit, faceUp: true,
  })));
  estado.tableau[0] = [estado.foundations[0].pop()];
  store.saveGame({ version: 1, state: estado, baseScore: 500, moves: 90, elapsedMs: 90000, prefs: game.prefs, history: [] });
  game.resume();

  $('#btn-finish').click();          // el botón de rematar hace lo que hacía «Auto»
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(game.status, 'won');
  await new Promise((r) => setTimeout(r, 600));
  assert.equal($('#dlg-win').open, true);
  assert.match($('#win-time').textContent, /^01:3\d$/);
  assert.equal($('#win-moves').textContent, '91');
  assert.ok(store.getScores({ wonOnly: true }).length >= 1, 'la victoria queda registrada');
  $('#dlg-win').close();
});

test('los datos siguen en localStorage al recargar', () => {
  const guardado = window.localStorage.getItem('solitario.v1.stats');
  assert.ok(guardado, 'las estadísticas se persisten');
  assert.match(guardado, /"won":1/);
});


// --- regresiones de la revisión ---

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
}

const reglas = () => [...window.document.styleSheets].flatMap((h) => [...h.cssRules]);
const regla = (selector) => reglas().find((r) => r.selectorText === selector);

test('la capa de cartas no tapa los huecos vacíos', () => {
  assert.equal(regla('.cards')?.style.getPropertyValue('pointer-events'), 'none');
  assert.equal(regla('.card')?.style.getPropertyValue('pointer-events'), 'auto');
});

test('el atributo hidden gana a cualquier display propio', () => {
  assert.ok(regla('[hidden]'), 'hay una regla para [hidden]');
  assert.equal(regla('[hidden]').style.getPropertyValue('display'), 'none');
  assert.equal(regla('[hidden]').style.getPropertyPriority('display'), 'important');
});

test('en tema claro la tinta de los paneles es oscura', () => {
  const claro = reglas().find((r) => r.selectorText === 'html[data-theme="light"]');
  const tinta = claro.style.getPropertyValue('--panel-ink').trim();
  assert.ok(tinta && tinta !== '#ffffff', `la tinta de panel en claro es ${tinta}`);
  assert.equal(regla('.dlg').style.getPropertyValue('color'), 'var(--panel-ink)');
});

test('si el tablero cambia entre apretar y soltar, el toque no mueve nada', () => {
  escenario({
    tableau: [[{ id: 'KS', rank: 13, suit: 'S', faceUp: true }]],
    waste: [{ id: 'QD', rank: 12, suit: 'D', faceUp: true }],
    stock: [{ id: '5H', rank: 5, suit: 'H', faceUp: false }],
  });

  const el = cartaEl('QD');
  const p = centro(COLUMNA.waste, 0);
  puntero('pointerdown', el, p.x, p.y);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));  // roba: la QD deja de ser la de arriba
  puntero('pointerup', el, p.x, p.y);

  assert.deepEqual(game.state.tableau[0].map((c) => c.id), ['KS'], 'la QD no se coloca a destiempo');
  assert.deepEqual(game.state.waste.map((c) => c.id), ['QD', '5H']);
});

test('si el tablero cambia a mitad de arrastre, no se suelta otra carta', () => {
  escenario({
    tableau: [[{ id: 'KS', rank: 13, suit: 'S', faceUp: true }]],
    waste: [{ id: '5H', rank: 5, suit: 'H', faceUp: true }],
    stock: [{ id: 'QD', rank: 12, suit: 'D', faceUp: false }],
  });

  const desde = centro(COLUMNA.waste, 0);
  const hasta = centro(0, 1);
  puntero('pointerdown', cartaEl('5H'), desde.x, desde.y);
  puntero('pointermove', cartaEl('5H'), hasta.x, hasta.y);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));  // otro dedo roba
  puntero('pointerup', cartaEl('5H'), hasta.x, hasta.y);

  assert.deepEqual(game.state.tableau[0].map((c) => c.id), ['KS'], 'la QD no acaba sobre el rey');
  assert.equal(game.state.waste.at(-1).id, 'QD');
  assert.equal(cartaEl('5H').classList.contains('dragging'), false);
});

test('un segundo dedo cancela el arrastre en vez de duplicar la jugada', () => {
  escenario({
    tableau: [
      [{ id: 'KS', rank: 13, suit: 'S', faceUp: true }],
      [{ id: 'QD', rank: 12, suit: 'D', faceUp: true }],
    ],
  });

  const desde = centro(1, 1);
  puntero('pointerdown', cartaEl('QD'), desde.x, desde.y);
  assert.equal(cartaEl('QD').classList.contains('dragging'), true);
  const otro = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 5, clientY: 5, button: 0 });
  Object.defineProperty(otro, 'pointerId', { value: 2 });
  cartaEl('KS').dispatchEvent(otro);
  assert.equal(cartaEl('QD').classList.contains('dragging'), false, 'ninguna carta se queda colgada');
  assert.equal(window.document.querySelectorAll('.card.dragging').length, 0);
});

test('picar una carta enterrada mueve su secuencia entera, no la de arriba', () => {
  const picas = Array.from({ length: 7 }, (_, i) => ({ id: `${i + 1}S`, rank: i + 1, suit: 'S', faceUp: true }));
  escenario({
    foundations: [picas, [], [], []],
    tableau: [[], [], [], [], [], [
      { id: '4C', rank: 4, suit: 'C', faceUp: false },
      { id: '9H', rank: 9, suit: 'H', faceUp: true },
      { id: '8S', rank: 8, suit: 'S', faceUp: true },
    ]],
  });

  const p = centro(5, 1);
  puntero('pointerdown', cartaEl('9H'), p.x, p.y);
  puntero('pointerup', cartaEl('9H'), p.x, p.y);

  assert.equal(game.state.foundations[0].length, 7, 'el 8S no se cuela a la fundación');
  assert.deepEqual(game.state.tableau[5].map((c) => c.id), ['4C', '9H', '8S'], 'sin sitio, no se mueve nada');
  assert.equal(cartaEl('9H').classList.contains('nope'), true, 'y se avisa en la propia carta');

  // Con un 10 negro donde apoyarse, la secuencia entera se va sola.
  game.state.tableau[0] = [{ id: '10C', rank: 10, suit: 'C', faceUp: true }];
  board.paint();
  puntero('pointerdown', cartaEl('9H'), p.x, p.y);
  puntero('pointerup', cartaEl('9H'), p.x, p.y);
  assert.deepEqual(game.state.tableau[0].map((c) => c.id), ['10C', '9H', '8S']);
  assert.deepEqual(game.state.tableau[5].map((c) => c.id), ['4C']);
  assert.equal(game.state.tableau[5][0].faceUp, true, 'y destapa lo que había debajo');
});

test('picar prefiere una columna con carta antes que gastar un hueco', () => {
  escenario({
    tableau: [
      [],                                                        // hueco libre
      [{ id: '7S', rank: 7, suit: 'S', faceUp: true }],           // donde encaja el 6H
      [{ id: '6H', rank: 6, suit: 'H', faceUp: true }],
    ],
  });
  const p = centro(2, 1);
  puntero('pointerdown', cartaEl('6H'), p.x, p.y);
  puntero('pointerup', cartaEl('6H'), p.x, p.y);
  assert.deepEqual(game.state.tableau[1].map((c) => c.id), ['7S', '6H'], 'se apoya en el 7S');
  assert.equal(game.state.tableau[0].length, 0, 'el hueco se queda libre para un rey');
});

test('picar no mueve una columna entera de un hueco a otro', () => {
  escenario({
    tableau: [[{ id: 'KS', rank: 13, suit: 'S', faceUp: true }], [], [], [], [], [], []],
  });
  const p = centro(0, 1);
  puntero('pointerdown', cartaEl('KS'), p.x, p.y);
  puntero('pointerup', cartaEl('KS'), p.x, p.y);
  assert.deepEqual(game.state.tableau[0].map((c) => c.id), ['KS'], 'el rey se queda donde está');
  assert.equal(game.moves, 0);
});

test('un doble clic no dispara dos jugadas seguidas', () => {
  escenario({
    foundations: [[{ id: 'AS', rank: 1, suit: 'S', faceUp: true }], [], [], []],
    tableau: [[
      { id: '3S', rank: 3, suit: 'S', faceUp: true },
      { id: '2S', rank: 2, suit: 'S', faceUp: true },
    ]],
  });
  const p = centro(0, 1);
  for (let i = 0; i < 2; i++) {
    puntero('pointerdown', cartaEl('2S'), p.x, p.y);
    puntero('pointerup', cartaEl('2S'), p.x, p.y);
  }
  assert.deepEqual(game.state.foundations[0].map((c) => c.id), ['AS', '2S'], 'sube el 2S y ahí se queda');
  assert.deepEqual(game.state.tableau[0].map((c) => c.id), ['3S'], 'el 3S no se va detrás');
  assert.equal(game.moves, 1);
});

test('picar una carta de la fundación no la baja: para eso está el arrastre', () => {
  escenario({
    foundations: [[{ id: 'AS', rank: 1, suit: 'S', faceUp: true }, { id: '2S', rank: 2, suit: 'S', faceUp: true }], [], [], []],
    tableau: [[{ id: '3H', rank: 3, suit: 'H', faceUp: true }]],
  });
  const p = centro(COLUMNA.foundation(0), 0);
  puntero('pointerdown', cartaEl('2S'), p.x, p.y);
  puntero('pointerup', cartaEl('2S'), p.x, p.y);
  assert.equal(game.state.foundations[0].length, 2, 'sigue arriba');
  assert.deepEqual(game.state.tableau[0].map((c) => c.id), ['3H']);
});

test('con la partida atascada las cartas siguen cogiéndose', () => {
  const carta = (rank, suit) => ({ id: `${rank}${suit}`, rank, suit, faceUp: true });
  escenario({
    foundations: [[1, 2, 3, 4, 5].map((r) => carta(r, 'S')), [], [], []],
    tableau: [[carta(6, 'H')], [carta(7, 'S')], [carta(9, 'S')], [carta(9, 'H')], [carta(9, 'D')], [carta(9, 'C')], [carta(3, 'D')]],
  });
  // Una jugada legal deja la posición sin salida: el 6H sobre el 7S vacía la columna 0.
  assert.equal(game.play({ type: 'move', from: { pile: 'tableau', index: 0 }, to: { pile: 'tableau', index: 1 }, count: 1 }), true);
  assert.equal(game.status, 'stuck');

  const rescate = cartaEl('5S');
  assert.equal(rescate.classList.contains('playable'), true, 'la carta de la fundación se puede coger');
  const desde = centro(COLUMNA.foundation(0), 0);
  const hasta = centro(1, 1);
  puntero('pointerdown', rescate, desde.x, desde.y);
  assert.equal(rescate.classList.contains('dragging'), true);
  puntero('pointermove', rescate, hasta.x, hasta.y);
  puntero('pointerup', rescate, hasta.x, hasta.y);

  assert.deepEqual(game.state.tableau[1].map((c) => c.id), ['7S', '6H', '5S'], 'el 5S baja y desatasca');
  assert.equal(game.status, 'playing');
  assert.equal($('#btn-hint').disabled, false);
});

test('sin jugadas se avisa de que aún queda bajar una carta de arriba y se ofrece la salida', async () => {
  const carta = (rank, suit) => ({ id: `${rank}${suit}`, rank, suit, faceUp: true });
  escenario({
    foundations: [[1, 2, 3, 4, 5].map((r) => carta(r, 'S')), [], [], []],
    tableau: [[carta(6, 'H')], [carta(7, 'S')], [carta(9, 'S')], [carta(9, 'H')], [carta(9, 'D')], [carta(9, 'C')], [carta(3, 'D')]],
  });
  assert.equal(game.play({ type: 'move', from: { pile: 'tableau', index: 0 }, to: { pile: 'tableau', index: 1 }, count: 1 }), true);
  assert.equal(game.status, 'stuck');
  // Con el 5S todavía arriba, el aviso no es el de partida perdida: es el del rescate.
  assert.equal($('#banner').textContent, t('msg.bloqueo.rescate'), 'se dice en el tablero');
  assert.equal($('#banner').classList.contains('warn'), true);

  await new Promise((r) => setTimeout(r, 600));
  assert.equal($('#dlg-stuck').open, true, 'y se dice a la cara');
  assert.equal($('#stuck-note').textContent, t('msg.bloqueo.rescate'),
    'aquí aún cabe bajar el 5S, y eso se cuenta en vez de dar la partida por perdida');
  assert.equal($('#dlg-stuck [data-action="undo"]').disabled, false);

  $('#dlg-stuck [data-action="undo"]').click();
  assert.equal($('#dlg-stuck').open, false);
  assert.equal(game.status, 'stuck', 'la posición de antes también estaba muerta: deshacer no la revive');
  assert.equal($('#banner').textContent, t('msg.bloqueo.rescate'), 'así que el aviso sigue puesto');

  // Bajar el 5S a mano —el rescate desde la fundación— sí la devuelve a la vida.
  assert.equal(game.play({ type: 'move', from: { pile: 'foundation', index: 0 }, to: { pile: 'tableau', index: 0 }, count: 1 }), true);
  assert.equal(game.status, 'playing', 'el rescate revive la partida');
  assert.equal($('#banner').textContent, '', 'con salida, el aviso se retira');
});

test('tocar un mazo agotado no hace nada raro', () => {
  escenario({ tableau: [[{ id: '9S', rank: 9, suit: 'S', faceUp: true }]], stock: [], waste: [] });
  const antes = JSON.stringify(game.state);
  const p = centro(COLUMNA.stock, 0);
  puntero('pointerdown', $('.slot-stock'), p.x, p.y);
  puntero('pointerup', $('.slot-stock'), p.x, p.y);
  assert.equal(JSON.stringify(game.state), antes);
  assert.equal($('.slot-stock').classList.contains('dead'), true, 'el hueco se ve apagado');
});

test('no se puede hacer zoom: ni pellizco ni doble toque', () => {
  const viewport = window.document.querySelector('meta[name="viewport"]').content;
  assert.match(viewport, /user-scalable\s*=\s*no/);
  assert.match(viewport, /maximum-scale\s*=\s*1/);
  assert.match(viewport, /viewport-fit=cover/, 'y se sigue dibujando bajo la muesca');
  // pan-x pan-y deja desplazarse, pero quita el pellizco y el doble toque.
  assert.equal(regla('html, body').style.getPropertyValue('touch-action'), 'pan-x pan-y');

  // Safari en iOS se salta el viewport: el pellizco le llega como gesto propio.
  const gesto = new window.Event('gesturestart', { bubbles: true, cancelable: true });
  window.document.dispatchEvent(gesto);
  assert.equal(gesto.defaultPrevented, true, 'el pellizco de Safari se corta');

  const dedos = (n) => {
    const ev = new window.Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'touches', { value: Array.from({ length: n }, () => ({})) });
    window.document.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  assert.equal(dedos(2), true, 'dos dedos moviéndose no separan la pantalla');
  assert.equal(dedos(1), false, 'con un dedo se sigue pudiendo desplazar');
});

test('las zonas seguras se apartan por margen, y las pinta el tapete', () => {
  // jsdom no sabe leer `max()` ni `env()`, así que se mira la hoja tal cual.
  // Las cuatro zonas van por variable: se ven de un vistazo y se pueden simular.
  const raiz = regla(':root').style;
  for (const lado of ['top', 'right', 'bottom', 'left']) {
    assert.match(raiz.getPropertyValue(`--safe-${lado}`), new RegExp(`env\\(safe-area-inset-${lado}`),
      `--safe-${lado} tiene que salir de la zona segura del sistema`);
  }

  // Arriba y abajo el hueco se aparta con MARGEN, no con relleno: así esa franja
  // la pinta el fondo de la página y no el velo de la barra, que la dejaba negra.
  assert.equal(regla('.topbar').style.getPropertyValue('margin-top'), 'var(--safe-top)');
  assert.equal(regla('.tools').style.getPropertyValue('margin-bottom'), 'var(--safe-bottom)');

  // A los lados sí es relleno: ahí la barra tiene que llegar al borde.
  const movil = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)[1];
  const barra = /\.topbar \{([\s\S]*?)\}/.exec(movil)[1];
  assert.match(barra, /padding:[^;]*var\(--safe-left/);
  assert.match(barra, /padding:[^;]*var\(--safe-right/);
  // Y nadie se salta la variable volviendo a `env()` por su cuenta.
  const sueltos = css.split('\n').filter((l) => l.includes('env(safe-area-inset') && !l.includes('--safe-'));
  assert.deepEqual(sueltos, [], 'las zonas seguras se leen solo desde :root');

  assert.equal(regla('html').style.getPropertyValue('background-color'), 'var(--header-bg)',
    'html lleva el fondo de la cabecera para que las zonas seguras del navegador no queden negras');
  assert.equal(regla('body').style.getPropertyValue('background-color'), 'var(--header-bg)',
    'body también para que las franjas de margen sean del mismo verde que la cabecera');
});

test('las barras y las zonas seguras usan el verde reforzado de cada tema', () => {
  assert.equal(variables(':root')['--header-bg'], '#0b673b', 'el tema oscuro usa el verde reforzado');
  assert.equal(variables('html[data-theme="light"]')['--header-bg'], '#177043', 'el tema claro usa el verde reforzado');
  assert.equal(regla('.topbar').style.getPropertyValue('background'), 'var(--header-bg)');
  assert.equal(regla('.tools').style.getPropertyValue('background'), 'var(--header-bg)');
  assert.equal(window.document.querySelector('meta[name="theme-color"]').content, '#0b673b',
    'el color del sistema sigue el verde de la cabecera oscura');
});

test('las herramientas están abajo, donde llega el pulgar, y se pueden tocar', () => {
  const barra = $('#tools');
  assert.ok(barra, 'hay barra de acciones');
  // Después del tablero en el orden del documento: en pantalla queda debajo.
  assert.equal(barra.previousElementSibling.tagName, 'MAIN');
  assert.equal(window.document.querySelector('.topbar .tool'), null, 'y ya no arriba');

  const botones = [...barra.querySelectorAll('.tool')];
  assert.equal(botones.length, 5, 'quedan cinco: nueva, repetir, deshacer, pista y ajustes');
  assert.deepEqual(botones.map((b) => b.id),
    ['btn-new', 'btn-restart', 'btn-undo', 'btn-hint', 'btn-settings']);
  for (const b of botones) {
    assert.ok(b.getAttribute('aria-label'), `${b.id} necesita nombre para el lector de pantalla`);
    const icono = b.querySelector('.ico use')?.getAttribute('href');
    assert.match(icono ?? '', /^#i-/, `${b.id} tiene que llevar icono`);
    assert.ok(window.document.querySelector(`symbol${icono}`), `falta el dibujo de ${icono}`);
    assert.ok(b.querySelector('.rotulo')?.textContent, `${b.id} lleva su rótulo`);
  }

  // Con cinco botones los rótulos caben también en el móvil: nada de esconderlos.
  const movil = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css)[1];
  assert.equal(/\.rotulo\s*\{[^}]*display:\s*none/.test(movil), false,
    'los rótulos se quedan a la vista');

  // Y el hueco de la raya del iPhone lo guarda esta barra, con margen para que lo
  // pinte el tapete en vez del velo (ver la prueba de las zonas seguras).
  assert.equal(regla('.tools').style.getPropertyValue('margin-bottom'), 'var(--safe-bottom)');

  // Objetivo de dedo: Apple pide 44 px de lado como mínimo.
  assert.ok(parseFloat(regla('.tool').style.getPropertyValue('min-height')) >= 44);
});

test('al cambiar de pestaña de récords el foco se queda en la pestaña', () => {
  panels.openStats();
  const tabs = [...$('#stats-tabs').children];
  tabs[0].focus();
  tabs[2].click();
  const activa = $('#stats-tabs [aria-selected="true"]');
  assert.equal(window.document.activeElement, activa, 'el foco sigue en el grupo de pestañas');
  $('#dlg-settings').close();
});

// --- contraste (WCAG 2.1) de los colores planos de los diálogos ---

const lum = ([r, g, b]) => {
  const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const sobre = (color, fondo) => {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return hex(color.trim());
  const [r, g, b, a = 1] = m[1].split(',').map(Number);
  return [r, g, b].map((c, i) => Math.round(c * a + fondo[i] * (1 - a)));
};

function variables(selector) {
  const regla = reglas().find((r) => r.selectorText === selector);
  const salida = {};
  for (const nombre of regla.style) salida[nombre] = regla.style.getPropertyValue(nombre).trim();
  return salida;
}

test('el texto de los diálogos se lee en los dos temas', () => {
  const base = variables(':root');
  const claro = { ...base, ...variables('html[data-theme="light"]') };
  for (const [tema, v] of [['oscuro', base], ['claro', claro]]) {
    const panel = hex(v['--panel']);
    const panel2 = hex(v['--panel-2']);
    const tinta = sobre(v['--panel-ink'] === 'var(--ink)' ? v['--ink'] : v['--panel-ink'], panel);
    const suave = sobre(v['--panel-ink-soft'] === 'var(--ink-soft)' ? v['--ink-soft'] : v['--panel-ink-soft'], panel);
    assert.ok(contraste(tinta, panel) >= 7, `${tema}: texto principal ${contraste(tinta, panel).toFixed(2)}:1`);
    assert.ok(contraste(suave, panel) >= 4.5, `${tema}: texto secundario ${contraste(suave, panel).toFixed(2)}:1`);
    assert.ok(contraste(tinta, panel2) >= 7, `${tema}: texto sobre panel-2 ${contraste(tinta, panel2).toFixed(2)}:1`);
    const acento = sobre(v['--accent'], panel);
    const tintaAcento = sobre(v['--accent-ink'], acento);
    assert.ok(contraste(tintaAcento, acento) >= 4.5, `${tema}: botón principal ${contraste(tintaAcento, acento).toFixed(2)}:1`);
  }
});

test('el marcador se lee sobre el tapete en los dos temas', () => {
  const base = variables(':root');
  const claro = { ...base, ...variables('html[data-theme="light"]') };
  for (const [tema, v] of [['oscuro', base], ['claro', claro]]) {
    const fieltro = hex(v['--felt-1']);                       // la zona más clara del degradado
    const barra = sobre(v['--topbar-veil'], fieltro);          // .topbar
    const caja = sobre('rgba(255,255,255,.07)', barra);       // .stat
    const etiqueta = sobre(v['--ink-soft'], caja);
    const valor = sobre(v['--ink'], caja);
    assert.ok(contraste(etiqueta, caja) >= 4.5, `${tema}: etiquetas del marcador ${contraste(etiqueta, caja).toFixed(2)}:1`);
    assert.ok(contraste(valor, caja) >= 4.5, `${tema}: cifras del marcador ${contraste(valor, caja).toFixed(2)}:1`);

    const chip = sobre(reglas().find((r) => r.selectorText === '.banner').style.getPropertyValue('background'), fieltro);
    const aviso = sobre(v['--ink-soft'], chip);
    assert.ok(contraste(aviso, chip) >= 4.5, `${tema}: mensajes del tablero ${contraste(aviso, chip).toFixed(2)}:1`);
  }
});


test('las fundaciones van a la izquierda y el mazo a la derecha', () => {
  game.newGame(1);
  board.paint();
  const x = (el) => parseFloat(/translate3d\(([-\d.]+)px/.exec(el.style.transform)[1]);
  const slot = (sel) => x($(sel));

  const fundaciones = [...window.document.querySelectorAll('.slot-foundation')].map(x);
  assert.deepEqual(fundaciones, [...fundaciones].sort((a, b) => a - b), 'las cuatro, en orden, a la izquierda');
  assert.equal(fundaciones[0], 0, 'la primera pega al borde izquierdo');
  assert.ok(slot('.slot-stock') > fundaciones[3], 'el mazo queda a la derecha de las fundaciones');
  assert.ok(slot('.slot-stock') > slot('.slot-waste'), 'y a la derecha de su descarte');

  const cw = cssVar('--cw');
  const gap = cssVar('--gap');
  assert.equal(Math.round(slot('.slot-stock')), Math.round(6 * (cw + gap)), 'el mazo, en la última columna');
  assert.ok(slot('.slot-waste') - fundaciones[3] > cw, 'queda un hueco de respiro entre los dos grupos');
});

test('el mazo enseña cuántas cartas quedan por robar', () => {
  game.newGame(1);
  board.cancel();
  const contador = $('#stock-count');
  assert.equal(game.state.stock.length, 24);
  assert.equal(contador.hidden, false);
  assert.equal(contador.textContent, '24');
  const x = parseFloat(/translate3d\(([-\d.]+)px/.exec(contador.style.transform)[1]);
  assert.equal(Math.round(x), Math.round(6 * (cssVar('--cw') + cssVar('--gap'))), 'va sobre el mazo');
  assert.equal(regla('.stock-count').style.getPropertyValue('pointer-events'), 'none',
    'el toque tiene que atravesarlo y llegar al mazo');

  game.draw();
  assert.equal(contador.textContent, '23', 'baja al robar');

  escenario({ tableau: [[{ id: '9S', rank: 9, suit: 'S', faceUp: true }]], stock: [], waste: [] });
  assert.equal(contador.hidden, true, 'con el mazo vacío se quita: ya está la flecha de reciclar');
});

test('el descarte se abanica hacia la izquierda, sin meterse bajo el mazo', () => {
  game.setPrefs({ drawCount: 3 });
  game.newGame(1);
  game.draw();
  board.paint();
  assert.equal(game.state.waste.length, 3);

  const x = (id) => parseFloat(/translate3d\(([-\d.]+)px/.exec(cartaEl(id).style.transform)[1]);
  const [fondo, medio, arriba] = game.state.waste.map((c) => x(c.id));
  assert.ok(arriba < medio && medio < fondo, 'la carta jugable es la de más a la izquierda');

  const mazo = parseFloat(/translate3d\(([-\d.]+)px/.exec($('.slot-stock').style.transform)[1]);
  const cw = cssVar('--cw');
  assert.ok(fondo + cw <= mazo + 1, 'ninguna carta del descarte pisa el mazo');
  game.setPrefs({ drawCount: 1 });
});

test('el vuelo de las cartas va por su cuenta, no al ritmo de la interfaz', () => {
  const raiz = reglas().find((r) => r.selectorText === ':root').style;
  const ui = parseFloat(raiz.getPropertyValue('--speed'));
  const cartas = parseFloat(raiz.getPropertyValue('--card-speed'));
  assert.equal(cartas, 324, 'el vuelo de las cartas dura 324 ms');
  assert.ok(cartas > ui, 'aun así, más largo que una transición de la interfaz');
  assert.equal(board.flightMs, 324, 'y el JS lee ese mismo valor de la hoja de estilos');
  assert.equal(regla('.anim .card').style.getPropertyValue('transition').includes('var(--card-speed)'), true);
  assert.equal(regla('.anim .card').style.getPropertyValue('transition').includes('var(--speed)'), false,
    'los botones y los diálogos siguen a su ritmo');
});

test('las animaciones no se salen del ancho de la pantalla', () => {
  // El temblor de «esa no puede ser» mueve la carta, y las columnas de los
  // extremos van pegadas al borde: el tablero tiene que reservar ese hueco.
  const temblor = Math.max(...[...css.matchAll(/translate:\s*(-?[\d.]+)px/g)]
    .map((m) => Math.abs(parseFloat(m[1]))));
  assert.ok(temblor > 0, 'la animación de negar mueve la carta');
  assert.ok(MARGEN_ANIM >= temblor,
    `el tablero reserva ${MARGEN_ANIM} px a cada lado y el temblor mueve ${temblor}`);

  // Y el latido de la pista la agranda: con la carta más ancha posible (104 px)
  // eso son 3,6 px por lado, que también tienen que caber.
  const latido = Math.max(...[...css.matchAll(/scale:\s*([\d.]+)/g)].map((m) => parseFloat(m[1])));
  assert.ok(latido > 1);
  assert.ok(MARGEN_ANIM >= (104 * (latido - 1)) / 2,
    `la pista agranda hasta ${latido} y se sale del margen`);

  // Y por si acaso, el tapete recorta a lo ancho en vez de sacar barra.
  assert.equal(regla('.table').style.getPropertyValue('overflow-x'), 'clip');
  assert.equal(regla('.table').style.getPropertyValue('overflow-y'), 'auto');
});

test('el tablero cabe siempre, por estrecha que sea la pantalla', () => {
  const anchoTablero = () => 7 * cssVar('--cw') + 6 * cssVar('--gap');
  const ancho = window.HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(ancho, 'clientWidth');

  for (const disponible of [280, 320, 375, 430, 768, 1100]) {
    Object.defineProperty(ancho, 'clientWidth', { get() { return disponible; }, configurable: true });
    board.settle();
    assert.ok(anchoTablero() + 2 * MARGEN_ANIM <= disponible + 0.5,
      `con ${disponible} px el tablero mide ${anchoTablero().toFixed(1)} y no deja hueco a las animaciones`);
  }
  Object.defineProperty(ancho, 'clientWidth', original);
  board.settle();
});

test('nada de escalar la carta entera: le multiplicaría la posición', () => {
  // `scale` se aplica antes que `transform`, y la posición de cada carta va en
  // el transform. Escalar la carta le escala también el sitio: una de la última
  // columna pegaba un salto de 22 px al despegar. Las caras sí pueden, que solo
  // llevan el giro del volteo.
  const sobreLaCarta = reglas()
    .filter((r) => r.selectorText && r.style?.getPropertyValue('scale'))
    .map((r) => r.selectorText)
    .filter((sel) => !/\.face|\.back/.test(sel));
  assert.deepEqual(sobreLaCarta, [], 'estas reglas escalan la carta entera');

  // Lo mismo para las animaciones: si unos fotogramas tocan `scale`, quien los
  // use tiene que ser una cara, no la carta.
  const conEscala = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)]
    .filter(([, , cuerpo]) => /\bscale:/.test(cuerpo))
    .map(([, nombre]) => nombre);
  assert.ok(conEscala.length, 'alguna animación crece, que si no esto no vigila nada');
  for (const nombre of conEscala) {
    for (const [, selector] of css.matchAll(new RegExp(`([^{}]+)\\{[^{}]*animation:[^;]*\\b${nombre}\\b`, 'g'))) {
      assert.match(selector.trim(), /\.face|\.back|::after/,
        `«${selector.trim()}» crece con ${nombre} y eso le movería el sitio`);
    }
  }
});

test('el vuelo de las cartas acelera y frena; los controles van a velocidad fija', () => {
  const raiz = reglas().find((r) => r.selectorText === ':root').style;
  assert.match(raiz.getPropertyValue('--vuelo'), /cubic-bezier/, 'hay una curva de vuelo definida');
  assert.match(raiz.getPropertyValue('--volteo'), /cubic-bezier/, 'y otra para el volteo');

  const vuelo = regla('.anim .card').style.getPropertyValue('transition');
  assert.ok(vuelo.includes('var(--vuelo)'), 'la carta vuela con la curva');
  assert.ok(vuelo.includes('translate 140ms linear'), 'y el levantamiento sigue a golpe fijo');
  assert.match(regla('.anim .card.volando').style.getPropertyValue('animation'), /var\(--vuelo\)/,
    'el alzado del vuelo usa la misma curva que el trayecto');

  const volteo = regla('.anim .card .face, .anim .card .back').style.getPropertyValue('transition');
  assert.ok(volteo.includes('var(--volteo)'), 'el volteo se frena en el canto, no corre ahí');
  assert.equal(/ease-in-out/.test(volteo), false, 'ease-in-out precipita el 90° y parece un parpadeo');

  for (const sel of ['.tool', '.slot', '.btn']) {
    const valor = regla(sel).style.getPropertyValue('transition');
    assert.match(valor, /\blinear\b/, `${sel} debería ir a velocidad lineal`);
    assert.equal(/ease|cubic-bezier/.test(valor), false, `${sel} no debería acelerar ni frenar`);
  }
  for (const sel of ['.card.hint', '.card.nope', '.stat.bump dd', '.finish', '.update-pill']) {
    assert.match(regla(sel).style.getPropertyValue('animation'), /\blinear\b/, `${sel} debería ir a velocidad lineal`);
  }
});

test('la capa de composición se reserva al vuelo, no para siempre', () => {
  assert.equal(regla('.card').style.getPropertyValue('will-change'), '',
    'las 52 cartas en reposo no mantienen capa propia');
  const alVuelo = regla('.card.volando, .card.dragging');
  assert.ok(alVuelo, 'hay regla para quien vuela o se arrastra');
  assert.match(alVuelo.style.getPropertyValue('will-change'), /transform/, 'y esa sí reserva la capa');
});

test('el vuelo dura según la distancia, no lo mismo para todo', () => {
  escenario({
    tableau: [
      [{ id: '10C', rank: 10, suit: 'C', faceUp: true }],
      [], [], [], [], [],
      [{ id: '9H', rank: 9, suit: 'H', faceUp: true }],
    ],
    stock: [{ id: '2H', rank: 2, suit: 'H', faceUp: false }],
  });
  assert.equal(game.play({ type: 'move', from: { pile: 'tableau', index: 6 }, to: { pile: 'tableau', index: 0 }, count: 1 }), true);
  const larga = cartaEl('9H');
  const largo = larga.style.transitionDuration;
  const alzaLargo = parseFloat(larga.style.getPropertyValue('--alza'));
  const giroLargo = parseFloat(larga.style.getPropertyValue('--giro'));
  // Dos duraciones, no tres: `.anim .card` transiciona `transform` y `translate`
  // —la sombra vive en `.card::after`—, y una duración de más se descartaría por
  // el final, dejando el levantamiento al ritmo del vuelo en vez de en 140 ms.
  assert.match(largo, /^\d+ms, 140ms$/, 'el vuelo largo lleva su duración a medida y el alzado, la suya');

  // Un salto a la columna de al lado dura bastante menos que cruzar el tablero.
  escenario({
    tableau: [
      [],
      [{ id: '4D', rank: 4, suit: 'D', faceUp: false }, { id: '3C', rank: 3, suit: 'C', faceUp: true }],
      [{ id: '4H', rank: 4, suit: 'H', faceUp: true }],
    ],
    stock: [{ id: '2S', rank: 2, suit: 'S', faceUp: false }],
  });
  assert.equal(game.play({ type: 'move', from: { pile: 'tableau', index: 1 }, to: { pile: 'tableau', index: 2 }, count: 1 }), true);
  const corta = cartaEl('3C');
  const corto = corta.style.transitionDuration;
  assert.ok(parseFloat(corto) < parseFloat(largo), `un salto corto (${corto}) tarda menos que cruzar el tablero (${largo})`);
  assert.ok(parseFloat(corto) >= 180, 'pero tampoco baja de 180 ms');
  assert.ok(Math.abs(alzaLargo) > Math.abs(parseFloat(corta.style.getPropertyValue('--alza'))),
    'cruzar el tapete también se alza más que un salto de columna');
  assert.ok(giroLargo < 0, 'hacia la izquierda se ladea a la izquierda');
  assert.ok(parseFloat(corta.style.getPropertyValue('--giro')) > 0, 'y hacia la derecha, a la derecha');
});

test('la pista marca fuerte la carta que hay que tocar y flojo el sitio donde va', () => {
  escenario({
    tableau: [
      [{ id: '8S', rank: 8, suit: 'S', faceUp: true }],
      [{ id: '4H', rank: 4, suit: 'H', faceUp: false }, { id: '7H', rank: 7, suit: 'H', faceUp: true }],
    ],
  });
  const pista = game.hint();
  assert.deepEqual(pista.move.from, { pile: 'tableau', index: 1 }, 'la mejor jugada es destapar poniendo el 7H sobre el 8S');

  board.flashHint(pista.move);
  assert.equal(cartaEl('7H').classList.contains('hint'), true, 'la carta a tocar late');
  assert.equal(cartaEl('7H').classList.contains('hint-destino'), false);
  assert.equal(cartaEl('8S').classList.contains('hint-destino'), true, 'el destino se marca aparte');
  assert.equal(cartaEl('8S').classList.contains('hint'), false, 'y no se confunde con la que se toca');

  // Un hueco vacío como destino también se marca, pero flojo.
  escenario({
    tableau: [[], [{ id: '3D', rank: 3, suit: 'D', faceUp: false }, { id: 'KH', rank: 13, suit: 'H', faceUp: true }]],
  });
  const alHueco = game.hint();
  assert.deepEqual(alHueco.move.to, { pile: 'tableau', index: 0 }, 'el rey se va al hueco y destapa el 3D');
  board.flashHint(alHueco.move);
  assert.equal(cartaEl('KH').classList.contains('hint'), true);
  assert.equal($('.slot-tableau[data-index="0"]').classList.contains('hint-destino'), true);
});

test('con mazo, la pista manda robar y late la carta de arriba del montón', () => {
  escenario({
    tableau: [
      [{ id: '10H', rank: 10, suit: 'H', faceUp: true }],
      [{ id: '9S', rank: 9, suit: 'S', faceUp: true }],
    ],
    // El 8D del mazo cabe sobre el 9S: mientras al mazo le quede algo colocable,
    // la partida está viva y robar es mejor que pasear el 9S de aquí para allá.
    stock: [{ id: '2C', rank: 2, suit: 'C', faceUp: false }, { id: '8D', rank: 8, suit: 'D', faceUp: false }],
  });
  const pista = game.hint();
  assert.deepEqual(pista.move, { type: 'draw' }, 'mover el 9S de aquí para allá no le hace caso: mejor robar');

  board.flashHint(pista.move);
  // El anillo va en la carta que se toca, no en el hueco que hay debajo: el
  // hueco lo tapa el propio montón y la marca se quedaba enterrada.
  const arriba = cartaEl(game.state.stock[game.state.stock.length - 1].id);
  assert.equal(arriba.classList.contains('hint'), true, 'late la carta de encima del mazo');
  assert.equal($('.slot-stock').classList.contains('hint'), false, 'y no el hueco de debajo');

  // Con el mazo vacío ya no hay carta que marcar: entonces sí, late el hueco.
  assert.ok(regla('.slot.hint'), 'hay regla que anima el hueco del mazo');
  escenario({
    tableau: [[{ id: '10H', rank: 10, suit: 'H', faceUp: true }], [{ id: '9S', rank: 9, suit: 'S', faceUp: true }]],
    waste: [
      { id: '4D', rank: 4, suit: 'D', faceUp: true },
      { id: '8D', rank: 8, suit: 'D', faceUp: true },
      { id: '2C', rank: 2, suit: 'C', faceUp: true },
    ],
  });
  const reciclar = game.hint();
  assert.deepEqual(reciclar.move, { type: 'recycle' });
  board.flashHint(reciclar.move);
  assert.equal($('.slot-stock').classList.contains('hint'), true, 'sin cartas, late el hueco');
});

test('pedir otra pista se lleva la anterior: no quedan marcas viejas', () => {
  escenario({
    tableau: [
      [{ id: '8S', rank: 8, suit: 'S', faceUp: true }],
      [{ id: '4H', rank: 4, suit: 'H', faceUp: false }, { id: '7H', rank: 7, suit: 'H', faceUp: true }],
      [{ id: '3D', rank: 3, suit: 'D', faceUp: true }],
      [{ id: '4S', rank: 4, suit: 'S', faceUp: false }, { id: '6C', rank: 6, suit: 'C', faceUp: true }],
    ],
  });
  board.flashHint(game.hint().move);
  assert.equal(cartaEl('7H').classList.contains('hint'), true, 'la primera pista señala el 7H');

  // El 8S desaparece: ahora la mejor pista es el 6C sobre el 7H.
  game.state.tableau[0] = [];
  board.paint();
  board.flashHint(game.hint().move);

  assert.equal(cartaEl('7H').classList.contains('hint'), false, 'la marca de la pista vieja se retira');
  assert.equal(cartaEl('8S').classList.contains('hint-destino'), false, 'también la del destino');
  assert.equal(cartaEl('6C').classList.contains('hint'), true, 'y la nueva señala al 6C');
  assert.equal(cartaEl('7H').classList.contains('hint-destino'), true, 'que ahora es destino');
});

test('picar no sube una carta arriesgada: para eso está el arrastre', () => {
  escenario({
    foundations: [[{ id: '8S', rank: 8, suit: 'S', faceUp: true }], [], [], []],
    tableau: [[{ id: '9S', rank: 9, suit: 'S', faceUp: true }]],
    stock: [],
  });
  const p = centro(0, 1);
  puntero('pointerdown', cartaEl('9S'), p.x, p.y);
  puntero('pointerup', cartaEl('9S'), p.x, p.y);

  assert.equal(game.state.foundations[0].length, 2, 'sube: era lo único que se podía hacer con ella');
  assert.equal(game.state.tableau[0].length, 0);
  assert.equal(cartaEl('9S').classList.contains('nope'), false, 'nada de negarse ni de dar explicaciones');
});

test('volver del tableau al descarte no es robar, aunque el mazo caiga en la misma columna', async () => {
  // `COLUMNA.stock` es 6, o sea que el montón del mazo y la séptima columna
  // comparten X. Mirando solo la X, deshacer una jugada que llevó una carta del
  // descarte a esa columna la devolvía tapada y con el retraso de un robo.
  const c = (id, rank, suit, faceUp = true) => ({ id, rank, suit, faceUp });
  escenario({
    tableau: [[], [], [], [], [], [], [c('8H', 8, 'H')]],
    waste: [c('7S', 7, 'S')],
    stock: [c('KD', 13, 'D', false)],
  });
  assert.equal(game.play({ type: 'move', from: { pile: 'waste' }, to: { pile: 'tableau', index: 6 }, count: 1 }), true);
  await new Promise((r) => setTimeout(r, board.flightMs + 120));

  assert.equal(game.undo(), true, 'el 7S vuelve al descarte');
  assert.equal(cartaEl('7S').classList.contains('down'), false,
    'una carta que vuelve al descarte se ve: no viene del mazo');
  assert.equal(cartaEl('7S').style.transitionDelay, '', 'y no espera turno de robo');
});

test('coger una carta a media jugada la baja del aire: no se queda pegada a la mesa', async () => {
  // Mientras `volando` está puesta, su animación fija el levantamiento y la
  // sombra, y una animación gana a las declaraciones del arrastre. Además, el
  // temporizador del vuelo devolvía el z natural a una carta que el jugador
  // tenía cogida y la hundía por debajo del tablero.
  const c = (id, rank, suit, faceUp = true) => ({ id, rank, suit, faceUp });
  escenario({
    tableau: [[c('10H', 10, 'H')], [], [], [], [], [], []],
    stock: [c('KD', 13, 'D', false), c('9S', 9, 'S', false)],
  });
  assert.equal(game.draw(), true);
  assert.equal(cartaEl('9S').classList.contains('volando'), true, 'sale volando del mazo');

  const el = cartaEl('9S');
  const p = centro(COLUMNA.waste, 0);
  puntero('pointerdown', el, p.x, p.y);
  puntero('pointermove', el, p.x + 40, p.y + 40);
  assert.equal(el.classList.contains('dragging'), true);
  assert.equal(el.classList.contains('volando'), false, 'en la mano ya no vuela');

  const z = Number(el.style.zIndex);
  assert.ok(z >= 2000, `la que se lleva en la mano va por encima de todo, y va en z=${z}`);
  await new Promise((r) => setTimeout(r, board.flightMs + 200));
  assert.equal(Number(el.style.zIndex), z, 'y el reloj del vuelo no se la baja mientras la sujeta');
  board.cancel();
});

test('repartir de nuevo corta el robo que estuviera en el aire', async () => {
  const c = (id, rank, suit, faceUp = true) => ({ id, rank, suit, faceUp });
  // La QH se roba aquí y en el reparto 5 le toca ser la ÚLTIMA de las 28: cuando
  // vence el reloj de este robo sigue apilada sobre el mazo esperando su turno, y
  // ahí es donde se veía el fallo —enseñaba la cara sobre el montón—.
  escenario({
    tableau: [[c('10H', 10, 'H')], [], [], [], [], [], []],
    stock: [c('KD', 13, 'D', false), c('QH', 12, 'H', false)],
  });
  assert.equal(game.draw(), true);
  assert.equal(cartaEl('QH').classList.contains('down'), true, 'aún viene de camino, tapada');

  game.newGame(5);                    // el reparto anterior se va con todo lo suyo
  // El reloj del robo viejo vence en mitad del reparto nuevo, cuando las 28 del
  // tableau todavía están apiladas sobre el mazo esperando su turno. Ninguna
  // carta que esté ahí puede enseñar la cara.
  const enElMontonDelMazo = (el) => {
    const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
    if (!m) return false;
    const x = Number(m[1]);
    const y = Number(m[2]);
    const cw = parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--cw'));
    const gap = parseFloat(window.getComputedStyle(window.document.documentElement).getPropertyValue('--gap'));
    return Math.abs(x - COLUMNA.stock * (cw + gap)) < 1 && y <= 4;
  };
  // Se mira muy de cerca: el destello dura lo que tarde el siguiente fotograma
  // del reparto en devolverle la tapa, un par de centésimas.
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 8));
    const destapada = [...window.document.querySelectorAll('.card')]
      .find((el) => enElMontonDelMazo(el) && !el.classList.contains('down'));
    assert.equal(destapada, undefined,
      `el reloj del robo viejo destapó ${destapada?.dataset.id} sobre el mazo del reparto nuevo`);
  }
  board.cancel();
});

test('en la última tanda corta, la primera carta sale ya, sin esperar turno de nadie', async () => {
  // Robando de tres, el escalón se cuenta sobre las que salen, no sobre el
  // tamaño del robo: si al mazo le quedaban dos, la primera arrancaba con el
  // retraso de la tercera y el mazo se quedaba un rato quieto con el contador ya a cero.
  const c = (id, rank, suit, faceUp = true) => ({ id, rank, suit, faceUp });
  game.setPrefs({ drawCount: 3 });
  escenario({
    tableau: [[c('10H', 10, 'H')], [], [], [], [], [], []],
    waste: [c('3C', 3, 'C'), c('4C', 4, 'C'), c('5C', 5, 'C')],
    stock: [c('KD', 13, 'D', false), c('9S', 9, 'S', false)],
  });
  assert.equal(game.draw(), true);
  assert.equal(game.state.stock.length, 0, 'salen las dos que quedaban');

  // El descarte queda [3C 4C 5C KD 9S]: la ventana de tres son 5C, KD y 9S, pero
  // del mazo solo han salido KD y 9S.
  assert.equal(cartaEl('9S').style.transitionDelay, '', 'la primera que sale no espera a nadie');
  assert.match(cartaEl('KD').style.transitionDelay, /^55ms/, 'y la segunda va un escalón detrás');
  assert.equal(cartaEl('5C').style.transitionDelay, '', 'la que ya estaba en el descarte ni se mueve');
  await new Promise((r) => setTimeout(r, board.flightMs + 250));
  game.setPrefs({ drawCount: 1 });
  board.cancel();
});

test('la carta que se mueve se levanta de la mesa mientras vuela', async () => {
  escenario({
    tableau: [
      [{ id: '10C', rank: 10, suit: 'C', faceUp: true }],
      [], [], [], [], [],
      [{ id: '9H', rank: 9, suit: 'H', faceUp: true }],
    ],
    // Un rey en el mazo: hay hueco donde ponerlo, así que la posición sigue viva.
    // Con una carta que no cupiera en ningún sitio, el motor la daría por cerrada
    // por muchas cartas que tuviera el mazo, y el cartel taparía el tablero.
    stock: [{ id: 'KD', rank: 13, suit: 'D', faceUp: false }],
  });
  assert.equal(game.play({ type: 'move', from: { pile: 'tableau', index: 6 }, to: { pile: 'tableau', index: 0 }, count: 1 }), true);
  assert.equal(game.status, 'playing', 'la partida sigue viva: nada de carteles de por medio');
  assert.equal(cartaEl('9H').classList.contains('volando'), true, 'en el aire va levantada');
  await new Promise((r) => setTimeout(r, board.flightMs + 200));
  assert.equal(cartaEl('9H').classList.contains('volando'), false, 'al posarse vuelve a la mesa');
});

test('las cartas se voltean de verdad, no aparecen y desaparecen', () => {
  assert.equal(regla('.card .back').style.getPropertyValue('transform'), 'rotateY(180deg)');
  assert.equal(regla('.card.down .face').style.getPropertyValue('transform'), 'rotateY(-180deg)');
  assert.equal(regla('.card.down .back').style.getPropertyValue('transform'), 'rotateY(0deg)');
  assert.equal(regla('.card .face, .card .back').style.getPropertyValue('backface-visibility'), 'hidden',
    'cada cara se esconde sola al darse la vuelta');
  assert.equal(regla('.card').style.getPropertyValue('perspective'), '700px', 'y con fondo, que si no se ve plano');
  assert.equal(regla('.card').style.getPropertyValue('transform-style'), 'preserve-3d',
    'el alzado en Z del volteo se aplana si no');
  assert.match(regla('.anim .card.volteando .face, .anim .card.volteando .back').style.getPropertyValue('animation'),
    /voltear-cara/, 'y se levanta hacia la cámara mientras gira');
  const aLaVez = regla('.anim .card.volando.volteando .face, .anim .card.volando.volteando .back')
    .style.getPropertyValue('animation');
  assert.match(aLaVez, /alzar-cara/, 'si aterriza y se destapa a la vez no se pisan');
  assert.match(aLaVez, /voltear-cara/);
  assert.match(css, /translate:\s*0 0 32px/, 'con un translateZ, no con un scale 2D');
  assert.equal(regla('.card.down .face').style.getPropertyValue('visibility'), '',
    'ya no se esconde a lo bruto');
});

// --- reparto animado ---

const mazoX = () => COLUMNA.stock * (cssVar('--cw') + cssVar('--gap'));
const posicion = (id) => {
  const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(cartaEl(id).style.transform);
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
};
const cartasDelTableau = () => game.state.tableau.flat();
const ordenDelReparto = () => {
  const orden = [];
  for (let fila = 0; fila < 7; fila++) {
    for (let col = fila; col < 7; col++) {
      const carta = game.state.tableau[col][fila];
      if (carta) orden.push(carta.id);
    }
  }
  return orden;
};

test('el reparto deja una separación visible entre cartas', async () => {
  board.cancel();
  game.newGame(82);
  const segunda = ordenDelReparto()[1];

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(Math.round(posicion(segunda).x), Math.round(mazoX()),
    'la segunda carta todavía espera su turno en el mazo');
  board.cancel();
});

test('un frame atrasado no repinta después de cancelar el reparto', async () => {
  board.cancel();
  const rafOriginal = window.requestAnimationFrame;
  const cancelarOriginal = window.cancelAnimationFrame;
  const pendientes = [];
  const cancelados = [];
  window.requestAnimationFrame = (callback) => {
    pendientes.push(callback);
    return pendientes.length;
  };
  window.cancelAnimationFrame = (id) => cancelados.push(id);

  try {
    game.newGame(83);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(pendientes.length, 1, 'la primera salida espera al siguiente frame');

    board.cancel();
    assert.deepEqual(cancelados, [1], 'el frame pendiente se cancela');
    const antes = posicion(ordenDelReparto()[1]);
    pendientes[0]();
    assert.deepEqual(posicion(ordenDelReparto()[1]), antes,
      'un callback que llega tarde no mueve la segunda carta');
  } finally {
    board.cancel();
    window.requestAnimationFrame = rafOriginal;
    window.cancelAnimationFrame = cancelarOriginal;
  }
});

test('al repartir, las 28 cartas arrancan apiladas sobre el mazo y boca abajo', () => {
  board.cancel();
  game.newGame(77);
  assert.equal(board.repartiendo, true);

  const cartas = cartasDelTableau();
  assert.equal(cartas.length, 28);
  for (const c of cartas) {
    const p = posicion(c.id);
    assert.equal(Math.round(p.x), Math.round(mazoX()), `${c.id} debería salir del mazo`);
    assert.equal(p.y, 0, `${c.id} debería estar en la fila de arriba`);
    assert.equal(cartaEl(c.id).classList.contains('down'), true, `${c.id} se reparte boca abajo`);
  }
  const arriba = game.state.tableau[6].at(-1);
  assert.equal(arriba.faceUp, true, 'en el estado ya está boca arriba…');
  assert.equal(cartaEl(arriba.id).classList.contains('down'), true, '…pero todavía no se ve');
});

test('un toque durante el reparto se lo salta y coloca todo', () => {
  board.cancel();
  game.newGame(78);
  assert.equal(board.repartiendo, true);

  puntero('pointerdown', $('#board'), 5, 5);
  assert.equal(board.repartiendo, false, 'se corta el reparto');

  for (const [i, pila] of game.state.tableau.entries()) {
    for (const [j, c] of pila.entries()) {
      const p = posicion(c.id);
      assert.equal(Math.round(p.x), Math.round(i * (cssVar('--cw') + cssVar('--gap'))), `${c.id} en su columna`);
      assert.ok(p.y > 0, `${c.id} en la fila del tableau`);
      assert.equal(cartaEl(c.id).classList.contains('down'), j < pila.length - 1, `${c.id} del derecho o del revés`);
    }
  }
});

test('el reparto termina solo y deja el tablero en su sitio', async () => {
  board.cancel();
  game.newGame(79);
  const limite = Date.now() + 6000;
  while (board.repartiendo && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 60));
  }
  assert.equal(board.repartiendo, false, 'el reparto acaba por sí solo');

  for (const [i, pila] of game.state.tableau.entries()) {
    const arriba = pila.at(-1);
    assert.equal(Math.round(posicion(arriba.id).x), Math.round(i * (cssVar('--cw') + cssVar('--gap'))));
    assert.equal(cartaEl(arriba.id).classList.contains('down'), false, 'la última de cada columna acaba destapada');
  }
  assert.equal(game.moves, 0, 'repartir no cuenta como jugada');
});

test('jugar durante el reparto lo cancela en vez de dejar cartas en el aire', async () => {
  board.cancel();
  game.newGame(80);
  assert.equal(board.repartiendo, true);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));   // robar
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(board.repartiendo, false);
  assert.equal(game.state.waste.length, 1);
  const arriba = game.state.tableau[0].at(-1);
  assert.equal(cartaEl(arriba.id).classList.contains('down'), false, 'todo queda como debe');
});

test('sin animaciones no hay reparto animado', () => {
  game.setPrefs({ animations: false });
  game.newGame(81);
  assert.equal(board.repartiendo, false, 'las cartas aparecen ya colocadas');
  assert.equal(Math.round(posicion(game.state.tableau[3][0].id).x), Math.round(3 * (cssVar('--cw') + cssVar('--gap'))));
  game.setPrefs({ animations: true });
  board.cancel();
});


// --- capas durante el movimiento ---

const z = (id) => Number(cartaEl(id).style.zIndex);
// Solo cuentan las cartas que están en juego: las que no aparecen en el tablero
// de la prueba se ocultan y conservan el z-index que tuvieran de antes.
const zMaximo = (excepto = []) => Math.max(...[...window.document.querySelectorAll('.card')]
  .filter((el) => el.style.visibility !== 'hidden' && !excepto.includes(el.dataset.id))
  .map((el) => Number(el.style.zIndex) || 0));

test('la carta que se mueve va por encima de todas mientras vuela', async () => {
  // Cruza el tablero entero: de la última columna a la primera, que es justo
  // donde su z-index de destino es el más bajo de todos.
  escenario({
    tableau: [
      [{ id: '10C', rank: 10, suit: 'C', faceUp: true }],
      [{ id: '5H', rank: 5, suit: 'H', faceUp: true }],
      [{ id: '5D', rank: 5, suit: 'D', faceUp: true }],
      [{ id: '5S', rank: 5, suit: 'S', faceUp: true }],
      [{ id: '5C', rank: 5, suit: 'C', faceUp: true }],
      [{ id: '4D', rank: 4, suit: 'D', faceUp: true }],
      [{ id: '9H', rank: 9, suit: 'H', faceUp: true }],
    ],
  });
  const reposo = z('9H');
  assert.ok(reposo > z('10C'), 'en reposo, la columna 6 va por encima de la 0');

  const p = centro(6, 1);
  puntero('pointerdown', cartaEl('9H'), p.x, p.y);
  puntero('pointerup', cartaEl('9H'), p.x, p.y);
  assert.deepEqual(game.state.tableau[0].map((c) => c.id), ['10C', '9H'], 'se coloca sobre el 10C');

  assert.ok(z('9H') > zMaximo(['9H']), `en vuelo va arriba del todo (${z('9H')})`);
  assert.ok(z('9H') >= 1000);

  await new Promise((r) => setTimeout(r, board.flightMs + 200));
  assert.ok(z('9H') < 1000, 'al aterrizar recupera su capa normal');
  assert.ok(z('9H') > z('10C'), 'y se queda encima de la carta sobre la que cayó');
  assert.ok(z('9H') < z('5D'), 'pero por debajo de las columnas siguientes, como corresponde');
});

test('una secuencia en vuelo mantiene su orden interno', async () => {
  escenario({
    tableau: [
      [{ id: '10C', rank: 10, suit: 'C', faceUp: true }],
      [], [], [], [],
      [{ id: '4D', rank: 4, suit: 'D', faceUp: true }],
      [
        { id: '9H', rank: 9, suit: 'H', faceUp: true },
        { id: '8S', rank: 8, suit: 'S', faceUp: true },
        { id: '7H', rank: 7, suit: 'H', faceUp: true },
      ],
    ],
  });
  const p = centro(6, 1);
  puntero('pointerdown', cartaEl('9H'), p.x, p.y);
  puntero('pointerup', cartaEl('9H'), p.x, p.y);
  assert.deepEqual(game.state.tableau[0].map((c) => c.id), ['10C', '9H', '8S', '7H']);

  assert.ok(z('9H') < z('8S') && z('8S') < z('7H'), 'llegan escalonadas como se apilan');
  assert.ok(z('9H') > zMaximo(['9H', '8S', '7H']), 'y las tres por encima del resto');
});

test('la carta que se arrastra va por encima incluso de las que vuelan', () => {
  escenario({
    tableau: [
      [{ id: '10C', rank: 10, suit: 'C', faceUp: true }],
      [{ id: '2H', rank: 2, suit: 'H', faceUp: true }],
      [], [], [], [],
      [{ id: '9H', rank: 9, suit: 'H', faceUp: true }],
    ],
  });
  const p = centro(6, 1);
  puntero('pointerdown', cartaEl('9H'), p.x, p.y);
  puntero('pointerup', cartaEl('9H'), p.x, p.y);      // el 9H vuela a la columna 0

  const q = centro(1, 1);
  puntero('pointerdown', cartaEl('2H'), q.x, q.y);    // y ahora se coge el 2H
  assert.ok(z('2H') > z('9H'), 'la de la mano manda');
  assert.ok(z('2H') >= 2000);
  puntero('pointerup', cartaEl('2H'), q.x, q.y);
});

test('recolocar por un cambio de tamaño no levanta las cartas', () => {
  escenario({ tableau: [[{ id: '10C', rank: 10, suit: 'C', faceUp: true }], [], [], [], [], [], [{ id: '9H', rank: 9, suit: 'H', faceUp: true }]] });
  const antes = z('9H');
  window.dispatchEvent(new window.Event('resize'));
  assert.equal(z('9H'), antes, 'siguen en su capa de siempre');
  assert.ok(z('9H') < 1000);
});


test('solo se levanta la carta que se mueve, no el tablero entero', () => {
  escenario({
    tableau: [
      [{ id: '10C', rank: 10, suit: 'C', faceUp: true }],
      [{ id: '5H', rank: 5, suit: 'H', faceUp: true }],
      [{ id: '5D', rank: 5, suit: 'D', faceUp: true }],
      [{ id: '5S', rank: 5, suit: 'S', faceUp: true }],
      [{ id: '5C', rank: 5, suit: 'C', faceUp: true }],
      [{ id: '4D', rank: 4, suit: 'D', faceUp: true }],
      [{ id: '9H', rank: 9, suit: 'H', faceUp: true }],
    ],
  });

  // Los navegadores reescriben lo que les pasas: el `0` de translate3d vuelve
  // como `0px`. jsdom no lo hace, así que aquí se imita a mano; sin esto, un
  // paint() que compare cadenas parecería correcto en las pruebas y no lo sería.
  const comoElNavegador = () => {
    for (const el of window.document.querySelectorAll('.card')) {
      el.style.transform = el.style.transform.replace(/,\s*0\)$/, ', 0px)');
    }
  };
  const elevadas = () => [...window.document.querySelectorAll('.card')]
    .filter((el) => el.style.visibility !== 'hidden' && Number(el.style.zIndex) >= 1000)
    .map((el) => el.dataset.id);

  comoElNavegador();
  board.paint();
  assert.deepEqual(elevadas(), [], 'repintar sin mover nada no levanta ninguna carta');

  comoElNavegador();
  assert.equal(game.play({ type: 'move', from: { pile: 'tableau', index: 6 }, to: { pile: 'tableau', index: 0 }, count: 1 }), true);
  assert.deepEqual(elevadas(), ['9H'], 'solo vuela la que se ha movido');
});


// --- botón de rematar la partida ---

const botonFinal = () => $('#btn-finish');

/** Deja la partida a un paso: todo boca arriba, sin mazo y sin decisiones. */
function partidaResuelta(quedan = 3) {
  const palos = ['S', 'H', 'D', 'C'];
  const foundations = palos.map((suit) => Array.from({ length: 13 - (suit === 'S' ? quedan : 0) },
    (_, i) => ({ id: `${i + 1}${suit}`, rank: i + 1, suit, faceUp: true })));
  const sueltas = Array.from({ length: quedan }, (_, i) => ({
    id: `${13 - i}S`, rank: 13 - i, suit: 'S', faceUp: true,
  }));
  escenario({ foundations, tableau: sueltas.map((c) => [c]) });
  refresh();          // tocar el estado a mano no dispara la suscripción de la interfaz
  board.settle();
}

test('el botón de rematar solo aparece cuando ya no queda nada que decidir', () => {
  escenario({ tableau: [[{ id: '9S', rank: 9, suit: 'S', faceUp: false }]] });
  assert.equal(game.canAutoComplete, false, 'con cartas tapadas en el tablero todavía no');
  assert.equal(botonFinal().hidden, true);

  partidaResuelta();
  assert.equal(game.canAutoComplete, true);
  assert.equal(botonFinal().hidden, false, 'ahora sí se ofrece');
  assert.ok(botonFinal().textContent.includes(t('tool.rematar')), 'el rótulo sale de tool.rematar');
});

test('el botón de rematar también se ofrece si queda mazo pero el tablero está destapado', async () => {
  const palos = ['S', 'H', 'D', 'C'];
  const foundations = palos.map((suit) => Array.from({ length: 13 - (suit === 'S' ? 2 : 0) },
    (_, i) => ({ id: `${i + 1}${suit}`, rank: i + 1, suit, faceUp: true })));
  escenario({
    foundations,
    tableau: [[{ id: '12S', rank: 12, suit: 'S', faceUp: true }]],
    stock: [{ id: '13S', rank: 13, suit: 'S', faceUp: false }],
  });
  refresh();
  board.settle();

  assert.equal(game.canAutoComplete, true, 'con todo el tableau destapado se ofrece rematar');
  assert.equal(botonFinal().hidden, false);

  botonFinal().click();
  const limite = Date.now() + 8000;
  while (game.status !== 'won' && Date.now() < limite) await new Promise((r) => setTimeout(r, 60));
  assert.equal(game.status, 'won');
  assert.equal(game.state.foundations.flat().length, 52);
  $('#dlg-win').close();
});

test('el botón remata la partida carta a carta y la da por ganada', async () => {
  partidaResuelta(3);
  const subidas = game.state.foundations.flat().length;
  assert.equal(subidas, 49);

  botonFinal().click();
  assert.equal(botonFinal().dataset.corriendo, 'si', 'mientras corre ofrece detenerse');
  assert.ok(botonFinal().textContent.includes(t('tool.detener')), 'y al correr, de tool.detener');

  const limite = Date.now() + 8000;
  while (game.status !== 'won' && Date.now() < limite) await new Promise((r) => setTimeout(r, 60));

  assert.equal(game.status, 'won');
  assert.equal(game.state.foundations.flat().length, 52);
  assert.equal(botonFinal().hidden, true, 'y desaparece al acabar');
  $('#dlg-win').close();
});

test('el remate se puede detener a media cascada', async () => {
  partidaResuelta(6);
  botonFinal().click();
  await new Promise((r) => setTimeout(r, board.flightMs / 2));
  botonFinal().click();                       // detener
  const congelado = game.state.foundations.flat().length;
  assert.equal(botonFinal().dataset.corriendo, 'no');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(game.state.foundations.flat().length, congelado, 'no sube ninguna más');
  assert.equal(game.status, 'playing');
  assert.equal(botonFinal().hidden, false, 'sigue ofreciéndose por si cambias de idea');
});

test('el ritmo de la cascada sale de la duración del vuelo', () => {
  assert.equal(Math.round(board.flightMs / 4), 81, 'una carta cada cuarto de vuelo');
});

test('la duración de reserva del JS coincide con la hoja de estilos', () => {
  // Si se descuelgan, un navegador que no resuelva la variable bajaría la carta
  // de su capa a mitad de vuelo.
  const enCss = parseFloat(/--card-speed:\s*([\d.]+)ms/.exec(css)[1]);
  assert.equal(VUELO_POR_DEFECTO, enCss);
});

test('deshacer durante el remate lo corta', async () => {
  partidaResuelta(5);
  botonFinal().click();
  await new Promise((r) => setTimeout(r, board.flightMs / 3));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  const tras = game.state.foundations.flat().length;
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(game.state.foundations.flat().length, tras, 'la cascada se paró');
  assert.equal(botonFinal().dataset.corriendo, 'no');
});


// --- aplicación instalable ---

test('los ajustes enseñan la versión que se está ejecutando', () => {
  panels.openSettings();
  assert.equal($('#app-version').textContent, `v${VERSION}`);
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  $('#dlg-settings').close();
});

test('sin service worker, el botón de actualizar se desactiva y se explica', () => {
  // jsdom no trae navigator.serviceWorker, que es justo el caso de un navegador viejo.
  assert.equal(globalThis.solitario.pwa.soportado, false);
  panels.openSettings();
  assert.equal($('#btn-update').disabled, true);
  assert.equal($('#update-hint').textContent, t('app.update.nosoportado'));
  $('#dlg-settings').close();
});

test('la fila de instalar aparece solo cuando el navegador la ofrece', () => {
  panels.openSettings();
  assert.equal($('#install-row').hidden, true, 'sin oferta no se enseña nada');
  assert.equal(instalador.puede, false);

  const evento = new window.Event('beforeinstallprompt', { cancelable: true });
  let pedido = 0;
  evento.prompt = async () => { pedido += 1; };
  evento.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
  window.dispatchEvent(evento);

  assert.equal(evento.defaultPrevented, true, 'se le quita el cartel automático al navegador');
  assert.equal(instalador.puede, true);
  assert.equal($('#install-row').hidden, false);
  assert.equal($('#btn-install').hidden, false);
  assert.equal(pedido, 0, 'todavía no se ha pedido nada');
  $('#dlg-settings').close();
});

test('el aviso de versión nueva empieza escondido', () => {
  assert.equal($('#btn-update-pill').hidden, true);
});
