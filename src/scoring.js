// Puntuación. El motor emite eventos; aquí se traducen a puntos.
// Dos sistemas clásicos: "estándar" (tipo Microsoft Solitaire) y "Vegas".

export const SCORING_MODES = ['standard', 'vegas'];

export const MODE_LABEL = { standard: 'Estándar', vegas: 'Vegas' };

const STANDARD = {
  initialScore: 0,
  clampAtZero: true,
  delta(event, ctx) {
    if (event.type === 'flip') return 5;
    if (event.type === 'recycle') {
      if (ctx.drawCount === 1) return -100;
      // Robando de 3 en 3 solo se penaliza a partir de la cuarta pasada.
      return event.recycles >= 3 ? -20 : 0;
    }
    if (event.type !== 'move') return 0;
    if (event.to === 'foundation') return 10;         // desde descarte o tableau
    if (event.from === 'foundation' && event.to === 'tableau') return -15;
    if (event.from === 'waste' && event.to === 'tableau') return 5;
    return 0;                                          // tableau -> tableau no puntúa
  },
  // Partida cronometrada: -2 puntos por cada 10 segundos completos.
  timePenalty(seconds) {
    const tramos = Math.floor(seconds / 10);
    return tramos ? -2 * tramos : 0;    // sin el ternario saldría -0
  },
  winBonus(seconds) {
    if (seconds < 30) return 0;
    return Math.floor(700000 / seconds);
  },
  hintPenalty: -10,
};

const VEGAS = {
  initialScore: -52,        // 52 $ de entrada, 1 $ por carta
  clampAtZero: false,
  delta(event) {
    if (event.type !== 'move') return 0;
    if (event.to === 'foundation') return 5;
    if (event.from === 'foundation' && event.to === 'tableau') return -5;
    return 0;
  },
  timePenalty() { return 0; },
  winBonus() { return 0; },
  hintPenalty: -5,
};

const MODES = { standard: STANDARD, vegas: VEGAS };

export function getMode(name) {
  const mode = MODES[name];
  if (!mode) throw new Error(`Modo de puntuación desconocido: ${name}`);
  return mode;
}

export function initialScore(name) {
  return getMode(name).initialScore;
}

/** Suma los puntos de una tanda de eventos sobre `score`. */
export function applyEvents(name, score, events, ctx = {}) {
  const mode = getMode(name);
  let next = score;
  for (const event of events) next += mode.delta(event, ctx);
  if (mode.clampAtZero && next < 0) next = 0;
  return next;
}

export function timePenalty(name, seconds) {
  return getMode(name).timePenalty(seconds);
}

export function winBonus(name, seconds) {
  return getMode(name).winBonus(seconds);
}

export function hintPenalty(name) {
  return getMode(name).hintPenalty;
}

export function formatScore(name, score) {
  return name === 'vegas'
    ? `${score < 0 ? '−' : '+'}${Math.abs(score)} $`
    : String(score);
}
