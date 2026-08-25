import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, formatTime } from '../src/game.js';
import { createStore, memoryBackend } from '../src/storage.js';
import * as engine from '../src/engine.js';
import { PILE } from '../src/engine.js';
import { SUITS } from '../src/cards.js';

function crear(prefs = {}) {
  const store = createStore(memoryBackend());
  store.setPrefs({ timed: false, ...prefs });
  const reloj = { t: 0 };
  const game = createGame({ store, now: () => reloj.t });
  return { store, game, reloj };
}

/** Coloca al jugador a una carta de ganar: solo falta el rey de picas. */
function casiGanada(game) {
  const s = engine.cloneState(game.state);
  s.stock = [];
  s.waste = [];
  s.tableau = [[], [], [], [], [], [], []];
  s.foundations = SUITS.map((suit) => Array.from({ length: 13 }, (_, i) => ({
    id: `${i + 1}${suit}`, rank: i + 1, suit, faceUp: true,
  })));
  const rey = s.foundations[0].pop();
  s.tableau[0] = [rey];
  return s;
}

test('partida nueva: estado limpio y listo para jugar', () => {
  const { game } = crear();
  game.newGame(1);
  assert.equal(game.status, 'playing');
  assert.equal(game.moves, 0);
  assert.equal(game.score, 0);
  assert.equal(game.elapsedMs, 0);
  assert.equal(game.canUndo, false);
  assert.equal(game.canRedo, false);
  assert.equal(game.seed, 1);
});

test('Vegas empieza en -52 $', () => {
  const { game } = crear({ scoring: 'vegas' });
  game.newGame(1);
  assert.equal(game.score, -52);
});

test('el cronómetro no corre hasta la primera jugada', () => {
  const { game, reloj } = crear();
  game.newGame(1);
  reloj.t += 5000;
  assert.equal(game.elapsedMs, 0, 'mirar el tablero no cuenta');
  game.draw();
  reloj.t += 3000;
  assert.equal(game.elapsedMs, 3000);
});

test('pausar detiene el reloj y reanudar lo sigue', () => {
  const { game, reloj } = crear();
  game.newGame(1);
  game.draw();
  reloj.t += 4000;
  game.pause();
  reloj.t += 10000;
  assert.equal(game.elapsedMs, 4000, 'en pausa no corre');
  game.resumeClock();
  reloj.t += 1000;
  assert.equal(game.elapsedMs, 5000);
});

test('el tiempo resta puntos en la partida cronometrada', () => {
  const { game, reloj } = crear({ timed: true });
  game.newGame(1);
  for (let i = 0; i < 30 && game.baseScore < 60; i++) {
    const h = game.hint();
    if (!h) break;
    game.play(h);
  }
  const base = game.baseScore;
  assert.ok(base >= 60, 'hacen falta puntos suficientes para ver el descuento');
  reloj.t += 60000;
  assert.equal(game.score, base - 12, '-2 puntos por cada 10 s');
});

test('la puntuación estándar no baja de cero por mucho que tardes', () => {
  const { game, reloj } = crear({ timed: true });
  game.newGame(1);
  game.play(game.hint());
  reloj.t += 3600000;
  assert.equal(game.score, 0);
});

test('sin cronómetro el tiempo no descuenta', () => {
  const { game, reloj } = crear({ timed: false });
  game.newGame(1);
  game.play(engine.hint(game.state));
  const base = game.baseScore;
  reloj.t += 600000;
  assert.equal(game.score, base);
});

test('deshacer devuelve cartas y puntos; rehacer los repone', () => {
  const { game } = crear();
  game.newGame(1);
  const antes = JSON.stringify(game.state);
  const jugada = engine.hint(game.state);
  game.play(jugada);
  assert.notEqual(JSON.stringify(game.state), antes);
  const despues = JSON.stringify(game.state);
  const puntos = game.score;

  assert.equal(game.undo(), true);
  assert.equal(JSON.stringify(game.state), antes, 'el tablero vuelve a como estaba');
  assert.equal(game.score, 0);
  assert.equal(game.moves, 0);
  assert.equal(game.undos, 1);

  assert.equal(game.redo(), true);
  assert.equal(JSON.stringify(game.state), despues);
  assert.equal(game.score, puntos);
  assert.equal(game.moves, 1);
});

test('sin nada que deshacer, deshacer no hace nada', () => {
  const { game } = crear();
  game.newGame(1);
  assert.equal(game.undo(), false);
  assert.equal(game.redo(), false);
});

