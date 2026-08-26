// Regresiones: un caso por cada fallo que encontró la revisión.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/engine.js';
import { PILE } from '../src/engine.js';
import { createGame } from '../src/game.js';
import { createStore, memoryBackend } from '../src/storage.js';
import { SUITS, cardId } from '../src/cards.js';

/** Construye un tablero de 52 cartas: unas visibles a propósito y el resto boca abajo. */
function tablero({ foundations = [[], [], [], []], tops, primeraSola }) {
  const mazo = [];
  for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) mazo.push({ id: cardId(rank, suit), rank, suit, faceUp: false });
  const sacar = (rank, suit) => mazo.splice(mazo.findIndex((c) => c.rank === rank && c.suit === suit), 1)[0];

  const fundaciones = foundations.map((pila) => pila.map(([rank, suit]) => ({ ...sacar(rank, suit), faceUp: true })));
  const tableau = [];
  if (primeraSola) tableau.push([{ ...sacar(...primeraSola), faceUp: true }]);
  for (const [rank, suit] of tops) tableau.push([{ ...sacar(rank, suit), faceUp: true }]);
  while (tableau.length < 7) tableau.push([]);

  // Lo que queda va boca abajo debajo de las columnas que ya tienen carta visible.
  const conCarta = tableau.map((p, i) => (p.length ? i : -1)).filter((i) => i > 0);
  mazo.forEach((c, i) => tableau[conCarta[i % conCarta.length]].unshift(c));

  const total = fundaciones.flat().length + tableau.flat().length;
  if (total !== 52) throw new Error(`el tablero de prueba tiene ${total} cartas`);
  return { stock: [], waste: [], foundations: fundaciones, tableau };
}

const crear = (prefs = {}) => {
  const store = createStore(memoryBackend());
  store.setPrefs({ timed: false, ...prefs });
  const reloj = { t: 0 };
  return { store, reloj, game: createGame({ store, now: () => reloj.t }) };
};

const baraja = () => SUITS.map((suit) => Array.from({ length: 13 }, (_, i) => ({
  id: `${i + 1}${suit}`, rank: i + 1, suit, faceUp: true,
})));

test('retomar una partida estándar no prohíbe reciclar (Infinity no sobrevive a JSON)', () => {
  const { game, store } = crear({ scoring: 'standard', drawCount: 1 });
  game.newGame(13);
  while (game.state.stock.length) game.stockClick();
  assert.equal(engine.isLegal(game.state, { type: 'recycle' }), true, 'antes de guardar, reciclar es legal');

  // Se guarda y se lee tal cual lo haría localStorage.
  const crudo = JSON.parse(JSON.stringify(store.loadGame()));
  assert.equal(crudo.state.maxRecycles, null, 'JSON no sabe guardar Infinity');
  store.saveGame(crudo);

  const otro = createGame({ store, now: () => 0 });
  assert.equal(otro.resume(), true);
  assert.equal(otro.state.maxRecycles, Infinity, 'al retomar se recalcula el límite');
  assert.equal(engine.isLegal(otro.state, { type: 'recycle' }), true);
  assert.equal(otro.status, 'playing', 'no se declara atascada por no poder reciclar');
  assert.equal(otro.stockClick(), true, 'el mazo responde: recicla el descarte');
  assert.equal(otro.state.stock.length, 24);
  assert.equal(otro.state.waste.length, 0);
  assert.equal(otro.state.recycles, 1);
});

test('Vegas conserva su límite de pasadas al retomar', () => {
  const { game, store } = crear({ scoring: 'vegas', drawCount: 3 });
  game.newGame(21);
  game.draw();
  store.saveGame(JSON.parse(JSON.stringify(store.loadGame())));
  const otro = createGame({ store, now: () => 0 });
  otro.resume();
  assert.equal(otro.state.maxRecycles, 2);
});

