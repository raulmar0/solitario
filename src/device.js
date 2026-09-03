// Detección sencilla del tipo de dispositivo para mostrar instrucciones útiles.
// Se combina el ancho disponible con el puntero principal: un portátil táctil
// con ratón sigue recibiendo la ayuda de escritorio, mientras que una tableta
// recibe la de controles táctiles aunque esté en horizontal.

const ANCHO_MOVIL = 640;

/** ¿La interfaz se está usando como móvil/tableta o como escritorio? */
export function esMovil({
  width,
  matchMedia,
  navigator,
} = {}) {
  const entorno = globalThis.window ?? globalThis;
  const ancho = Number(width ?? entorno.innerWidth);
  const pantallaPequena = Number.isFinite(ancho) && ancho > 0 && ancho <= ANCHO_MOVIL;
  const punteroTactil = (matchMedia ?? entorno.matchMedia)?.('(pointer: coarse)')?.matches === true;
  const muchosToques = Number((navigator ?? entorno.navigator)?.maxTouchPoints) > 0;
  return pantallaPequena || punteroTactil || (muchosToques && ancho <= 900);
}
