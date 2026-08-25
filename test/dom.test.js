// Prueba de integración con jsdom: comprueba que la página se monta,
// que el tablero refleja el estado y que los gestos mueven cartas de verdad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { COLUMNA } from '../src/ui.js';

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
  window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
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

await import('../src/main.js');
const { game, board, panels } = globalThis.solitario;
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

test('tocar el mazo roba una carta y actualiza la cabecera', () => {
  const antes = game.state.stock.length;
  const p = centro(COLUMNA.stock, 0);
  puntero('pointerdown', $('.slot-stock'), p.x, p.y);
  assert.equal(game.state.stock.length, antes - 1);
  assert.equal(game.state.waste.length, 1);
  assert.equal($('#moves').textContent, '1');
  const carta = cartaEl(game.state.waste[0].id);
  assert.equal(carta.classList.contains('down'), false, 'la carta robada se ve');
  assert.equal(carta.classList.contains('playable'), true);
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
});

test('los botones de la barra responden', () => {
  const jugadas = game.moves;
  $('#btn-undo').click();
  assert.ok(game.moves < jugadas, 'deshacer retrocede');
  $('#btn-redo').click();
  assert.equal(game.moves, jugadas, 'rehacer vuelve');
  $('#btn-hint').click();
  assert.equal($('#btn-undo').disabled, false);
});

test('el diálogo de récords se rellena', () => {
  $('#btn-stats').click();
  assert.equal($('#dlg-stats').open, true);
  assert.equal($('#stats-tabs').children.length, 4);
  const activa = $('#stats-tabs [aria-selected="true"]');
  assert.ok(activa, 'siempre hay una pestaña activa');
  assert.equal($('#stats-panel').getAttribute('aria-labelledby'), activa.id);
  assert.equal(activa.getAttribute('aria-controls'), 'stats-panel');
  assert.equal($('#stats-grid').children.length, 9);
  assert.match($('#stats-grid').textContent, /Partidas/);
  $('#dlg-stats').close();
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

  $('#btn-auto').click();
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

test('tocar un mazo agotado no hace nada raro', () => {
  escenario({ tableau: [[{ id: '9S', rank: 9, suit: 'S', faceUp: true }]], stock: [], waste: [] });
  const antes = JSON.stringify(game.state);
  const p = centro(COLUMNA.stock, 0);
  puntero('pointerdown', $('.slot-stock'), p.x, p.y);
  puntero('pointerup', $('.slot-stock'), p.x, p.y);
  assert.equal(JSON.stringify(game.state), antes);
  assert.equal($('.slot-stock').classList.contains('dead'), true, 'el hueco se ve apagado');
});

test('el zoom con dos dedos no está bloqueado', () => {
  const viewport = window.document.querySelector('meta[name="viewport"]').content;
  assert.equal(/user-scalable\s*=\s*no/.test(viewport), false);
  assert.equal(/maximum-scale/.test(viewport), false);
});

test('al cambiar de pestaña de récords el foco se queda en la pestaña', () => {
  panels.openStats();
  const tabs = [...$('#stats-tabs').children];
  tabs[0].focus();
  tabs[2].click();
  const activa = $('#stats-tabs [aria-selected="true"]');
  assert.equal(window.document.activeElement, activa, 'el foco sigue en el grupo de pestañas');
  $('#dlg-stats').close();
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

test('las cartas vuelan mucho más despacio que el resto de la interfaz', () => {
  const raiz = reglas().find((r) => r.selectorText === ':root').style;
  const ui = parseFloat(raiz.getPropertyValue('--speed'));
  const cartas = parseFloat(raiz.getPropertyValue('--card-speed'));
  assert.equal(cartas, 432, 'el vuelo de las cartas dura 432 ms');
  assert.ok(cartas >= ui * 2, 'y al menos el doble que las transiciones de la interfaz');
  assert.equal(regla('.anim .card').style.getPropertyValue('transition').includes('var(--card-speed)'), true);
  assert.equal(regla('.anim .card').style.getPropertyValue('transition').includes('var(--speed)'), false,
    'los botones y los diálogos siguen a su ritmo');
});

// --- reparto animado ---

const mazoX = () => COLUMNA.stock * (cssVar('--cw') + cssVar('--gap'));
const posicion = (id) => {
  const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(cartaEl(id).style.transform);
  return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
};
const cartasDelTableau = () => game.state.tableau.flat();

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

  await new Promise((r) => setTimeout(r, 600));
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