test('el historial recuperado también trae el límite bueno', () => {
  const { game, store } = crear();
  game.newGame(5);
  game.draw();
  game.draw();
  store.saveGame(JSON.parse(JSON.stringify(store.loadGame())));
  const otro = createGame({ store, now: () => 0 });
  otro.resume();
  otro.undo();
  assert.equal(otro.state.maxRecycles, Infinity);
});

test('pasar un rey de un hueco vacío a otro no cuenta como jugada: la partida está muerta', () => {
  // Rey solo en la primera columna, un hueco libre al final y ninguna otra jugada posible.
  const st = {
    ...engine.newGame({ seed: 1 }),
    ...tablero({ primeraSola: [13, 'S'], tops: [[9, 'S'], [9, 'H'], [9, 'D'], [9, 'C'], [3, 'D']] }),
  };
  assert.equal(st.tableau[6].length, 0, 'hay un hueco');

  const movimientos = engine.cardMoves(st);
  assert.equal(movimientos.length, 1);
  assert.deepEqual(movimientos[0].to, { pile: PILE.TABLEAU, index: 6 }, 'lo único legal es pasar el rey de hueco a hueco');
  assert.equal(engine.hint(st), null, 'pero no sirve para nada');
  assert.equal(engine.isStuck(st), true, 'la pista y el atasco han de coincidir');

  const despues = engine.applyMove(st, movimientos[0]).state;
  assert.equal(engine.isStuck(despues), true, 'y sigue muerta después de hacerlo');
});

test('estar atascado es un aviso: se puede seguir jugando y bajar una carta de la fundación', () => {
  const { game, store } = crear();
  game.newGame(2);
  const st = {
    ...engine.cloneState(game.state),
    ...tablero({
      foundations: [[[1, 'S'], [2, 'S'], [3, 'S'], [4, 'S'], [5, 'S']], [], [], []],
      primeraSola: [6, 'H'],
      tops: [[9, 'S'], [9, 'H'], [9, 'D'], [9, 'C'], [3, 'D'], [3, 'C']],
    }),
  };
  store.saveGame({ version: 1, state: st, baseScore: 50, moves: 20, elapsedMs: 0, prefs: game.prefs, history: [] });
  assert.equal(game.resume(), true);
  assert.equal(game.status, 'stuck', 'no queda ninguna jugada útil');

  const rescate = { type: 'move', from: { pile: PILE.FOUNDATION, index: 0 }, to: { pile: PILE.TABLEAU, index: 0 }, count: 1 };
  assert.equal(engine.isLegal(game.state, rescate), true);
  assert.equal(game.play(rescate), true, 'el controlador ya no bloquea la jugada que desatasca');
  assert.equal(game.status, 'playing');
  assert.equal(game.state.tableau[0].at(-1).rank, 5, 'el 5 de picas baja al 6 de corazones');
  assert.equal(game.state.tableau[0].at(-1).suit, 'S');
  assert.equal(game.state.foundations[0].length, 4);
});

test('sin salida se distingue de «aún cabe bajar una carta de las pilas de arriba»', () => {
  const montar = (extra) => {
    const { game, store } = crear();
    game.newGame(2);
    const st = { ...engine.cloneState(game.state), ...tablero(extra) };
    store.saveGame({ version: 1, state: st, baseScore: 0, moves: 9, elapsedMs: 0, prefs: game.prefs, history: [] });
    assert.equal(game.resume(), true);
    return game;
  };

  const conRescate = montar({
    foundations: [[[1, 'S'], [2, 'S'], [3, 'S'], [4, 'S'], [5, 'S']], [], [], []],
    primeraSola: [6, 'H'],
    tops: [[9, 'S'], [9, 'H'], [9, 'D'], [9, 'C'], [3, 'D'], [3, 'C']],
  });
  assert.equal(conRescate.status, 'stuck');
  assert.equal(conRescate.hasAnyMove, true, 'el 5 de picas todavía puede bajar al 6 de corazones');

  const muerta = montar({ tops: [[9, 'S'], [9, 'H'], [9, 'D'], [9, 'C'], [3, 'D'], [3, 'C'], [7, 'S']] });
  assert.equal(muerta.status, 'stuck');
  assert.equal(muerta.hasAnyMove, false, 'sin fundaciones que desatasquen no queda nada que mover');
});

