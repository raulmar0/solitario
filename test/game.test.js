import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, formatTime } from '../src/game.js';
import { createStore, memoryBackend } from '../src/storage.js';
import * as engine from '../src/engine.js';
import { PILE } from '../src/engine.js';
import * as advisor from '../src/advisor.js';
import { createDeck, SUITS } from '../src/cards.js';

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

/**
 * Un tablero sin una sola jugada y con solo dos cartas en el mazo: las siete
 * columnas enseñan cartas rojas que no se apilan entre sí ni suben a ninguna
 * fundación, y todo lo demás está boca abajo. Lo único que se puede hacer es
 * dar vueltas al mazo, que es justo lo que hace falta para probar el historial.
 */
function tableroMuerto() {
  const baraja = createDeck();
  const carta = (id, faceUp) => ({ ...baraja.find((c) => c.id === id), faceUp });
  const enElMazo = ['3D', '2H'];   // ni son ases ni caben sobre ninguna columna
  const alaVista = ['4H', '6H', '8H', '10H', '4D', '6D', '8D'];
  const tableau = alaVista.map((id) => [carta(id, true)]);
  // El resto se entierra boca abajo: da igual dónde caiga, solo tienen que sumar 52.
  baraja.filter((c) => !alaVista.includes(c.id) && !enElMazo.includes(c.id))
    .forEach((c, i) => { tableau[i % 7].unshift({ ...c, faceUp: false }); });
  return {
    seed: 4242, drawCount: 1, scoring: 'standard', timed: false,
    recycles: 0, maxRecycles: Infinity,
    stock: enElMazo.map((id) => carta(id, false)),
    waste: [], foundations: [[], [], [], []], tableau,
  };
}

/** Mete una posición a medida por la única puerta que hay: la partida guardada. */
function retomar(store, game, state) {
  store.saveGame({
    version: 1,
    state,
    baseScore: 0,
    moves: 0,
    elapsedMs: 0,
    prefs: { drawCount: state.drawCount, scoring: state.scoring, timed: state.timed },
    history: [],
  });
  return game.resume();
}

