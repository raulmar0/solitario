import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend, DEFAULT_PREFS, MAX_SCORES, KEYS, modeKey } from '../src/storage.js';

const nuevo = () => createStore(memoryBackend());
const partida = (over = {}) => ({
  scoring: 'standard', drawCount: 1, score: 100, won: true,
  timeMs: 60000, moves: 120, seed: 7, at: '2026-08-24T10:00:00.000Z', ...over,
});

test('preferencias: valores por defecto, guardado y saneado', () => {
  const store = nuevo();
  assert.deepEqual(store.getPrefs(), DEFAULT_PREFS);
  store.setPrefs({ drawCount: 3, timed: false });
  assert.equal(store.getPrefs().drawCount, 3);
  assert.equal(store.getPrefs().timed, false);
  assert.equal(store.getPrefs().scoring, 'standard', 'lo no tocado se mantiene');
  assert.equal(store.getPrefs().penalizeHints, false);

  store.setPrefs({ penalizeHints: true });
  assert.equal(store.getPrefs().penalizeHints, true);

  store.setPrefs({ drawCount: 7, scoring: 'ruleta', penalizeHints: 1 });
  assert.equal(store.getPrefs().drawCount, 1, 'un valor imposible vuelve al de fábrica');
  assert.equal(store.getPrefs().scoring, 'standard');
  assert.equal(store.getPrefs().penalizeHints, true);
});

test('preferencias corruptas no rompen nada', () => {
  const backend = memoryBackend({ [KEYS.prefs]: '{esto no es json' });
  assert.deepEqual(createStore(backend).getPrefs(), DEFAULT_PREFS);
});

test('estadísticas: victoria suma partida, racha y mejores marcas', () => {
  const store = nuevo();
  store.recordGame(partida({ score: 100, timeMs: 90000, moves: 150 }));
  store.recordGame(partida({ score: 250, timeMs: 60000, moves: 120 }));
  const s = store.getStats('standard', 1);
  assert.equal(s.played, 2);
  assert.equal(s.won, 2);
  assert.equal(s.bestScore, 250);
  assert.equal(s.bestTimeMs, 60000);
  assert.equal(s.fewestMoves, 120);
  assert.equal(s.currentStreak, 2);
  assert.equal(s.bestStreak, 2);
  assert.equal(s.totalScore, 350);
});

test('estadísticas: una derrota corta la racha pero conserva la mejor', () => {
  const store = nuevo();
  store.recordGame(partida({ score: 10 }));
  store.recordGame(partida({ score: 20 }));
  store.recordGame(partida({ score: 5, won: false, timeMs: 10000, moves: 3 }));
  const s = store.getStats('standard', 1);
  assert.equal(s.played, 3);
  assert.equal(s.won, 2);
  assert.equal(s.currentStreak, 0);
  assert.equal(s.bestStreak, 2);
  assert.equal(s.bestTimeMs, 60000, 'una derrota rápida no cuenta como mejor tiempo');
  assert.equal(s.fewestMoves, 120, 'ni como menos movimientos');
  assert.equal(s.bestScore, 20);
});

test('las estadísticas van por modo y forma de robar', () => {
  const store = nuevo();
  store.recordGame(partida({ scoring: 'standard', drawCount: 1 }));
  store.recordGame(partida({ scoring: 'standard', drawCount: 3 }));
  store.recordGame(partida({ scoring: 'vegas', drawCount: 3, score: 20 }));
  assert.equal(store.getStats('standard', 1).played, 1);
  assert.equal(store.getStats('standard', 3).played, 1);
  assert.equal(store.getStats('vegas', 3).played, 1);
  assert.equal(store.getStats('vegas', 1).played, 0, 'un modo sin jugar sale a cero');
  assert.deepEqual(Object.keys(store.getAllStats()).sort(), ['standard-1', 'standard-3', 'vegas-3']);
  assert.equal(modeKey('vegas', 3), 'vegas-3');
});

test('tabla de récords: ordenada por puntos y luego por tiempo', () => {
  const store = nuevo();
  store.recordGame(partida({ score: 100, timeMs: 50000 }));
  store.recordGame(partida({ score: 300, timeMs: 80000 }));
  store.recordGame(partida({ score: 300, timeMs: 40000 }));
  const top = store.getScores({ limit: 3 });
  assert.deepEqual(top.map((r) => [r.score, r.timeMs]), [[300, 40000], [300, 80000], [100, 50000]]);
});

