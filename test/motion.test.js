// Quién decide si el juego se mueve, y cuánto dura un vuelo.
//
// `src/motion.js` es la única respuesta a «¿animamos o no?»: la preferencia del
// jugador manda, pero el sistema operativo puede vetarla. Como el módulo se
// carga también desde node (estas mismas pruebas) no puede dar por hecho que
// exista `matchMedia`, y eso es justo lo que más se rompe al tocarlo.
//
// En node no hay `matchMedia`, así que el sistema se falsea a mano y se devuelve
// a su sitio al terminar cada prueba: si una se dejara el doble puesto, las
// siguientes creerían que el sistema pide quietud y mentirían en verde.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VUELO_MIN,
  hayMovimiento,
  aplicarMovimiento,
  alCambiarMovimiento,
  duracionVuelo,
  alturaVuelo,
  giroVuelo,
} from '../src/motion.js';
import { VUELO_POR_DEFECTO } from '../src/ui.js';

const CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** Marca «aquí no había `matchMedia`», que no es lo mismo que valer undefined. */
const AUSENTE = Symbol('sin matchMedia');

/**
 * Un sistema operativo de mentira. Apunta con qué se le consulta y guarda los
 * oyentes para poder disparar el cambio de `prefers-reduced-motion` a mano.
 */
function sistemaFalso({ reduce = false } = {}) {
  const oyentes = [];
  const consultas = [];
  const mq = {
    get matches() { return reduce; },
    addEventListener(tipo, fn) { oyentes.push({ tipo, fn }); },
    removeEventListener(tipo, fn) {
      const i = oyentes.findIndex((o) => o.tipo === tipo && o.fn === fn);
      if (i >= 0) oyentes.splice(i, 1);
    },
  };
  return {
    consultas,
    oyentes,
    matchMedia: (q) => { consultas.push(q); return mq; },
    /** Simula que el jugador cambia el ajuste del sistema mientras juega. */
    cambiar(matches) {
      reduce = matches;
      for (const o of [...oyentes]) if (o.tipo === 'change') o.fn({ matches });
    },
  };
}

/**
 * Pone (o quita, con AUSENTE) el `matchMedia` global y programa su devolución
 * al acabar la prueba, pase lo que pase con las aserciones.
 */
function montarSistema(t, impl) {
  const habia = Object.hasOwn(globalThis, 'matchMedia');
  const previo = globalThis.matchMedia;
  if (impl === AUSENTE) delete globalThis.matchMedia;
  else globalThis.matchMedia = impl;
  t.after(() => {
    if (habia) globalThis.matchMedia = previo;
    else delete globalThis.matchMedia;
  });
}

/** Una raíz de mentira: a `motion.js` le basta con que tenga `dataset`. */
const raizFalsa = () => ({ dataset: {} });

// --- hayMovimiento ---------------------------------------------------------

test('quien apaga las animaciones en los ajustes se queda sin ellas, diga lo que diga el sistema', (t) => {
  const sistema = sistemaFalso({ reduce: false });
  montarSistema(t, sistema.matchMedia);

  assert.equal(hayMovimiento({ animations: false }), false);
  assert.equal(hayMovimiento({ animations: true }), true, 'y quien las deja puestas sí las tiene');
});

test('si el sistema pide menos movimiento se respeta aunque el juego lo tenga activado', (t) => {
  // Quien pide menos movimiento en el sistema operativo lo pide para todo: el
  // juego no es quién para llevarle la contraria.
  const sistema = sistemaFalso({ reduce: true });
  montarSistema(t, sistema.matchMedia);

  assert.equal(hayMovimiento({ animations: true }), false);
  assert.equal(hayMovimiento({}), false, 'ni siquiera por omisión');
  assert.deepEqual(sistema.consultas, ['(prefers-reduced-motion: reduce)', '(prefers-reduced-motion: reduce)'],
    'y se le pregunta exactamente por eso, no por otra media query');
});

test('sin matchMedia —en node— no revienta y manda la preferencia', (t) => {
  // El módulo se importa desde las pruebas, donde no hay ventana. Si diera por
  // hecho `matchMedia`, cualquier prueba que lo tocara moriría al cargar.
  montarSistema(t, AUSENTE);

  assert.equal(hayMovimiento({ animations: true }), true);
  assert.equal(hayMovimiento({ animations: false }), false);
});

test('sin preferencias guardadas se anima: el juego se estrena en movimiento', (t) => {
  montarSistema(t, AUSENTE);

  assert.equal(hayMovimiento(undefined), true, 'la primera partida, sin prefs todavía');
  assert.equal(hayMovimiento(null), true);
});

