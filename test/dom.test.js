// Prueba de integración con jsdom: comprueba que la página se monta,
// que el tablero refleja el estado y que los gestos mueven cartas de verdad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

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
  const p = centro(0);
  puntero('pointerdown', $('.slot-stock'), p.x, p.y);
  assert.equal(game.state.stock.length, antes - 1);
  assert.equal(game.state.waste.length, 1);
  assert.equal($('#moves').textContent, '1');
  const carta = cartaEl(game.state.waste[0].id);
  assert.equal(carta.classList.contains('down'), false, 'la carta robada se ve');
  assert.equal(carta.classList.contains('playable'), true);
});

test('arrastrar una carta hasta su fundación la sube', () => {
  board.clearSelection();
  const col = 4;
  game.state.tableau[col].push({ id: 'AD', rank: 1, suit: 'D', faceUp: true });
  board.paint();

  const el = cartaEl('AD');
  const desde = centro(col, 1);
  const hasta = centro(3 + 2, 0);          // fundación de diamantes

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
  board.clearSelection();
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
  board.clearSelection();
  const col = game.state.tableau.findIndex((p) => p.at(-1)?.faceUp && p.at(-1).rank !== 1);
  const carta = game.state.tableau[col].at(-1);
  const el = cartaEl(carta.id);
  const antes = JSON.stringify(game.state);
  const desde = centro(col, 1);
  const hasta = centro(3, 0);   // fundación de picas, casi seguro que no le toca

  puntero('pointerdown', el, desde.x, desde.y);
  puntero('pointermove', el, hasta.x, hasta.y);
  puntero('pointerup', el, hasta.x, hasta.y);

  if (!(carta.suit === 'S' && carta.rank === 1)) {
    assert.equal(JSON.stringify(game.state), antes, 'una jugada ilegal no cambia nada');
    assert.equal(el.classList.contains('dragging'), false);
  }
});

test('doble toque sube la carta que puede subir', () => {
  board.clearSelection();
  const antes = game.state.foundations.flat().length;
  // Preparamos una carta que sí puede subir: el 2 del palo del as ya colocado.
  const palo = game.state.foundations.findIndex((f) => f.length === 1);
  if (palo >= 0) {
    const suit = ['S', 'H', 'D', 'C'][palo];
    const columna = 2;
    game.state.tableau[columna].push({ id: `2${suit}`, rank: 2, suit, faceUp: true });
    board.paint();
    const el = cartaEl(`2${suit}`);
    const p = centro(columna, 1);
    puntero('pointerdown', el, p.x, p.y);
    puntero('pointerup', el, p.x, p.y);
    puntero('pointerdown', el, p.x, p.y);
    puntero('pointerup', el, p.x, p.y);
    assert.equal(game.state.foundations[palo].length, 2, 'el doble toque la mandó arriba');
    assert.ok(game.state.foundations.flat().length > antes);
  }
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
  board.clearSelection();
  Object.assign(game.state, {
    tableau: Array.from({ length: 7 }, (_, i) => tableau[i] ?? []),
    waste, stock, foundations,
  });
  board.paint();
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

test('robar mientras hay una carta seleccionada no mueve otra distinta', () => {
  escenario({
    tableau: [[{ id: 'KS', rank: 13, suit: 'S', faceUp: true }]],
    waste: [{ id: '5H', rank: 5, suit: 'H', faceUp: true }],
    stock: [{ id: 'QD', rank: 12, suit: 'D', faceUp: false }],
  });

  const p = centro(1, 0);
  puntero('pointerdown', cartaEl('5H'), p.x, p.y);
  puntero('pointerup', cartaEl('5H'), p.x, p.y);
  assert.equal(cartaEl('5H').classList.contains('picked'), true, 'el 5H queda seleccionado');

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  assert.equal(cartaEl('5H').classList.contains('picked'), false, 'al cambiar el tablero se suelta la selección');

  const q = centro(0, 1);
  puntero('pointerdown', cartaEl('KS'), q.x, q.y);
  puntero('pointerup', cartaEl('KS'), q.x, q.y);
  assert.deepEqual(game.state.tableau[0].map((c) => c.id), ['KS'], 'no se ha colado la QD encima del rey');
});

test('si el tablero cambia a mitad de arrastre, no se suelta otra carta', () => {
  escenario({
    tableau: [[{ id: 'KS', rank: 13, suit: 'S', faceUp: true }]],
    waste: [{ id: '5H', rank: 5, suit: 'H', faceUp: true }],
    stock: [{ id: 'QD', rank: 12, suit: 'D', faceUp: false }],
  });

  const desde = centro(1, 0);
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

test('el doble toque sobre una carta enterrada no sube la de arriba', () => {
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
  puntero('pointerdown', cartaEl('9H'), p.x, p.y);
  puntero('pointerup', cartaEl('9H'), p.x, p.y);

  assert.equal(game.state.foundations[0].length, 7, 'el 8S sigue en su sitio');
  assert.deepEqual(game.state.tableau[5].map((c) => c.id), ['4C', '9H', '8S']);
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
  const desde = centro(3, 0);
  const hasta = centro(1, 1);
  puntero('pointerdown', rescate, desde.x, desde.y);
  assert.equal(rescate.classList.contains('dragging'), true);
  puntero('pointermove', rescate, hasta.x, hasta.y);
  puntero('pointerup', rescate, hasta.x, hasta.y);

  assert.deepEqual(game.state.tableau[1].map((c) => c.id), ['7S', '6H', '5S'], 'el 5S baja y desatasca');
  assert.equal(game.status, 'playing');
  assert.equal($('#btn-hint').disabled, false);
});

test('tocar un mazo que no responde suelta lo que hubiera marcado', () => {
  escenario({
    tableau: [[{ id: '9S', rank: 9, suit: 'S', faceUp: true }]],
    stock: [],
    waste: [],
  });
  const c = cartaEl('9S');
  const p = centro(0, 1);
  puntero('pointerdown', c, p.x, p.y);
  puntero('pointerup', c, p.x, p.y);
  assert.equal(c.classList.contains('picked'), true);

  const s = centro(0, 0);
  puntero('pointerdown', $('.slot-stock'), s.x, s.y);
  assert.equal(c.classList.contains('picked'), false, 'no queda ninguna carta marcada');
  assert.equal(window.document.querySelectorAll('.card.picked').length, 0);
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
