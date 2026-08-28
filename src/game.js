// Controlador: une motor, puntuación, cronómetro y almacenamiento.
// No toca el DOM; la UI se suscribe con subscribe().

import * as engine from './engine.js';
import { PILE } from './engine.js';
import * as advisor from './advisor.js';
import { randomSeed, SUITS } from './cards.js';
import { randomSolvableSeed } from './solvable-seeds.js';
import { applyEvents, initialScore, timePenalty, winBonus } from './scoring.js';

const MAX_HISTORY = 400;      // tope de deshacer en memoria
const SAVED_HISTORY = 25;     // cuántos pasos se guardan en localStorage

export function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function createGame({ store, now = () => Date.now(), onEvents = () => {} }) {
  const listeners = new Set();

  let prefs = store.getPrefs();
  let state = null;
  let baseScore = 0;
  let moves = 0;
  let undos = 0;
  let history = [];
  let status = 'idle';        // idle | playing | won | stuck
  let startedAt = null;       // instante del primer movimiento
  let elapsedMs = 0;          // tiempo acumulado antes de la pausa actual
  let running = false;
  let recorded = false;
  let lastResult = null;
  let selectionEpoch = 0;      // sube con cada cambio de estado: sirve para invalidar cachés de la interfaz
  let dealId = 0;              // sube solo al repartir de nuevo: la interfaz lo usa para animar el reparto

  const emit = () => { for (const fn of listeners) fn(api); };

  function snapshot() {
    return { state: engine.cloneState(state), baseScore, moves };
  }

  function pushHistory() {
    history.push(snapshot());
    if (history.length > MAX_HISTORY) history.shift();
  }

  /**
   * Huellas de por dónde se ha pasado hace poco. El recomendador las usa para no
   * proponer deshacer a mano lo que se acaba de hacer: doce pasos bastan para
   * cazar los bucles cortos, que son los que marean, y no cuesta nada calcularlas
   * en el momento (la pista la pide una persona, no un bucle).
   */
  function historialReciente() {
    const huellas = new Set([advisor.huella(state)]);
    for (const paso of history.slice(-12)) huellas.add(advisor.huella(paso.state));
    return huellas;
  }

  /** Modalidad con la que se repartió: las preferencias pueden haber cambiado después. */
  function modo() {
    return {
      scoring: state?.scoring ?? prefs.scoring,
      drawCount: state?.drawCount ?? prefs.drawCount,
      timed: state?.timed ?? prefs.timed,
    };
  }

  function elapsed() {
    return elapsedMs + (running && startedAt != null ? now() - startedAt : 0);
  }

  function startClock() {
    if (running || status !== 'playing') return;
    running = true;
    startedAt = now();
  }

  function stopClock() {
    if (!running) return;
    elapsedMs += now() - startedAt;
    running = false;
    startedAt = null;
  }

  function currentScore() {
    const { scoring, timed } = modo();
    const seconds = Math.floor(elapsed() / 1000);
    let score = baseScore;
    if (timed) {
      score += timePenalty(scoring, seconds);
      if (status === 'won') score += winBonus(scoring, Math.max(1, seconds));
    }
    if (scoring !== 'vegas' && score < 0) score = 0;
    return score;
  }

  function checkEnd() {
    if (engine.isWon(state)) {
      status = 'won';
      stopClock();
      finish(true);
      return;
    }
    status = engine.isStuck(state) ? 'stuck' : 'playing';
    if (status === 'stuck') stopClock();
  }

  function finish(won) {
    if (recorded) return;
    recorded = true;
    const { scoring, drawCount, timed } = modo();
    lastResult = {
      scoring,
      drawCount,
      timed,
      score: currentScore(),
      won,
      timeMs: elapsed(),
      moves,
      undos,
      seed: state.seed,
      player: prefs.playerName || null,
      at: new Date().toISOString(),
    };
    store.recordGame(lastResult);
    store.clearGame();
  }

  /** Abandonar (o dejar una partida muerta) cuenta como derrota: si no, se reiniciaría hasta ganar sin coste. */
  function abandonIfInProgress() {
    if ((status === 'playing' || status === 'stuck') && moves > 0 && !recorded) {
      stopClock();
      finish(false);
    }
  }

  function commit(result) {
    selectionEpoch += 1;
    const { scoring, drawCount } = modo();
    baseScore = applyEvents(scoring, baseScore, result.events, { drawCount });
    state = result.state;
    moves += 1;
    startClock();
    checkEnd();
    persist();
    // Quien escuche (de momento, los sonidos) no puede tumbar una jugada.
    try { onEvents(result.events); } catch { /* el adorno nunca manda */ }
  }

  function persist() {
    if (status !== 'playing' && status !== 'stuck') return;
    store.saveGame({
      version: 1,
      state,
      baseScore,
      moves,
      undos,
      elapsedMs: elapsed(),
      prefs: { drawCount: state.drawCount, scoring: state.scoring, timed: state.timed },
      history: history.slice(-SAVED_HISTORY),
      savedAt: new Date().toISOString(),
    });
  }

  /**
   * JSON.stringify(Infinity) devuelve null, así que un estado leído de localStorage
   * puede volver sin el límite de reciclados. Se recalcula a partir de la modalidad.
   */
  function rehidratar(s) {
    const scoring = s.scoring ?? 'standard';
    const drawCount = s.drawCount === 3 ? 3 : 1;
    return {
      ...s,
      scoring,
      drawCount,
      recycles: Number.isFinite(s.recycles) ? s.recycles : 0,
      maxRecycles: engine.maxRecyclesFor(scoring, drawCount),
    };
  }

  const api = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    get prefs() { return { ...prefs }; },
    get state() { return state; },
    get status() { return status; },
    get moves() { return moves; },
    get undos() { return undos; },
    get score() { return currentScore(); },
    get baseScore() { return baseScore; },
    get elapsedMs() { return elapsed(); },
    get canUndo() { return history.length > 0; },
    /** ¿Está corriendo el reloj? La cabecera enseña un aviso cuando no. */
    get clockRunning() { return running; },
    /** Cuántas cartas hay ya arriba, de las 52. */
    get foundationCount() { return state ? state.foundations.reduce((n, p) => n + p.length, 0) : 0; },
    get lastResult() { return lastResult; },
    get seed() { return state?.seed ?? null; },
    get epoch() { return selectionEpoch; },
    /** Cambia cada vez que se reparte de cero (no al retomar una partida guardada). */
    get dealId() { return dealId; },
    /** Modalidad con la que se repartió, que es la que puntúa (no la preferencia actual). */
    get mode() { return modo(); },

    setPrefs(patch) {
      const changesDeal = ('drawCount' in patch && patch.drawCount !== prefs.drawCount)
        || ('scoring' in patch && patch.scoring !== prefs.scoring);
      prefs = store.setPrefs(patch);
      if (changesDeal) api.newGame();
      else emit();
      return api.prefs;
    },

    newGame(seed) {
      if (seed == null) seed = prefs.solvableOnly ? randomSolvableSeed(state?.seed) : randomSeed();
      abandonIfInProgress();
      state = engine.newGame({ seed, drawCount: prefs.drawCount, scoring: prefs.scoring });
      dealId += 1;
      state.timed = prefs.timed;         // la modalidad se fija al repartir, no al puntuar
      baseScore = initialScore(prefs.scoring);
      moves = 0;
      undos = 0;
      history = [];
      status = 'playing';
      startedAt = null;
      elapsedMs = 0;
      running = false;
      recorded = false;
      lastResult = null;
      selectionEpoch += 1;
      store.clearGame();
      emit();
      return api;
    },

    /** Vuelve a repartir exactamente las mismas cartas. */
    restart() {
      const seed = state?.seed ?? randomSeed();
      api.newGame(seed);
      return api;
    },

    /** Retoma la partida guardada. Devuelve true si la había y era válida. */
    resume() {
      const saved = store.loadGame();
      if (!saved || !saved.state || !Array.isArray(saved.state.tableau)) return false;
      const total = saved.state.stock.length + saved.state.waste.length
        + saved.state.foundations.flat().length + saved.state.tableau.flat().length;
      if (total !== 52) return false;

      state = rehidratar(saved.state);
      baseScore = Number.isFinite(saved.baseScore) ? saved.baseScore : 0;
      moves = saved.moves ?? 0;
      undos = saved.undos ?? 0;
      history = (Array.isArray(saved.history) ? saved.history : [])
        .filter((h) => h && h.state)
        .map((h) => ({ ...h, state: rehidratar(h.state) }));
      elapsedMs = saved.elapsedMs ?? 0;
      startedAt = null;
      running = false;
      recorded = false;
      lastResult = null;
      status = 'playing';
      // Se sincroniza solo lo que obliga a repartir de nuevo. `timed` no: el jugador
      // puede haberlo cambiado a propósito y la partida en curso ya lo lleva congelado.
      if (saved.prefs) {
        prefs = store.setPrefs({
          drawCount: state.drawCount,
          scoring: state.scoring,
        });
      }
      checkEnd();
      emit();
      return true;
    },

    play(move) {
      if (status !== 'playing' && status !== 'stuck') return false;
      const result = engine.applyMove(state, move);
      if (!result) return false;
      pushHistory();
      commit(result);
      if (prefs.autoSafe && status === 'playing') api.autoSafe({ silent: true });
      emit();
      return true;
    },

    draw() { return api.play({ type: 'draw' }); },

    /** Clic en el mazo: roba, y si está vacío recicla el descarte. */
    stockClick() {
      if (state.stock.length) return api.draw();
      return api.play({ type: 'recycle' });
    },

    /**
     * Doble clic: sube a su fundación la carta de arriba del descarte o de una columna.
     * Si se indica `cardId`, solo actúa si esa es justo la carta de arriba; así un doble
     * clic sobre una carta enterrada no mueve otra distinta.
     */
    sendToFoundation(from, cardId) {
      const pile = from?.pile === PILE.WASTE ? state.waste
        : from?.pile === PILE.TABLEAU ? state.tableau[from.index]
          : null;
      if (!pile) return false;
      const card = engine.top(pile);
      if (!card || !card.faceUp) return false;
      if (cardId && card.id !== cardId) return false;
      const index = SUITS.indexOf(card.suit);
      return api.play({ type: 'move', from, to: { pile: PILE.FOUNDATION, index }, count: 1 });
    },

    /** Sube todas las cartas que no hacen falta abajo. Devuelve cuántas movió. */
    autoSafe({ silent = false } = {}) {
      let count = 0;
      let progress = true;
      while (progress && status === 'playing') {
        progress = false;
        const sources = [{ pile: PILE.WASTE }, ...state.tableau.map((_, index) => ({ pile: PILE.TABLEAU, index }))];
        for (const from of sources) {
          const pileArr = from.pile === PILE.WASTE ? state.waste : state.tableau[from.index];
          const card = engine.top(pileArr);
          if (!card || !card.faceUp) continue;
          if (!engine.isSafeToFoundation(state, card)) continue;
          const index = SUITS.indexOf(card.suit);
          const move = { type: 'move', from, to: { pile: PILE.FOUNDATION, index }, count: 1 };
          const result = engine.applyMove(state, move);
          if (!result) continue;
          pushHistory();
          commit(result);
          count += 1;
          progress = true;
          break;
        }
      }
      if (count && !silent) emit();
      return count;
    },

    get canAutoComplete() { return status === 'playing' && engine.canAutoComplete(state); },

    /** Un paso del autocompletado, para poder animarlo desde la UI. */
    autoCompleteStep() {
      if (status !== 'playing') return false;
      const sources = [{ pile: PILE.WASTE }, ...state.tableau.map((_, index) => ({ pile: PILE.TABLEAU, index }))];
      let best = null;
      for (const from of sources) {
        const pileArr = from.pile === PILE.WASTE ? state.waste : state.tableau[from.index];
        const card = engine.top(pileArr);
        if (!card || !card.faceUp) continue;
        const index = SUITS.indexOf(card.suit);
        const move = { type: 'move', from, to: { pile: PILE.FOUNDATION, index }, count: 1 };
        if (!engine.isLegal(state, move)) continue;
        if (!best || card.rank < best.rank) best = { move, rank: card.rank };
      }
      if (!best) return false;
      return api.play(best.move);
    },

    undo() {
      if (!history.length || status === 'won') return false;
      const prev = history.pop();
      state = prev.state;
      baseScore = prev.baseScore;
      moves = prev.moves;
      undos += 1;
      selectionEpoch += 1;
      checkEnd();          // la posición anterior también puede estar muerta
      persist();
      emit();
      return true;
    },

    /**
     * La jugada recomendada, con su razón y las alternativas que la seguían de
     * cerca: { move, reason, alternatives } o null si de verdad no hay nada.
     */
    hint() {
      if (status !== 'playing' && status !== 'stuck') return null;
      return advisor.recomendar(state, { historial: historialReciente() });
    },

    /**
     * ¿Le queda al jugador el recurso de bajar a mano una carta de las
     * fundaciones? «Atascado» ya significa que ningún movimiento de las cartas
     * visibles —ni directos, ni tras paseos entre columnas— lleva a ningún sitio;
     * esto distingue «no hay salida» de «te queda bajar una carta de arriba».
     */
    get hasAnyMove() {
      if (status !== 'playing' && status !== 'stuck') return false;
      return engine.cardMoves(state, { includeFoundationToTableau: true })
        .some((m) => m.from.pile === PILE.FOUNDATION);
    },

    pause() { stopClock(); emit(); },
    resumeClock() { if (moves > 0) startClock(); emit(); },

    /** La UI llama a esto al salir de la página para no perder el tiempo jugado. */
    flush() { persist(); },
  };

  return api;
}