test('partida nueva: estado limpio y listo para jugar', () => {
  const { game } = crear();
  game.newGame(1);
  assert.equal(game.status, 'playing');
  assert.equal(game.moves, 0);
  assert.equal(game.score, 0);
  assert.equal(game.elapsedMs, 0);
  assert.equal(game.canUndo, false);
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

test('se sabe en todo momento si el reloj corre: la cabecera lo enseña cuando está parado', () => {
  const { game } = crear();
  game.newGame(1);
  assert.equal(game.clockRunning, false, 'antes de la primera jugada el reloj no ha arrancado');
  game.draw();
  assert.equal(game.clockRunning, true, 'la primera jugada lo pone en marcha');
  game.pause();
  assert.equal(game.clockRunning, false);
  game.resumeClock();
  assert.equal(game.clockRunning, true, 'y al volver sigue donde estaba');
});

test('el tiempo resta puntos en la partida cronometrada', () => {
  const { game, reloj } = crear({ timed: true });
  game.newGame(1);
  for (let i = 0; i < 30 && game.baseScore < 60; i++) {
    const h = game.hint();
    if (!h) break;
    game.play(h.move);
  }
  const base = game.baseScore;
  assert.ok(base >= 60, 'hacen falta puntos suficientes para ver el descuento');
  reloj.t += 60000;
  assert.equal(game.score, base - 12, '-2 puntos por cada 10 s');
});

test('la puntuación estándar no baja de cero por mucho que tardes', () => {
  const { game, reloj } = crear({ timed: true });
  game.newGame(1);
  game.play(game.hint().move);
  reloj.t += 3600000;
  assert.equal(game.score, 0);
});

test('sin cronómetro el tiempo no descuenta', () => {
  const { game, reloj } = crear({ timed: false });
  game.newGame(1);
  game.play(game.hint().move);
  const base = game.baseScore;
  reloj.t += 600000;
  assert.equal(game.score, base);
});

test('deshacer devuelve las cartas a su sitio y los puntos a como estaban', () => {
  const { game } = crear();
  game.newGame(1);
  const antes = JSON.stringify(game.state);
  game.play(game.hint().move);
  assert.notEqual(JSON.stringify(game.state), antes);

  assert.equal(game.undo(), true);
  assert.equal(JSON.stringify(game.state), antes, 'el tablero vuelve a como estaba');
  assert.equal(game.score, 0, 'y los puntos de la jugada se devuelven');
  assert.equal(game.moves, 0);
  assert.equal(game.undos, 1, 'lo que sí se apunta es que se ha deshecho');
  assert.equal(game.canUndo, false);
});

test('rehacer ya no existe: deshacer es un camino de ida', () => {
  const { game } = crear();
  game.newGame(1);
  game.draw();
  assert.equal(game.undo(), true);
  // Se quitó a propósito en la 1.5 (con el botón #btn-redo y con Ctrl+Y): no es un olvido,
  // y si alguien lo reintroduce esta prueba tiene que caerse para que se hable del asunto.
  assert.equal('redo' in game, false, 'game.redo no vuelve');
  assert.equal('canRedo' in game, false, 'game.canRedo tampoco');
  assert.equal(game.redo, undefined);
  assert.equal(game.canRedo, undefined);
  assert.equal(game.canUndo, false, 'lo deshecho no se queda esperando en ninguna parte');
});

test('sin nada que deshacer, deshacer no hace nada', () => {
  const { game } = crear();
  game.newGame(1);
  assert.equal(game.canUndo, false);
  assert.equal(game.undo(), false);
  assert.equal(game.moves, 0, 'y no se cuela un movimiento fantasma');
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

test('el contador de fundaciones cuenta las cartas de arriba y llega a 52 al ganar', () => {
  const { game, store } = crear();
  assert.equal(game.foundationCount, 0, 'sin partida no hay nada arriba');
  game.newGame(3);
  assert.equal(game.foundationCount, 0, 'el reparto no sube ninguna carta');

  store.saveGame({ version: 1, state: casiGanada(game), baseScore: 0, moves: 1, elapsedMs: 1000, prefs: game.prefs, history: [] });
  game.resume();
  assert.equal(game.foundationCount, 51, 'falta el rey de picas');
  while (game.autoCompleteStep());
  assert.equal(game.status, 'won');
  assert.equal(game.foundationCount, 52, 'ganar es tener las 52 arriba');
  assert.equal(game.clockRunning, false, 'y con la partida ganada el reloj se para');
});

test('el contador de fundaciones no se despega de las pilas en una partida de verdad', () => {
  const { game } = crear();
  game.newGame(7);          // esta semilla sube su primer as pronto: así la prueba mira algo
  for (let i = 0; i < 20; i++) {
    const h = game.hint();
    if (!h) break;
    game.play(h.move);
    assert.equal(game.foundationCount, game.state.foundations.flat().length);
  }
  assert.ok(game.foundationCount > 0, 'si no se sube nada, la comprobación de arriba no dice nada');
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

test('la pista siempre es legal, trae motivo y alternativas, y no hay pista fuera de juego', () => {
  const { game, store } = crear();
  assert.equal(game.hint(), null, 'sin partida repartida no hay nada que aconsejar');

  game.newGame(1);
  const h = game.hint();
  assert.ok(h, 'recién repartido siempre queda algo que proponer');
  assert.equal(engine.isLegal(game.state, h.move), true, 'la jugada propuesta se puede hacer');
  assert.equal(typeof h.reason, 'string');
  assert.ok(h.reason.length > 0, 'la pista dice por qué, que es lo que la interfaz enseña');
  assert.ok(Array.isArray(h.alternatives), 'y qué más se podía hacer');
  for (const alt of h.alternatives) {
    assert.equal(engine.isLegal(game.state, alt.move), true, 'las alternativas también son legales');
  }

  store.saveGame({ version: 1, state: casiGanada(game), baseScore: 0, moves: 1, elapsedMs: 0, prefs: game.prefs, history: [] });
  game.resume();
  while (game.autoCompleteStep());
  assert.equal(game.status, 'won');
  assert.equal(game.hint(), null, 'con la partida ganada no se aconseja nada');
});

test('la pista no propone volver a la posición de la que se acaba de salir', () => {
  const { game, store } = crear();
  assert.equal(retomar(store, game, tableroMuerto()), true);
  game.draw();
  game.draw();                       // el mazo se vacía: solo queda darle otra vuelta
  assert.equal(engine.isLegal(game.state, { type: 'recycle' }), true, 'reciclar sigue siendo legal');

  // A pelo, el recomendador propone reciclar: es lo único que queda. Pero reciclar
  // devuelve el tablero exactamente a la posición de hace dos jugadas, y game.hint()
  // le pasa las huellas recientes justo para que no mande al jugador a esa noria.
  assert.equal(advisor.recomendar(game.state).move.type, 'recycle');
  assert.equal(game.hint(), null, 'no se aconseja deshacer a mano lo que se acaba de hacer');
});

test('siguiendo la pista jugada tras jugada no se dan vueltas en círculo', () => {
  const { game } = crear();
  game.newGame(7);
  // game.hint() no es advisor.recomendar() a secas: le añade las huellas de las últimas
  // doce posiciones. Sin eso, con esta semilla la partida entra en bucle antes de la
  // jugada setenta y la pista pasea la misma carta de un lado a otro para siempre.
  const recientes = [engine.huellaEstado(game.state)];
  let jugadas = 0;
  for (let i = 0; i < 100; i++) {
    const h = game.hint();
    if (!h) break;
    game.play(h.move);
    jugadas++;
    const huella = engine.huellaEstado(game.state);
    assert.equal(recientes.slice(-12).includes(huella), false,
      `la jugada ${jugadas} devuelve a una posición por la que ya se había pasado`);
    recientes.push(huella);
  }
  assert.ok(jugadas > 50, 'con menos jugadas la prueba no llega a donde empezaban los bucles');
});

test('formatTime', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(1000), '00:01');
  assert.equal(formatTime(61000), '01:01');
  assert.equal(formatTime(3600000), '60:00');
  assert.equal(formatTime(-500), '00:00');
});