test('tabla de récords: se filtra y se recorta por modalidad', () => {
  const store = nuevo();
  for (let i = 0; i < MAX_SCORES + 10; i++) {
    store.recordGame(partida({ score: i, scoring: i % 2 ? 'vegas' : 'standard', won: i % 3 === 0 }));
  }
  assert.equal(store.getScores({ scoring: 'standard', drawCount: 1 }).length, Math.min(MAX_SCORES, 18));
  assert.ok(store.getScores({ scoring: 'vegas' }).every((r) => r.scoring === 'vegas'));
  assert.ok(store.getScores({ wonOnly: true }).every((r) => r.won));
  assert.equal(store.getScores({ limit: 3 }).length, 3);
  assert.equal(store.getScores()[0].score, MAX_SCORES + 9, 'la mejor sobrevive al recorte');
});

test('inundar una modalidad no borra los récords de las demás', () => {
  const store = nuevo();
  store.recordGame(partida({ scoring: 'vegas', drawCount: 3, score: 7, at: 'vegas' }));
  for (let i = 0; i < MAX_SCORES * 2; i++) {
    store.recordGame(partida({ scoring: 'standard', drawCount: 1, score: 1000 + i }));
  }
  const vegas = store.getScores({ scoring: 'vegas', drawCount: 3 });
  assert.equal(vegas.length, 1, 'la única partida de Vegas sigue ahí pese a las 50 de estándar');
  assert.equal(vegas[0].at, 'vegas');
  assert.equal(store.getScores({ scoring: 'standard', drawCount: 1 }).length, MAX_SCORES);
});

test('banca de Vegas: acumula por forma de robar y se puede poner a cero', () => {
  const store = nuevo();
  assert.equal(store.getBank(1), 0);
  store.recordGame(partida({ scoring: 'vegas', drawCount: 1, score: -20 }));
  store.recordGame(partida({ scoring: 'vegas', drawCount: 1, score: 45 }));
  store.recordGame(partida({ scoring: 'vegas', drawCount: 3, score: 100 }));
  assert.equal(store.getBank(1), 25);
  assert.equal(store.getBank(3), 100);
  store.resetBank(1);
  assert.equal(store.getBank(1), 0);
  assert.equal(store.getBank(3), 100, 'reiniciar una banca no toca la otra');
});

test('la banca solo se mueve en Vegas', () => {
  const store = nuevo();
  store.recordGame(partida({ scoring: 'standard', drawCount: 1, score: 500 }));
  assert.equal(store.getBank(1), 0);
});

test('partida en curso: guardar, leer y borrar', () => {
  const store = nuevo();
  assert.equal(store.loadGame(), null);
  store.saveGame({ version: 1, moves: 5 });
  assert.deepEqual(store.loadGame(), { version: 1, moves: 5 });
  store.clearGame();
  assert.equal(store.loadGame(), null);
});

test('exportar e importar deja todo igual', () => {
  const store = nuevo();
  store.setPrefs({ drawCount: 3, playerName: 'Raúl' });
  store.recordGame(partida({ score: 400 }));
  store.recordGame(partida({ scoring: 'vegas', drawCount: 3, score: 60 }));
  const copia = JSON.parse(JSON.stringify(store.exportAll()));

  const otro = nuevo();
  otro.importAll(copia);
  assert.equal(otro.getPrefs().playerName, 'Raúl');
  assert.equal(otro.getStats('standard', 1).bestScore, 400);
  assert.equal(otro.getBank(3), 60);
  assert.equal(otro.getScores()[0].score, 400);
});

test('importar basura da error en vez de borrar los datos', () => {
  const store = nuevo();
  store.recordGame(partida({ score: 400 }));
  assert.throws(() => store.importAll(null), /no válida/);
  assert.throws(() => store.importAll('vaya'), /no válida/);
  assert.equal(store.getStats('standard', 1).bestScore, 400, 'los datos siguen ahí');
});

test('resetAll borra todo lo del juego', () => {
  const store = nuevo();
  store.setPrefs({ drawCount: 3 });
  store.recordGame(partida());
  store.saveGame({ version: 1 });
  store.resetAll();
  assert.deepEqual(store.getPrefs(), DEFAULT_PREFS);
  assert.deepEqual(store.getAllStats(), {});
  assert.deepEqual(store.getScores(), []);
  assert.equal(store.loadGame(), null);
});