test('una partida muerta cuenta como derrota al dejarla', () => {
  const { game, store } = crear();
  game.newGame(2);
  const st = {
    ...engine.cloneState(game.state),
    ...tablero({ tops: [[9, 'S'], [9, 'H'], [9, 'D'], [9, 'C'], [3, 'D'], [3, 'C'], [7, 'S']] }),
  };
  store.saveGame({ version: 1, state: st, baseScore: 30, moves: 12, elapsedMs: 0, prefs: game.prefs, history: [] });
  game.resume();
  assert.equal(game.status, 'stuck');
  assert.equal(store.getStats('standard', 1).played, 0, 'todavía no se apunta: aún puede deshacer');

  game.newGame(3);
  const s = store.getStats('standard', 1);
  assert.equal(s.played, 1);
  assert.equal(s.won, 0);
  assert.equal(s.currentStreak, 0);
});

test('cambiar de modalidad a media partida apunta la derrota en la modalidad correcta', () => {
  const { game, store } = crear({ scoring: 'standard', drawCount: 1 });
  game.newGame(9);
  game.draw();
  game.setPrefs({ scoring: 'vegas' });      // reparte de nuevo; la anterior se da por perdida
  assert.equal(store.getStats('standard', 1).played, 1, 'la partida perdida es de estándar');
  assert.equal(store.getStats('vegas', 1).played, 0);
  assert.equal(store.getBank(1), 0, 'y sus puntos no entran en la banca de Vegas');
});

test('sin cronómetro no hay bonificación por ganar rápido', () => {
  for (const timed of [true, false]) {
    const { game, store, reloj } = crear({ timed });
    game.newGame(4);
    const st = engine.cloneState(game.state);
    st.stock = []; st.waste = []; st.tableau = [[], [], [], [], [], [], []];
    st.foundations = baraja();
    st.tableau[0] = [st.foundations[0].pop()];
    st.timed = timed;
    store.saveGame({ version: 1, state: st, baseScore: 100, moves: 50, elapsedMs: 60000, prefs: game.prefs, history: [] });
    game.resume();
    reloj.t += 1;
    while (game.autoCompleteStep());
    assert.equal(game.status, 'won');
    if (timed) assert.ok(game.score > 1000, `con cronómetro sí bonifica (${game.score})`);
    else assert.equal(game.score, 110, 'sin cronómetro, solo los puntos de las jugadas');
  }
});

test('apagar el cronómetro a mitad no cambia las reglas de la partida en curso', () => {
  const { game, reloj } = crear({ timed: true });
  game.newGame(5);
  game.play(game.hint());
  reloj.t += 60000;
  const conTiempo = game.score;
  game.setPrefs({ timed: false });
  assert.equal(game.score, conTiempo, 'la partida se reparte con su modalidad y no se cambia a mitad');
});

test('sendToFoundation solo mueve la carta que se le indica', () => {
  const { game } = crear();
  game.newGame(6);
  const st = engine.cloneState(game.state);
  st.foundations = [[], [], [], []];
  for (let r = 1; r <= 7; r++) st.foundations[0].push({ id: `${r}S`, rank: r, suit: 'S', faceUp: true });
  st.tableau[5] = [
    { id: '4C', rank: 4, suit: 'C', faceUp: false },
    { id: '9H', rank: 9, suit: 'H', faceUp: true },
    { id: '8S', rank: 8, suit: 'S', faceUp: true },
  ];
  game.newGame(6);
  Object.assign(game.state, st);

  assert.equal(game.sendToFoundation({ pile: PILE.TABLEAU, index: 5 }, '9H'), false, 'el 9H está enterrado: no se toca nada');
  assert.equal(game.state.foundations[0].length, 7);
  assert.equal(game.sendToFoundation({ pile: PILE.TABLEAU, index: 5 }, '8S'), true);
  assert.equal(game.state.foundations[0].at(-1).id, '8S');
  assert.equal(game.sendToFoundation({ pile: PILE.FOUNDATION, index: 0 }, '8S'), false, 'de las fundaciones no se sube nada');
});

