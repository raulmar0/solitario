// Motor de Klondike. Funciones puras: applyMove() nunca muta el estado que recibe.
// Convención de pilas: el ÚLTIMO elemento del array es la carta de arriba.

import { SUITS, createDeck, mulberry32, shuffle, isRed } from './cards.js';

export const PILE = { STOCK: 'stock', WASTE: 'waste', FOUNDATION: 'foundation', TABLEAU: 'tableau' };

/** Recicles permitidos según modo. Standard: infinitos. Vegas: 1 pasada (draw 1) o 3 (draw 3). */
export function maxRecyclesFor(scoring, drawCount) {
  if (scoring !== 'vegas') return Infinity;
  return drawCount === 1 ? 0 : 2;
}

export function newGame({ seed, drawCount = 1, scoring = 'standard' } = {}) {
  if (drawCount !== 1 && drawCount !== 3) throw new Error(`drawCount inválido: ${drawCount}`);
  const rng = mulberry32(seed);
  const deck = shuffle(createDeck(), rng);

  const tableau = [[], [], [], [], [], [], []];
  // Reparto clásico por filas: 1,2,3,...,7 cartas; la última de cada columna boca arriba.
  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) {
      const card = deck.pop();
      tableau[col].push({ ...card, faceUp: col === row });
    }
  }

  return {
    seed,
    drawCount,
    scoring,
    stock: deck.map((c) => ({ ...c, faceUp: false })),
    waste: [],
    foundations: [[], [], [], []], // mismo orden que SUITS
    tableau,
    recycles: 0,
    maxRecycles: maxRecyclesFor(scoring, drawCount),
  };
}

export function cloneState(s) {
  return {
    ...s,
    stock: s.stock.map((c) => ({ ...c })),
    waste: s.waste.map((c) => ({ ...c })),
    foundations: s.foundations.map((p) => p.map((c) => ({ ...c }))),
    tableau: s.tableau.map((p) => p.map((c) => ({ ...c }))),
  };
}

export const top = (pile) => (pile.length ? pile[pile.length - 1] : null);
export const foundationIndex = (suit) => SUITS.indexOf(suit);

/** ¿Puede `card` apoyarse en `onto` dentro del tableau? Hueco vacío -> solo Rey. */
export function canStackTableau(card, onto) {
  if (!onto) return card.rank === 13;
  if (!onto.faceUp) return false;
  return onto.rank === card.rank + 1 && isRed(onto.suit) !== isRed(card.suit);
}

/** ¿Puede `card` subir a su fundación? As sobre vacío, luego mismo palo ascendente. */
export function canStackFoundation(card, foundation) {
  const t = top(foundation);
  if (!t) return card.rank === 1;
  return t.suit === card.suit && t.rank === card.rank - 1;
}

/** Cartas boca arriba de una columna que forman secuencia válida empezando en `from`. */
export function isValidRun(pile, from) {
  for (let i = from; i < pile.length; i++) {
    if (!pile[i].faceUp) return false;
    if (i > from && !canStackTableau(pile[i], pile[i - 1])) return false;
  }
  return true;
}

function pileOf(state, ref) {
  switch (ref.pile) {
    case PILE.WASTE: return state.waste;
    case PILE.STOCK: return state.stock;
    case PILE.FOUNDATION: return state.foundations[ref.index];
    case PILE.TABLEAU: return state.tableau[ref.index];
    default: return null;
  }
}

/** Cartas que se moverían con este movimiento, o null si el origen no es válido. */
function movingCards(state, move) {
  const src = pileOf(state, move.from);
  if (!src) return null;
  const count = move.count ?? 1;
  if (count < 1 || count > src.length) return null;

  if (move.from.pile === PILE.TABLEAU) {
    const start = src.length - count;
    if (!isValidRun(src, start)) return null;
    return src.slice(start);
  }
  // Del descarte y de las fundaciones solo se mueve la carta de arriba.
  if (count !== 1) return null;
  if (move.from.pile === PILE.STOCK) return null;
  return src.slice(-1);
}

