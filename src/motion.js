// Estado efectivo de movimiento: una sola respuesta a «¿animamos o no?».
// Manda la preferencia del jugador, pero el sistema puede vetarla: quien pide
// menos movimiento en el sistema operativo lo pide para todo, y el juego no es
// quién para llevarle la contraria.
//
// El módulo se usa también desde node (pruebas, sin ventana), así que ninguna
// llamada da por hecho que exista `matchMedia`.

export const VUELO_MIN = 180;   // por debajo de esto un vuelo ya no se lee, solo parpadea
const TOPE = 700;               // a partir de esta distancia en px el vuelo ya no se alarga más

const MENOS_MOVIMIENTO = '(prefers-reduced-motion: reduce)';

/** La consulta del sistema, o null donde no haya `matchMedia` (node). */
const consulta = () => globalThis.matchMedia?.(MENOS_MOVIMIENTO) ?? null;

/** ¿Hay movimiento? La preferencia manda, y el sistema puede vetarla. */
export function hayMovimiento(prefs) {
  return prefs?.animations !== false && consulta()?.matches !== true;
}

/** Refleja el estado efectivo en <html data-motion="si|no">. Devuelve el booleano. */
export function aplicarMovimiento(prefs, raiz = globalThis.document?.documentElement) {
  const hay = hayMovimiento(prefs);
  if (raiz) raiz.dataset.motion = hay ? 'si' : 'no';
  return hay;
}

/** Avisa con el estado del sistema cuando cambia `prefers-reduced-motion`.
 *  Devuelve la baja, que siempre se puede llamar aunque no hubiera a qué darse. */
export function alCambiarMovimiento(fn) {
  const mq = consulta();
  if (!mq || typeof fn !== 'function') return () => {};
  const alCambiar = (ev) => fn(!ev.matches);
  mq.addEventListener('change', alCambiar);
  return () => mq.removeEventListener('change', alCambiar);
}

/** Cuánto tarda un vuelo según lo lejos que va: cruzar el tablero no es
 *  ajustarse un pelo. Crece con la distancia entre VUELO_MIN y `max`. */
export function duracionVuelo(dist, max = 320) {
  if (!(max > VUELO_MIN)) return Math.round(max);
  const t = dist > 0 ? Math.min(1, dist / TOPE) : 0;   // NaN y negativos caen al mínimo
  return Math.round(VUELO_MIN + (max - VUELO_MIN) * t);
}