test('el contador de versión sube con cada cambio de estado', () => {
  const { game } = crear();
  game.newGame(7);
  const e0 = game.epoch;
  game.draw();
  assert.ok(game.epoch > e0);
  const e1 = game.epoch;
  game.undo();
  assert.ok(game.epoch > e1);
  const e2 = game.epoch;
  game.newGame(8);
  assert.ok(game.epoch > e2);
});

// --- regresiones de la segunda vuelta (fallos introducidos al corregir los primeros) ---

test('retomar la partida no vuelve a encender el contrarreloj que apagaste', () => {
  const { game, store } = crear({ timed: true });
  game.newGame(11);
  game.draw();
  game.setPrefs({ timed: false });          // cambiarlo no reparte de nuevo, a propósito
  assert.equal(store.getPrefs().timed, false);
  game.flush();

  const otro = createGame({ store, now: () => 0 });
  assert.equal(otro.resume(), true);
  assert.equal(store.getPrefs().timed, false, 'la preferencia del jugador manda');
  assert.equal(otro.prefs.timed, false);
  assert.equal(otro.mode.timed, true, 'pero la partida en curso sigue siendo contrarreloj');

  otro.newGame(12);
  assert.equal(otro.mode.timed, false, 'y el reparto siguiente ya no lo es');
});

test('retomar sí recupera la modalidad de robo y puntuación', () => {
  const { game, store } = crear({ drawCount: 3, scoring: 'vegas' });
  game.newGame(14);
  game.draw();
  game.flush();
  store.setPrefs({ drawCount: 1, scoring: 'standard' });   // como si otra pestaña lo hubiera cambiado

  const otro = createGame({ store, now: () => 0 });
  otro.resume();
  assert.equal(otro.prefs.drawCount, 3);
  assert.equal(otro.prefs.scoring, 'vegas');
  assert.equal(otro.mode.drawCount, 3);
});

test('deshacer vuelve a comprobar si la posición sigue muerta', () => {
  const { game, store } = crear();
  game.newGame(15);
  const st = {
    ...engine.cloneState(game.state),
    ...tablero({ primeraSola: [13, 'S'], tops: [[9, 'S'], [9, 'H'], [9, 'D'], [9, 'C'], [3, 'D']] }),
  };
  store.saveGame({ version: 1, state: st, baseScore: 0, moves: 4, elapsedMs: 0, prefs: game.prefs, history: [] });
  game.resume();
  assert.equal(game.status, 'stuck');

  // El rey de hueco a hueco: legal, inútil, y la posición sigue muerta después y antes.
  const rey = { type: 'move', from: { pile: PILE.TABLEAU, index: 0 }, to: { pile: PILE.TABLEAU, index: 6 }, count: 1 };
  assert.equal(game.play(rey), true);
  assert.equal(game.status, 'stuck');
  assert.equal(game.undo(), true);
  assert.equal(game.status, 'stuck', 'deshacer no resucita una posición que sigue muerta');
});

test('deshacer una jugada que mató la partida sí la devuelve a la vida', () => {
  const { game } = crear();
  game.newGame(16);
  game.draw();
  assert.equal(game.status, 'playing');
  game.undo();
  assert.equal(game.status, 'playing');
});

test('game.mode expone la modalidad del reparto, no la preferencia viva', () => {
  const { game } = crear({ scoring: 'standard', drawCount: 1, timed: true });
  game.newGame(17);
  game.draw();
  game.setPrefs({ timed: false });
  assert.deepEqual(game.mode, { scoring: 'standard', drawCount: 1, timed: true });
  assert.equal(game.prefs.timed, false);
});