// --- aplicarMovimiento -----------------------------------------------------

test('el estado efectivo queda escrito en <html data-motion> para que lo lea el CSS', (t) => {
  // La hoja de estilos apaga todo con `html[data-motion="no"]`, así que este
  // atributo es el único puente entre la decisión y lo que se ve.
  montarSistema(t, AUSENTE);

  const conAnimacion = raizFalsa();
  assert.equal(aplicarMovimiento({ animations: true }, conAnimacion), true, 'devuelve el booleano, no la cadena');
  assert.equal(conAnimacion.dataset.motion, 'si');

  const quieta = raizFalsa();
  assert.equal(aplicarMovimiento({ animations: false }, quieta), false);
  assert.equal(quieta.dataset.motion, 'no');

  assert.deepEqual(Object.keys(quieta.dataset), ['motion'], 'y no toca nada más de la raíz');
});

test('el veto del sistema también se escribe en la raíz', (t) => {
  const sistema = sistemaFalso({ reduce: true });
  montarSistema(t, sistema.matchMedia);

  const raiz = raizFalsa();
  assert.equal(aplicarMovimiento({ animations: true }, raiz), false);
  assert.equal(raiz.dataset.motion, 'no', 'aunque el jugador las tenga activadas');
});

test('sin raíz donde escribir se responde igual en vez de romperse', (t) => {
  // Pasa al arrancar antes de que exista el documento, y en node.
  montarSistema(t, AUSENTE);

  assert.equal(aplicarMovimiento({ animations: true }, null), true);
  assert.equal(aplicarMovimiento({ animations: false }, null), false);
  assert.equal(aplicarMovimiento({ animations: true }), true, 'y sin document, con la raíz por omisión');
});

// --- alCambiarMovimiento ---------------------------------------------------

test('cambiar el ajuste del sistema a media partida avisa, y darse de baja lo calla', (t) => {
  const sistema = sistemaFalso({ reduce: false });
  montarSistema(t, sistema.matchMedia);

  const avisos = [];
  const baja = alCambiarMovimiento((hay) => avisos.push(hay));
  assert.equal(sistema.oyentes.length, 1, 'se suscribe una sola vez');
  assert.equal(sistema.oyentes[0].tipo, 'change');

  sistema.cambiar(true);
  sistema.cambiar(false);
  // Avisa con «¿hay movimiento?», no con «¿se pide quietud?»: es el sentido que
  // espera quien lo escucha para volver a aplicar las preferencias.
  assert.deepEqual(avisos, [false, true]);

  baja();
  assert.equal(sistema.oyentes.length, 0, 'la baja suelta el oyente');
  sistema.cambiar(true);
  assert.deepEqual(avisos, [false, true], 'y ya no llegan más avisos');
});

test('sin matchMedia la baja se devuelve igual y se puede llamar sin miedo', (t) => {
  // Quien se suscribe no debería tener que preguntar si había a qué darse.
  montarSistema(t, AUSENTE);

  let llamadas = 0;
  const baja = alCambiarMovimiento(() => { llamadas += 1; });
  assert.equal(typeof baja, 'function');
  assert.doesNotThrow(() => baja());
  assert.doesNotThrow(() => baja(), 'y dos veces tampoco');
  assert.equal(llamadas, 0);
});

test('suscribir algo que no es una función no deja basura enganchada', (t) => {
  const sistema = sistemaFalso();
  montarSistema(t, sistema.matchMedia);

  assert.doesNotThrow(() => alCambiarMovimiento(undefined)());
  assert.doesNotThrow(() => alCambiarMovimiento('pista')());
  assert.equal(sistema.oyentes.length, 0);
});

// --- duracionVuelo ---------------------------------------------------------

test('ajustarse un pelo dura el mínimo y cruzar el tablero dura el máximo', () => {
  // Por debajo de VUELO_MIN un vuelo no se lee, solo parpadea; pasada la
  // distancia de saturación alargarlo más solo haría esperar.
  assert.equal(duracionVuelo(0), VUELO_MIN);
  assert.equal(duracionVuelo(0), 180);
  assert.equal(duracionVuelo(700, 320), 320, 'la distancia de saturación ya vale el máximo');
  assert.equal(duracionVuelo(4000, 320), 320, 'y más lejos no alarga: satura, no sigue creciendo');
  assert.equal(duracionVuelo(350, 320), 250, 'a media distancia, medio camino entre los dos');
});