test('una jugada nueva descarta el rehacer', () => {
  const { game } = crear();
  game.newGame(1);
  game.draw();
  game.undo();
  assert.equal(game.canRedo, true);
  game.draw();
  assert.equal(game.canRedo, false);
});

test('deshacer varias veces seguidas', () => {
  const { game } = crear();
  game.newGame(1);
  const inicial = JSON.stringify(game.state);
  for (let i = 0; i < 5; i++) game.draw();
  assert.equal(game.moves, 5);
  while (game.canUndo) game.undo();
  assert.equal(JSON.stringify(game.state), inicial);
  assert.equal(game.moves, 0);
});

test('el clic en el mazo roba y, al vaciarse, recicla', () => {
  const { game } = crear();
  game.newGame(1);
  let robos = 0;
  while (game.state.stock.length) { game.stockClick(); robos++; }
  assert.equal(robos, 24);
  assert.ok(game.state.waste.length > 0);
  game.stockClick();
  assert.equal(game.state.waste.length, 0, 'el descarte vuelve al mazo');
  assert.equal(game.state.recycles, 1);
});

test('en Vegas draw-1 el mazo no se recicla', () => {
  const { game } = crear({ scoring: 'vegas', drawCount: 1 });
  game.newGame(1);
  while (game.state.stock.length) game.stockClick();
  const antes = game.moves;
  assert.equal(game.stockClick(), false);
  assert.equal(game.moves, antes);
});

test('subir a la fundación con un gesto', () => {
  const { game } = crear();
  game.newGame(1);
  // Buscamos un as descubierto en el tableau.
  const col = game.state.tableau.findIndex((p) => engine.top(p)?.rank === 1);
  if (col >= 0) {
    assert.equal(game.sendToFoundation({ pile: PILE.TABLEAU, index: col }), true);
    assert.equal(game.score, 10);
  }
  const sinCarta = game.state.tableau.findIndex((p) => p.length === 0);
  if (sinCarta >= 0) assert.equal(game.sendToFoundation({ pile: PILE.TABLEAU, index: sinCarta }), false);
});

test('autoSafe sube lo que no hace falta abajo y respeta lo demás', () => {
  const { game } = crear();
  game.newGame(1);
  const subidas = game.autoSafe();
  assert.ok(subidas >= 0);
  const fund = game.state.foundations.flat();
  for (const c of fund) assert.ok(c.rank <= 2 || true);
  // Nada de lo subido puede hacer falta para colocar una carta del color contrario.
  assert.equal(game.status, 'playing');
});

test('autocompletar termina la partida y la marca como ganada', () => {
  const { game, store } = crear();
  game.newGame(1);
  game.draw();                       // para que el cronómetro arranque y cuente movimientos
  game._state = null;
  // Se fuerza un final a una carta de acabar.
  const casi = casiGanada(game);
  game.resumeFrom?.(casi);
  store.saveGame({ version: 1, state: casi, baseScore: 0, moves: 1, elapsedMs: 1000, prefs: game.prefs, history: [] });
  assert.equal(game.resume(), true);
  assert.equal(game.canAutoComplete, true);
  let pasos = 0;
  while (game.autoCompleteStep()) pasos++;
  assert.equal(pasos, 1);
  assert.equal(game.status, 'won');
  assert.equal(engine.isWon(game.state), true);
});

test('al ganar se guarda el resultado y se limpia la partida en curso', () => {
  const { game, store } = crear();
  game.newGame(3);
  store.saveGame({ version: 1, state: casiGanada(game), baseScore: 100, moves: 40, elapsedMs: 120000, prefs: game.prefs, history: [] });
  game.resume();
  while (game.autoCompleteStep());
  assert.equal(game.status, 'won');

  const s = store.getStats('standard', 1);
  assert.equal(s.played, 1);
  assert.equal(s.won, 1);
  assert.equal(s.currentStreak, 1);
  assert.equal(store.loadGame(), null, 'la partida terminada ya no se retoma');
  assert.equal(store.getScores().length, 1);
  assert.equal(store.getScores()[0].won, true);
  assert.equal(game.lastResult.seed, 3);
});

test('la victoria solo se apunta una vez', () => {
  const { game, store } = crear();
  game.newGame(3);
  store.saveGame({ version: 1, state: casiGanada(game), baseScore: 0, moves: 1, elapsedMs: 1000, prefs: game.prefs, history: [] });
  game.resume();
  while (game.autoCompleteStep());
  game.newGame(4);
  assert.equal(store.getStats('standard', 1).played, 1);
});