test('si localStorage no está disponible se sigue jugando sin persistir', () => {
  const roto = {
    getItem() { throw new Error('bloqueado'); },
    setItem() { throw new Error('bloqueado'); },
    removeItem() { throw new Error('bloqueado'); },
  };
  const store = createStore(roto);
  assert.deepEqual(store.getPrefs(), DEFAULT_PREFS);
  store.setPrefs({ drawCount: 3 });
  assert.equal(store.getPrefs().drawCount, 3, 'funciona en memoria');
  store.recordGame(partida());
  assert.equal(store.getStats('standard', 1).played, 1);
});

test('el reto diario lleva su propia libreta, con el mejor intento de cada día', () => {
  const store = createStore(memoryBackend());
  assert.deepEqual(store.getRetos(), {});
  assert.equal(store.getReto('2026-08-29'), null);

  // Una partida normal no toca la libreta; la del reto sí, por su fecha.
  store.recordGame({ ...partida(), score: 500 });
  assert.deepEqual(store.getRetos(), {});
  store.recordGame({ ...partida(), score: 500, won: false, dia: '2026-08-29' });
  assert.equal(store.getReto('2026-08-29').score, 500);
  assert.equal(store.getReto('2026-08-29').won, false);

  // Se repite el día: manda ganar, aunque puntúe menos.
  store.recordGame({ ...partida(), score: 200, won: true, dia: '2026-08-29' });
  assert.equal(store.getReto('2026-08-29').won, true);
  assert.equal(store.getReto('2026-08-29').score, 200);
  // Y entre dos ganadas, la de más puntos.
  store.recordGame({ ...partida(), score: 100, won: true, dia: '2026-08-29' });
  assert.equal(store.getReto('2026-08-29').score, 200, 'el peor intento no pisa al mejor');
  store.recordGame({ ...partida(), score: 900, won: true, dia: '2026-08-29' });
  assert.equal(store.getReto('2026-08-29').score, 900);

  // Cada día va por su cuenta, y las partidas del reto cuentan en los récords
  // como cualquier otra: es la misma partida, solo que con reparto de fecha.
  store.recordGame({ ...partida(), score: 40, won: false, dia: '2026-08-28' });
  assert.equal(Object.keys(store.getRetos()).length, 2);
  assert.equal(store.getStats('standard', 1).played, 6);

  // Una fecha inventada no entra en la libreta.
  assert.equal(store.recordReto('mañana', { won: true, score: 1 }), null);
  assert.equal(Object.keys(store.getRetos()).length, 2);

  // Guarda timed, penalizeHints y hints
  store.recordReto('2026-08-27', { won: true, score: 350, timed: true, penalizeHints: true, hints: 2, scoring: 'standard', drawCount: 1 });
  const retoGuardado = store.getReto('2026-08-27');
  assert.equal(retoGuardado.timed, true);
  assert.equal(retoGuardado.penalizeHints, true);
  assert.equal(retoGuardado.hints, 2);
});

test('los retos se exportan y se importan con el resto de los datos', () => {
  const store = createStore(memoryBackend());
  store.recordGame({ ...partida(), score: 700, won: true, dia: '2026-08-29' });
  const copia = store.exportAll();
  assert.equal(copia.retos['2026-08-29'].score, 700);

  const otro = createStore(memoryBackend());
  otro.importAll(copia);
  assert.equal(otro.getReto('2026-08-29').score, 700);

  // Y borrarlo todo se los lleva por delante, como a los récords.
  store.resetAll();
  assert.deepEqual(store.getRetos(), {});
});

test('una libreta de retos con forma rara no rompe nada', () => {
  const store = createStore(memoryBackend({ [KEYS.retos]: JSON.stringify(['no', 'es', 'un', 'objeto']) }));
  assert.deepEqual(store.getRetos(), {});
  assert.equal(store.getReto('2026-08-29'), null);
});

test('sin backend se usa memoria', () => {
  const store = createStore(undefined);
  store.setPrefs({ timed: false });
  assert.equal(store.getPrefs().timed, false);
});

test('registros con forma rara no rompen la lectura', () => {
  const backend = memoryBackend({
    [KEYS.scores]: JSON.stringify([null, 'x', { score: 10, scoring: 'standard', drawCount: 1 }]),
    [KEYS.stats]: JSON.stringify('no es un objeto'),
  });
  const store = createStore(backend);
  assert.equal(store.getScores().length, 1);
  assert.deepEqual(store.getAllStats(), {});
});