export function isLegal(state, move) {
  if (!move) return false;

  if (move.type === 'draw') return state.stock.length > 0;

  if (move.type === 'recycle') {
    // JSON.stringify(Infinity) es null, así que un estado recuperado puede no traer el límite.
    const limite = state.maxRecycles ?? Infinity;
    return state.stock.length === 0 && state.waste.length > 0 && state.recycles < limite;
  }

  if (move.type !== 'move') return false;

  const cards = movingCards(state, move);
  if (!cards || !cards.length) return false;
  const head = cards[0];

  if (move.to.pile === PILE.FOUNDATION) {
    if (cards.length !== 1) return false;
    if (foundationIndex(head.suit) !== move.to.index) return false;
    return canStackFoundation(head, state.foundations[move.to.index]);
  }

  if (move.to.pile === PILE.TABLEAU) {
    const dest = state.tableau[move.to.index];
    if (!dest) return false;
    // Mover una columna entera a otro hueco vacío no aporta nada y provoca bucles.
    if (move.from.pile === PILE.TABLEAU && move.from.index === move.to.index) return false;
    return canStackTableau(head, top(dest));
  }

  return false;
}

/**
 * Aplica un movimiento. Devuelve { state, events } o null si es ilegal.
 * `events` alimenta al módulo de puntuación; el motor no sabe de puntos.
 */
export function applyMove(state, move) {
  if (!isLegal(state, move)) return null;
  const next = cloneState(state);
  const events = [];

  if (move.type === 'draw') {
    const n = Math.min(next.drawCount, next.stock.length);
    const taken = next.stock.splice(next.stock.length - n, n); // [más profunda ... arriba]
    taken.reverse(); // se reparten de una en una: la más profunda queda arriba del descarte
    for (const c of taken) next.waste.push({ ...c, faceUp: true });
    events.push({ type: 'draw', count: n });
    return { state: next, events };
  }

  if (move.type === 'recycle') {
    next.stock = next.waste.slice().reverse().map((c) => ({ ...c, faceUp: false }));
    next.waste = [];
    next.recycles += 1;
    events.push({ type: 'recycle', recycles: next.recycles });
    return { state: next, events };
  }

  const src = pileOf(next, move.from);
  const dest = pileOf(next, move.to);
  const count = move.count ?? 1;
  const moved = src.splice(src.length - count, count);
  for (const c of moved) dest.push({ ...c, faceUp: true });

  events.push({
    type: 'move',
    from: move.from.pile,
    to: move.to.pile,
    count,
    cards: moved.map((c) => c.id),
  });

  // Al descubrir una carta del tableau se le da la vuelta.
  if (move.from.pile === PILE.TABLEAU) {
    const exposed = top(src);
    if (exposed && !exposed.faceUp) {
      exposed.faceUp = true;
      events.push({ type: 'flip', card: exposed.id, column: move.from.index });
    }
  }

  return { state: next, events };
}

export function isWon(state) {
  return state.foundations.reduce((n, p) => n + p.length, 0) === 52;
}

/** Todo boca arriba y sin mazo: ya solo queda subir cartas, se puede automatizar. */
export function canAutoComplete(state) {
  if (isWon(state)) return false;
  if (state.stock.length || state.waste.length) return false;
  return state.tableau.every((p) => p.every((c) => c.faceUp));
}

/** Movimiento seguro a fundación: no hace falta para colocar cartas del color contrario. */
export function isSafeToFoundation(state, card) {
  if (card.rank <= 2) return true;
  const need = card.rank - 1;
  const others = SUITS.filter((s) => isRed(s) !== isRed(card.suit));
  return others.every((s) => (top(state.foundations[SUITS.indexOf(s)])?.rank ?? 0) >= need);
}

