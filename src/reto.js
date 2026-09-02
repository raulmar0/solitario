// Reto diario: un reparto por día, el mismo para todo el mundo.
//
// La gracia es que la semilla salga del día y de nada más. Sin servidor, sin
// cuentas y sin ponerse de acuerdo: dos personas que abran el juego el mismo día
// —en la misma casa o en dos continentes— reparten las mismas 52 cartas y pueden
// comparar la puntuación. Por eso el día es el LOCAL de cada uno: quien juega
// junto a otro comparte calendario, que es el caso que importa.
//
// Módulo puro: no toca el DOM ni el almacén, solo hace cuentas con fechas.

import { SOLVABLE_SEEDS } from './solvable-seeds.js';

/** Cuántos días atrás se puede jugar. Un año de calendario da de sobra. */
export const DIAS_ATRAS = 365;

const dosCifras = (n) => String(n).padStart(2, '0');

/** 'AAAA-MM-DD' del día local de esa fecha (no del UTC, que cambia de día antes). */
export function claveDia(fecha = new Date()) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())}`;
}

/** ¿Es una clave de día bien formada y con una fecha que existe? */
export function esClaveValida(clave) {
  if (typeof clave !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(clave)) return false;
  const [a, m, d] = clave.split('-').map(Number);
  const fecha = new Date(a, m - 1, d);
  return fecha.getFullYear() === a && fecha.getMonth() === m - 1 && fecha.getDate() === d;
}

/** La fecha local que representa una clave, o null si no vale. */
export function fechaDeClave(clave) {
  if (!esClaveValida(clave)) return null;
  const [a, m, d] = clave.split('-').map(Number);
  return new Date(a, m - 1, d);
}

/**
 * La semilla del día: siempre una con solución comprobada.
 *
 * Se cuentan los días desde la época y se entra con ese número en la lista de
 * semillas resueltas (`SOLVABLE_SEEDS`). La lista es más larga que la ventana
 * jugable (365 días), así que dentro de un año ningún día repite reparto, y el
 * de cada fecha no cambia nunca: es lo que hace que dos personas se encuentren
 * con la misma mano el mismo día. La lista va barajada con una semilla fija,
 * de modo que dos fechas seguidas caen en repartos que no se parecen en nada.
 */
export function semillaDelDia(clave) {
  if (!esClaveValida(clave)) return null;
  const [a, m, d] = clave.split('-').map(Number);
  const dias = Math.floor(Date.UTC(a, m - 1, d) / 86400000);
  const i = ((dias % SOLVABLE_SEEDS.length) + SOLVABLE_SEEDS.length) % SOLVABLE_SEEDS.length;
  return SOLVABLE_SEEDS[i];
}

/** Días de diferencia entre dos claves (b − a), contando días naturales. */
export function distanciaDias(a, b) {
  const fa = fechaDeClave(a);
  const fb = fechaDeClave(b);
  if (!fa || !fb) return null;
  return Math.round((fb - fa) / 86400000);
}

/** ¿Ese día todavía no ha llegado? Del futuro no se reparte nada. */
export function esFuturo(clave, hoy = claveDia()) {
  return esClaveValida(clave) && clave > hoy;
}

/** ¿Queda dentro de la ventana jugable: ni del futuro ni de hace más de un año? */
export function esJugable(clave, hoy = claveDia()) {
  if (!esClaveValida(clave) || esFuturo(clave, hoy)) return false;
  const dias = distanciaDias(clave, hoy);
  return dias !== null && dias <= DIAS_ATRAS;
}

/**
 * La rejilla de un mes, semana a semana. Cada hueco es una clave de día o null
 * si cae fuera del mes: así el calendario se dibuja recorriendo y ya, sin contar
 * huecos por el camino.
 *
 * `primerDia` es el día que empieza la semana: 1 para el lunes (Europa, Latam)
 * y 0 para el domingo (EE. UU., Corea). Lo decide quien dibuja, que es quien
 * sabe en qué idioma está la interfaz.
 */
export function rejillaDelMes(anio, mes, primerDia = 1) {
  const primero = new Date(anio, mes, 1);
  const dias = new Date(anio, mes + 1, 0).getDate();
  const desfase = (primero.getDay() - primerDia + 7) % 7;
  const celdas = [];
  for (let i = 0; i < desfase; i++) celdas.push(null);
  for (let d = 1; d <= dias; d++) celdas.push(`${anio}-${dosCifras(mes + 1)}-${dosCifras(d)}`);
  while (celdas.length % 7) celdas.push(null);
  const semanas = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
  return semanas;
}

/**
 * Qué resultado se queda un día que se ha jugado más de una vez: gana la partida
 * ganada, y entre dos iguales la de más puntuación. Lo de siempre en un reto,
 * vaya: se guarda tu mejor intento, no el último.
 *
 * Las puntuaciones solo se comparan dentro de la misma modalidad. En Vegas son
 * dólares y rondan la decena; en estándar son centenares y nunca bajan de cero,
 * así que cualquier partida estándar le ganaría siempre a cualquiera de Vegas y
 * el calendario acabaría enseñando la de otra modalidad. Cuando no coinciden se
 * queda la última, que es la que el jugador acaba de hacer.
 */
const mismaModalidad = (a, b) => a.scoring === b.scoring && a.drawCount === b.drawCount;

export function mejorResultado(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  if (!!a.won !== !!b.won) return a.won ? a : b;
  if (!mismaModalidad(a, b)) return b;
  return (b.score ?? 0) > (a.score ?? 0) ? b : a;
}
