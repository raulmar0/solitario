// Baraja, aleatoriedad reproducible y utilidades de carta.
// Sin dependencias: se usa igual en el navegador y en node:test.

export const SUITS = ['S', 'H', 'D', 'C'];               // picas, corazones, diamantes, tréboles
export const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME = { S: 'picas', H: 'corazones', D: 'diamantes', C: 'tréboles' };
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
export const RANK_LABEL = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
};

export const isRed = (suit) => suit === 'H' || suit === 'D';
export const color = (suit) => (isRed(suit) ? 'red' : 'black');
export const cardId = (rank, suit) => `${RANK_LABEL[rank]}${suit}`;
export const cardLabel = (card) => `${RANK_LABEL[card.rank]}${SUIT_GLYPH[card.suit]}`;

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: cardId(rank, suit), rank, suit, faceUp: false });
    }
  }
  return deck;
}

// mulberry32: PRNG de 32 bits, determinista. Misma semilla -> mismo reparto.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates. Devuelve un array nuevo, no toca el original.
export function shuffle(deck, rng) {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomSeed() {
  return Math.floor(Math.random() * 1_000_000) + 1;
}