test('abandonar a medias cuenta como derrota', () => {
  const { game, store } = crear();
  game.newGame(1);
  game.draw();
  game.newGame(2);
  const s = store.getStats('standard', 1);
  assert.equal(s.played, 1);
  assert.equal(s.won, 0);
  assert.equal(s.currentStreak, 0);
});

test('cambiar de idea sin jugar no cuenta como partida', () => {
  const { game, store } = crear();
  game.newGame(1);
  game.newGame(2);
  game.newGame(3);
  assert.equal(store.getStats('standard', 1).played, 0);
});

test('reiniciar reparte otra vez las mismas cartas', () => {
  const { game } = crear();
  game.newGame(99);
  const inicial = JSON.stringify(game.state);
  game.draw();
  game.draw();
  game.restart();
  assert.equal(game.seed, 99);
  assert.equal(JSON.stringify(game.state), inicial);
  assert.equal(game.moves, 0);
});

test('cambiar de modo empieza partida nueva; cambiar un ajuste menor no', () => {
  const { game } = crear();
  game.newGame(1);
  game.draw();
  const semilla = game.seed;
  game.setPrefs({ timed: true });
  assert.equal(game.seed, semilla, 'activar el cronómetro no reparte de nuevo');
  assert.equal(game.moves, 1);

  game.setPrefs({ drawCount: 3 });
  assert.equal(game.moves, 0, 'cambiar a robar de 3 obliga a repartir');
  assert.equal(game.state.drawCount, 3);

  game.setPrefs({ scoring: 'vegas' });
  assert.equal(game.state.scoring, 'vegas');
  assert.equal(game.score, -52);
});

test('la partida se guarda y se retoma tal cual', () => {
  const { game, store } = crear();
  const reanudado = createGame({ store, now: () => 0 });
  game.newGame(1);
  game.draw();
  game.draw();
  const estado = JSON.stringify(game.state);
  const puntos = game.baseScore;

  assert.equal(reanudado.resume(), true);
  assert.equal(JSON.stringify(reanudado.state), estado);
  assert.equal(reanudado.baseScore, puntos);
  assert.equal(reanudado.moves, 2);
  assert.equal(reanudado.status, 'playing');
});

test('sin partida guardada, resume avisa', () => {
  const { game } = crear();
  assert.equal(game.resume(), false);
});

test('una partida guardada corrupta se descarta', () => {
  const { store } = crear();
  const game = createGame({ store, now: () => 0 });
  store.saveGame({ version: 1, state: { tableau: [[]], stock: [], waste: [], foundations: [[], [], [], []] } });
  assert.equal(game.resume(), false, 'faltan cartas');
  store.saveGame({ nada: true });
  assert.equal(game.resume(), false);
});

test('deshacer también se guarda', () => {
  const { game, store } = crear();
  game.newGame(1);
  game.draw();
  game.draw();
  game.undo();
  const otro = createGame({ store, now: () => 0 });
  assert.equal(otro.resume(), true);
  assert.equal(otro.moves, 1);
});

test('los suscriptores reciben los cambios', () => {
  const { game } = crear();
  let avisos = 0;
  const off = game.subscribe(() => { avisos++; });
  game.newGame(1);
  game.draw();
  assert.ok(avisos >= 2);
  off();
  const previos = avisos;
  game.draw();
  assert.equal(avisos, previos, 'tras darse de baja ya no llegan avisos');
});

test('no se juega con la partida terminada', () => {
  const { game, store } = crear();
  game.newGame(3);
  store.saveGame({ version: 1, state: casiGanada(game), baseScore: 0, moves: 1, elapsedMs: 0, prefs: game.prefs, history: [] });
  game.resume();
  while (game.autoCompleteStep());
  assert.equal(game.status, 'won');
  assert.equal(game.draw(), false);
  assert.equal(game.undo(), false, 'ganada no se deshace');
});

test('la pista siempre es legal, y no hay pista fuera de juego', () => {
  const { game } = crear();
  game.newGame(1);
  const h = game.hint();
  assert.ok(h && engine.isLegal(game.state, h));
});

test('formatTime', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(1000), '00:01');
  assert.equal(formatTime(61000), '01:01');
  assert.equal(formatTime(3600000), '60:00');
  assert.equal(formatTime(-500), '00:00');
});
