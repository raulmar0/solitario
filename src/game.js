// Controlador: une motor, puntuación, cronómetro y almacenamiento.
// No toca el DOM; la UI se suscribe con subscribe().

import * as engine from './engine.js';
import { PILE } from './engine.js';
import * as advisor from './advisor.js';
import { randomSeed, SUITS } from './cards.js';
import { randomSolvableSeed } from './solvable-seeds.js';
import { applyEvents, initialScore, timePenalty, winBonus, hintPenalty } from './scoring.js';

const MAX_HISTORY = 400;      // tope de deshacer en memoria
const SAVED_HISTORY = 25;     // cuántos pasos se guardan en localStorage
const RECUERDO = 60;          // cuántas posiciones recuerda la pista para no dar vueltas

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
  let hints = 0;
  let lastHintEpoch = -1;
  let history = [];
  let status = 'idle';        // idle | playing | won | stuck
  let startedAt = null;       // instante del primer movimiento
  let elapsedMs = 0;          // tiempo acumulado antes de la pausa actual
  let running = false;
  let recorded = false;
  let lastResult = null;
  let selectionEpoch = 0;      // sube con cada cambio de estado: sirve para invalidar cachés de la interfaz
  let dealId = 0;              // sube solo al repartir de nuevo: la interfaz lo usa para animar el reparto
  let dia = null;              // 'AAAA-MM-DD' si esta mano es la del reto diario
  let autoPasosSinProgreso = 0;

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
   * proponer deshacer a mano lo que se acaba de hacer.
   *
   * Son sesenta y no doce porque hay dos bucles que cazar, y el largo no cabía
   * en doce: dar la vuelta entera al mazo son veinticinco jugadas robando de una
   * (veinticuatro robos y el reciclado), y al llegar otra vez al mismo sitio la
   * pista volvía a mandar robar, indefinidamente. Calcularlas no cuesta nada: la
   * pista la pide una persona, no un bucle.
   */
  function historialReciente() {
    const huellas = new Set([advisor.huella(state)]);
    for (const paso of history.slice(-RECUERDO)) huellas.add(advisor.huella(paso.state));
    return huellas;
  }

  /** Modalidad con la que se repartió: las preferencias pueden haber cambiado después. */
  function modo() {
    const base = {
      scoring: state?.scoring ?? prefs.scoring,
      drawCount: state?.drawCount ?? prefs.drawCount,
      timed: state?.timed ?? prefs.timed,
    };
    if (state?.penalizeHints ?? prefs.penalizeHints) {
      base.penalizeHints = true;
    }
    return base;
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
    const penalizeHints = api.penalizeHints;
    const seconds = Math.floor(elapsed() / 1000);
    let score = baseScore;
    if (penalizeHints) {
      score += hints * hintPenalty(scoring);
    }
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
    const { scoring, drawCount, timed, penalizeHints } = modo();
    lastResult = {
      scoring,
      drawCount,
      timed,
      penalizeHints,
      hints,
      score: currentScore(),
      won,
      timeMs: elapsed(),
      moves,
      undos,
      seed: state.seed,
      dia,
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
      hints,
      dia,
      elapsedMs: elapsed(),
      prefs: { drawCount: state.drawCount, scoring: state.scoring, timed: state.timed, penalizeHints: state.penalizeHints },
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
      penalizeHints: !!s.penalizeHints,
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
    get hints() { return hints; },
    get penalizeHints() { return modo().penalizeHints; },
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
    /** El día del reto si esta mano es la de un reto diario; null si es una normal. */
    get dia() { return dia; },
    get epoch() { return selectionEpoch; },
    /** Cambia cada vez que se reparte de cero (no al retomar una partida guardada). */
    get dealId() { return dealId; },
    /** Modalidad con la que se repartió, que es la que puntúa (no la preferencia actual). */
    get mode() { return modo(); },

    setPrefs(patch) {
      const changesDeal = ('drawCount' in patch && patch.drawCount !== prefs.drawCount)
        || ('scoring' in patch && patch.scoring !== prefs.scoring);
      prefs = store.setPrefs(patch);
      // Cambiar de modalidad reparte de nuevo, pero si lo que se está jugando es
      // el reto del día se reparte OTRA VEZ EL DEL DÍA: son las mismas cartas
      // con otras reglas, no un reparto cualquiera. Sortear una mano al azar aquí
      // sacaba del reto sin decir nada.
      if (changesDeal) api.newGame(dia ? state?.seed : null, { dia });
      else emit();
      return api.prefs;
    },

    /**
     * Reparte. `opts.dia` marca la mano como la del reto diario de esa fecha: se
     * guarda con el resultado para que el calendario sepa qué se jugó y cuándo.
     * Sin él, la partida es una normal y corriente.
     */
    newGame(seed, { dia: diaReto = null } = {}) {
      if (seed == null) seed = prefs.solvableOnly ? randomSolvableSeed(state?.seed) : randomSeed();
      abandonIfInProgress();
      dia = diaReto;
      state = engine.newGame({ seed, drawCount: prefs.drawCount, scoring: prefs.scoring });
      dealId += 1;
      state.timed = prefs.timed;         // la modalidad se fija al repartir, no al puntuar
      state.penalizeHints = !!prefs.penalizeHints;
      baseScore = initialScore(prefs.scoring);
      moves = 0;
      undos = 0;
      hints = 0;
      lastHintEpoch = -1;
      autoPasosSinProgreso = 0;
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

    /** Vuelve a repartir exactamente las mismas cartas; el reto sigue siendo el mismo. */
    restart() {
      const seed = state?.seed ?? randomSeed();
      api.newGame(seed, { dia });
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
      hints = saved.hints ?? 0;
      lastHintEpoch = -1;
      dia = typeof saved.dia === 'string' ? saved.dia : null;
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

      // 1. Subir la mejor carta posible a fundación (de descarte o de cualquier columna del tableau)
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
      if (best) {
        autoPasosSinProgreso = 0;
        return api.play(best.move);
      }

      // 2. Si ninguna sube a fundación, colocar la del descarte en el tableau si cabe
      const w = engine.top(state.waste);
      if (w) {
        for (let i = 0; i < 7; i++) {
          const move = { type: 'move', from: { pile: PILE.WASTE }, to: { pile: PILE.TABLEAU, index: i }, count: 1 };
          if (engine.isLegal(state, move)) {
            autoPasosSinProgreso = 0;
            return api.play(move);
          }
        }
      }

      // 3. Robar del mazo si quedan cartas
      if (engine.isLegal(state, { type: 'draw' })) {
        autoPasosSinProgreso++;
        const max = state.stock.length + state.waste.length + 4;
        if (autoPasosSinProgreso > max) return false;
        return api.play({ type: 'draw' });
      }

      // 4. Si el mazo se vació pero hay descarte, reciclar
      if (engine.isLegal(state, { type: 'recycle' })) {
        autoPasosSinProgreso++;
        const max = state.waste.length + 4;
        if (autoPasosSinProgreso > max) return false;
        return api.play({ type: 'recycle' });
      }

      return false;
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

    hint() {
      if (status !== 'playing' && status !== 'stuck') return null;
      const rec = advisor.recomendar(state, { historial: historialReciente() });
      if (rec && modo().penalizeHints) {
        if (lastHintEpoch !== selectionEpoch) {
          lastHintEpoch = selectionEpoch;
          hints += 1;
          persist();
          emit();
        }
      }
      return rec;
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