test('cuanto más lejos va la carta, más tarda: nunca al revés', () => {
  let previa = duracionVuelo(0);
  for (let d = 0; d <= 900; d += 25) {
    const actual = duracionVuelo(d);
    assert.ok(actual >= previa, `de ${d - 25}px a ${d}px la duración bajó (${previa} → ${actual})`);
    assert.ok(actual >= VUELO_MIN && actual <= 320, `${d}px se sale del rango: ${actual}`);
    previa = actual;
  }
});

test('un techo por debajo del mínimo manda: si el vuelo ha de ser corto, es corto', () => {
  // El techo sale de la hoja de estilos; si alguien la baja a mano, el juego
  // obedece en vez de imponer sus 180 ms.
  assert.equal(duracionVuelo(0, 120), 120);
  assert.equal(duracionVuelo(700, 120), 120, 'sin interpolar nada, no hay hueco donde hacerlo');
  assert.equal(duracionVuelo(350, VUELO_MIN), VUELO_MIN, 'y con el techo justo en el mínimo, tampoco');
  assert.equal(duracionVuelo(350, 0), 0, 'un techo de cero apaga el vuelo, no lo estira al mínimo');
});

test('una distancia sin sentido no descuadra el vuelo: cae al mínimo', () => {
  // `Math.hypot` sobre medidas aún sin calcular puede dar NaN, y una resta de
  // coordenadas invertidas, un negativo. Ninguno de los dos debe dar NaN ms.
  assert.equal(duracionVuelo(-500), VUELO_MIN);
  assert.equal(duracionVuelo(NaN), VUELO_MIN);
  assert.equal(duracionVuelo(undefined), VUELO_MIN);
  assert.equal(duracionVuelo(), VUELO_MIN, 'ni llamarla sin distancia');
});

test('la duración siempre es un entero de milisegundos', () => {
  // Va derecha a `setTimeout` y a `style.transitionDuration`: un decimal no
  // rompe, pero ensucia el DOM y hace ilegibles las comparaciones.
  for (const [dist, max] of [[0, 320], [123, 320], [350, 325], [699, 324], [700, 324], [-1, 320], [NaN, 320], [10, 120.6]]) {
    const ms = duracionVuelo(dist, max);
    assert.ok(Number.isInteger(ms), `duracionVuelo(${dist}, ${max}) = ${ms} no es entero`);
  }
});

// --- JS y CSS, la misma cifra ---------------------------------------------

test('la reserva del JS y el techo de la hoja de estilos no se descuelgan', () => {
  // `ui.js` lee `--card-speed` del CSS y se lo pasa a `duracionVuelo` como
  // techo; `VUELO_POR_DEFECTO` es lo que usa si el navegador no sabe resolver
  // la variable. Si las dos cifras se separan, la misma carta volaría distinto
  // según el navegador.
  const enCss = parseFloat(/--card-speed:\s*([\d.]+)ms/.exec(CSS)[1]);
  assert.equal(VUELO_POR_DEFECTO, enCss, '--card-speed y la reserva del JS son la misma cifra');

  assert.equal(VUELO_MIN, 180, 'el suelo del vuelo, el que da por bueno el contrato');
  assert.ok(enCss > VUELO_MIN, 'y el techo queda por encima, así que hay recorrido que interpolar');

  assert.equal(duracionVuelo(0, enCss), VUELO_MIN, 'el ajuste más corto con el techo de verdad');
  assert.equal(duracionVuelo(9999, enCss), Math.round(enCss), 'y el vuelo más largo se queda en el techo');
});

test('la altura del vuelo crece con la distancia, entre 5 y 14 px', () => {
  assert.equal(alturaVuelo(0), 5);
  assert.equal(alturaVuelo(700), 14);
  assert.equal(alturaVuelo(4000), 14, 'satura igual que la duración');
  assert.ok(alturaVuelo(350) > alturaVuelo(80));
  assert.equal(alturaVuelo(-10), 5);
  assert.equal(alturaVuelo(NaN), 5);
});

test('el ladeo mira hacia donde va la carta y no se pasa de 3.2°', () => {
  assert.equal(giroVuelo(0), 0);
  assert.equal(giroVuelo(NaN), 0);
  assert.ok(giroVuelo(400) > 0);
  assert.ok(giroVuelo(-400) < 0);
  assert.equal(giroVuelo(400), -giroVuelo(-400));
  assert.equal(giroVuelo(4000), 3.2);
  assert.equal(giroVuelo(-4000), -3.2);
});