/** Todos los movimientos legales de carta (sin draw/recycle). */
export function cardMoves(state, { includeFoundationToTableau = true } = {}) {
  const moves = [];
  const pushToTargets = (from, cards) => {
    const head = cards[0];
    if (cards.length === 1) {
      const fi = foundationIndex(head.suit);
      if (canStackFoundation(head, state.foundations[fi])) {
        moves.push({ type: 'move', from, to: { pile: PILE.FOUNDATION, index: fi }, count: 1 });
      }
    }
    for (let i = 0; i < 7; i++) {
      if (from.pile === PILE.TABLEAU && from.index === i) continue;
      if (canStackTableau(head, top(state.tableau[i]))) {
        moves.push({ type: 'move', from, to: { pile: PILE.TABLEAU, index: i }, count: cards.length });
      }
    }
  };

  const w = top(state.waste);
  if (w) pushToTargets({ pile: PILE.WASTE }, [w]);

  state.tableau.forEach((pile, index) => {
    for (let i = 0; i < pile.length; i++) {
      if (!pile[i].faceUp) continue;
      if (!isValidRun(pile, i)) continue;
      pushToTargets({ pile: PILE.TABLEAU, index }, pile.slice(i));
    }
  });

  if (includeFoundationToTableau) {
    state.foundations.forEach((pile, index) => {
      const c = top(pile);
      if (!c) return;
      for (let i = 0; i < 7; i++) {
        if (canStackTableau(c, top(state.tableau[i]))) {
          moves.push({ type: 'move', from: { pile: PILE.FOUNDATION, index }, to: { pile: PILE.TABLEAU, index: i }, count: 1 });
        }
      }
    });
  }

  return moves;
}

export function legalMoves(state) {
  const moves = cardMoves(state);
  if (isLegal(state, { type: 'draw' })) moves.push({ type: 'draw' });
  if (isLegal(state, { type: 'recycle' })) moves.push({ type: 'recycle' });
  return moves;
}

/**
 * Jugadas que cambian algo de verdad. Se descarta pasar una columna entera a otro
 * hueco vacío (es reversible y no destapa nada) y, por omisión, bajar cartas de las
 * fundaciones: es legal y el jugador puede hacerlo a mano, pero como "jugada
 * disponible" llevaría a bucles infinitos.
 */
export function usefulMoves(state, { includeFoundationToTableau = false } = {}) {
  return cardMoves(state, { includeFoundationToTableau }).filter((m) => {
    if (m.to.pile !== PILE.TABLEAU || m.from.pile !== PILE.TABLEAU) return true;
    const src = state.tableau[m.from.index];
    return !(m.count === src.length && state.tableau[m.to.index].length === 0);
  });
}

/** Un movimiento útil para la pista, el que más adelante deje la partida. */
export function hint(state) {
  const moves = usefulMoves(state);

  const rank = (m) => {
    if (m.to.pile === PILE.FOUNDATION) return isSafeToFoundation(state, top(pileOf(state, m.from))) ? 0 : 2;
    if (m.from.pile === PILE.TABLEAU) {
      const src = state.tableau[m.from.index];
      const under = src[src.length - m.count - 1];
      if (under && !under.faceUp) return 1; // destapa una carta: lo mejor después de subir a fundación
    }
    if (m.from.pile === PILE.WASTE) return 3;
    return 4;
  };

  moves.sort((a, b) => rank(a) - rank(b));
  if (moves.length) return moves[0];
  if (isLegal(state, { type: 'draw' })) return { type: 'draw' };
  if (isLegal(state, { type: 'recycle' })) return { type: 'recycle' };
  return null;
}

/**
 * Sin jugadas que sirvan y sin poder robar. Es un aviso, no un final: bajar una carta
 * de las fundaciones sigue siendo legal y el controlador deja seguir jugando.
 */
export function isStuck(state) {
  if (isWon(state)) return false;
  if (state.stock.length || isLegal(state, { type: 'recycle' })) return false;
  return usefulMoves(state).length === 0;
}
