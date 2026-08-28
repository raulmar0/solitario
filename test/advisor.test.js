// El recomendador (src/advisor.js): qué jugada sugiere, por qué y en qué orden.
// Aquí viven las pruebas de pista que antes estaban en engine.test.js, adaptadas
// a la API nueva: engine.hint() ya no existe y recomendar() devuelve un objeto
// con la razón y las alternativas, no un movimiento suelto.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/engine.js';
import { PILE } from '../src/engine.js';
import { cardId } from '../src/cards.js';
import { SOLVABLE_SEEDS } from '../src/solvable-seeds.js';
import { RAZON, huella, mejorDestinoPara, recomendar } from '../src/advisor.js';

const C = (rank, suit) => ({ id: cardId(rank, suit), rank, suit, faceUp: true });
const X = (rank, suit) => ({ id: cardId(rank, suit), rank, suit, faceUp: false });
const F = (index) => ({ pile: PILE.FOUNDATION, index });
const T = (index) => ({ pile: PILE.TABLEAU, index });
const W = { pile: PILE.WASTE };

/**
 * Estados mínimos: solo las cartas del caso, sin completar las 52. El
 * recomendador es puro y no cuenta cartas, así que un tablero recortado deja el
 * escenario a la vista en cuatro líneas en vez de en cuarenta.
 * Las fundaciones van en el orden de SUITS: 0 picas, 1 corazones, 2 diamantes, 3 tréboles.
 */
function escenario({
  tableau = [], foundations = [], waste = [], stock = [],
  drawCount = 1, scoring = 'standard', recycles = 0, maxRecycles,
} = {}) {
  return {
    seed: 1,
    drawCount,
    scoring,
    stock,
    waste,
    foundations: Array.from({ length: 4 }, (_, i) => foundations[i] ?? []),
    tableau: Array.from({ length: 7 }, (_, i) => tableau[i] ?? []),
    recycles,
    maxRecycles: maxRecycles ?? engine.maxRecyclesFor(scoring, drawCount),
  };
}

/** Las picas ya subidas hasta `n`, para montar fundaciones a media altura. */
const picasHasta = (n) => Array.from({ length: n }, (_, i) => C(i + 1, 'S'));

const mismoMovimiento = (a, b) => a.type === b.type
  && (a.from?.pile ?? null) === (b.from?.pile ?? null)
  && (a.from?.index ?? null) === (b.from?.index ?? null)
  && (a.to?.pile ?? null) === (b.to?.pile ?? null)
  && (a.to?.index ?? null) === (b.to?.index ?? null)
  && (a.count ?? 1) === (b.count ?? 1);

/** El historial que le pasa game.js: el estado actual más los doce anteriores. */
const memoria = (actual, anteriores) => new Set([huella(actual), ...anteriores.slice(-12)]);

// --- orden de preferencia ---

test('destapar una carta gana a cualquier otra jugada comparable', () => {
  // Tres jugadas legales a la vez: destapar el 7C, sacar el 4D del descarte y
  // robar. Solo la primera reduce las cartas boca abajo, y ese es el criterio.
  const s = escenario({
    tableau: [[X(7, 'C'), C(5, 'H')], [C(6, 'S')], [C(5, 'S')]],
    waste: [C(4, 'D')],
    stock: [X(9, 'C')],
  });

  const r = recomendar(s);
  assert.equal(r.reason, RAZON.DESTAPAR);
  assert.ok(mismoMovimiento(r.move, { type: 'move', from: T(0), to: T(1), count: 1 }),
    'el 5H se apoya en el 6S y deja el 7C a la vista');
  assert.ok(r.alternatives.every((a) => a.reason !== RAZON.DESTAPAR),
    'la principal no se repite entre las alternativas');
});

test('las alternativas vienen de mejor a peor y sin repetir la principal', () => {
  // Cuatro razones distintas sobre la mesa a la vez: destapar, subir seguro,
  // sacar del descarte y robar. Es el orden de preferencia del contrato, leído
  // de arriba abajo en la lista que se devuelve.
  const s = escenario({
    tableau: [[X(7, 'C'), C(5, 'H')], [C(6, 'S')], [C(5, 'S')], [C(2, 'H')]],
    foundations: [[], [C(1, 'H')], [], []],
    waste: [C(4, 'D')],
    stock: [X(9, 'C')],
  });

  const r = recomendar(s);
  assert.deepEqual(
    [r.reason, ...r.alternatives.map((a) => a.reason)],
    [RAZON.DESTAPAR, RAZON.FUNDACION_SEGURA, RAZON.DESCARTE, RAZON.ROBAR],
  );

  const puntos = r.alternatives.map((a) => a.score);
  assert.deepEqual(puntos, puntos.slice().sort((a, b) => b - a), 'las alternativas van ordenadas');
  assert.ok(r.score >= puntos[0], 'ninguna alternativa puntúa más que la principal');
  assert.ok(r.alternatives.every((a) => !mismoMovimiento(a.move, r.move)),
    'la jugada principal no aparece otra vez entre las alternativas');
});

test('subir a fundación arriesgando pierde contra cualquier alternativa segura', () => {
  // El 9S cabe en su fundación, pero abajo quedan rojas que lo necesitarán. Con
  // el 10H a mano, quedarse en las columnas es preferible aunque no destape nada.
  const s = escenario({
    foundations: [picasHasta(8)],
    tableau: [[C(9, 'S')], [C(10, 'H')]],
  });

  const r = recomendar(s);
  assert.ok(mismoMovimiento(r.move, { type: 'move', from: T(0), to: T(1), count: 1 }),
    'el 9S se queda abajo, sobre el 10H');
  assert.notEqual(r.reason, RAZON.FUNDACION_RIESGO);

  const riesgo = r.alternatives.find((a) => a.reason === RAZON.FUNDACION_RIESGO);
  assert.ok(riesgo, 'la subida arriesgada sigue ofreciéndose, pero de segunda');
  assert.ok(riesgo.score < r.score);
});

test('sin nada más sobre la mesa sí se ofrece la subida arriesgada', () => {
  const s = escenario({ foundations: [picasHasta(8)], tableau: [[C(9, 'S')]] });

  const r = recomendar(s);
  assert.equal(r.reason, RAZON.FUNDACION_RIESGO, 'no queda otra: arriba');
  assert.deepEqual(r.move.to, F(0));
  assert.deepEqual(r.alternatives, []);
});

test('dejar libre la primera columna se reconoce como tal y vale más que robar', () => {
  // Ninguna columna vacía todavía: llevarse el 9S deja el primer hueco, que es
  // por donde entra el KD y con él la carta que tiene tapada debajo.
  const s = escenario({
    tableau: [
      [C(9, 'S')], [C(10, 'H')], [X(4, 'C'), C(13, 'D')],
      [C(7, 'D')], [C(7, 'C')], [C(4, 'D')], [C(4, 'H')],
    ],
    stock: [X(9, 'C')],
  });

  const r = recomendar(s);
  assert.equal(r.reason, RAZON.VACIAR_COLUMNA);
  assert.ok(mismoMovimiento(r.move, { type: 'move', from: T(0), to: T(1), count: 1 }));
  assert.ok(r.alternatives.every((a) => a.reason !== RAZON.VACIAR_COLUMNA));
});

test('gastar un hueco vacío se penaliza frente a destapar apoyándose en una carta', () => {
  // Las dos jugadas destapan una carta. La del rey además consume la única
  // columna libre, y ese hueco vale más guardado que gastado.
  const s = escenario({
    tableau: [[X(2, 'C'), C(13, 'S')], [X(3, 'C'), C(5, 'H')], [C(6, 'S')], [C(7, 'D')], [C(7, 'C')], [C(4, 'D')]],
  });

  const r = recomendar(s);
  assert.equal(r.reason, RAZON.DESTAPAR);
  assert.ok(mismoMovimiento(r.move, { type: 'move', from: T(1), to: T(2), count: 1 }),
    'primero el 5H sobre el 6S; el rey y su hueco pueden esperar');

  const rey = r.alternatives.find((a) => a.move.from?.index === 0);
  assert.ok(rey, 'mover el rey al hueco sigue siendo una alternativa');
  assert.ok(rey.score < r.score, 'pero puntúa menos por ocupar la columna libre');
});

// --- robar y reciclar antes que marear cartas ---

test('con mazo por robar, robar gana a pasear cartas entre columnas sin provecho', () => {
  // Mover el 9S sobre el 10H es legal, reversible y no lleva a ningún sitio: es
  // el bucle clásico de las pistas tontas. Con mazo, robar enseña algo nuevo.
  const s = escenario({
    tableau: [[C(10, 'H')], [C(9, 'S')]],
    stock: [X(2, 'D'), X(7, 'C')],
  });

  const r = recomendar(s);
  assert.deepEqual(r.move, { type: 'draw' });
  assert.equal(r.reason, RAZON.ROBAR);
  assert.deepEqual(r.alternatives, [], 'el paseo estéril ni siquiera se ofrece de segundas');
});

test('sin mazo pero con descarte de sobra, reciclar gana al paseo estéril', () => {
  const s = escenario({
    tableau: [[C(10, 'H')], [C(9, 'S')]],
    waste: [C(4, 'D'), C(7, 'C'), C(2, 'S')],
  });

  const r = recomendar(s);
  assert.deepEqual(r.move, { type: 'recycle' });
  assert.equal(r.reason, RAZON.RECICLAR);
  assert.deepEqual(r.alternatives, []);
});

test('un descarte que cabe en un solo robo no se recicla: sería dar vueltas sobre uno mismo', () => {
  // Reciclar una carta y volver a robarla deja el tablero exactamente igual.
  // Es legal —el jugador puede hacerlo— pero recomendarlo es marearlo.
  const s = escenario({
    tableau: [[C(10, 'H')], [C(9, 'S')]],
    waste: [C(2, 'S')],
  });

  assert.equal(engine.isLegal(s, { type: 'recycle' }), true, 'reciclar sigue siendo legal');
  assert.equal(recomendar(s), null, 'pero no es una recomendación');
});

// --- paseos: los que llevan a algo y los que no ---

test('el paseo que desemboca en una jugada de verdad se recomienda, y es el primer paso del camino corto', () => {
  // Pasear el 3H sobre el 4C parece un paseo más… pero deja el 4S libre y el 4S
  // sube. El 8H sobre el 9S, en cambio, no lleva a ninguna parte.
  const s = escenario({
    foundations: [picasHasta(3)],
    tableau: [[C(4, 'S'), C(3, 'H')], [C(4, 'C')], [C(8, 'H')], [C(9, 'S')]],
  });

  const util = { type: 'move', from: T(0), to: T(1), count: 1 };
  const salida = engine.buscarSalida(s);
  assert.equal(salida.hay, true);
  assert.ok(mismoMovimiento(salida.paso, util), 'el motor ve ese paseo como primer paso');

  const r = recomendar(s);
  assert.ok(mismoMovimiento(r.move, util), 'y el recomendador señala justo ese, no el otro paseo');
  assert.ok(r.alternatives.every((a) => a.move.from?.index !== 2),
    'el paseo del 8H no lleva a nada y no se ofrece ni como alternativa');

  // Comprobación de que el camino era real: tras el paseo el 4S ya puede subir.
  const despues = engine.applyMove(s, r.move).state;
  assert.ok(engine.usefulMoves(despues).some((m) => m.to.pile === PILE.FOUNDATION));
});

test('un tablero donde solo quedan paseos estériles no tiene nada que recomendar', () => {
  // El 9S va y viene sobre el 10H hasta el fin de los tiempos. Antes eso contaba
  // como jugada y la pista se pasaba la vida recomendándolo.
  const s = escenario({ tableau: [[C(10, 'H')], [C(9, 'S')]] });

  assert.equal(engine.cardMoves(s).length, 1, 'lo único legal es pasear el 9S');
  assert.equal(recomendar(s), null);

  const despues = engine.applyMove(s, engine.cardMoves(s)[0]).state;
  assert.equal(recomendar(despues), null, 'después del paseo sigue sin haber nada');
});

// --- rescate: bajar de una fundación ---

test('atascada y con salida solo bajando de fundación, se recomienda el rescate', () => {
  // Sin mazo, sin descarte y sin una sola jugada en las columnas. Bajar el 4C
  // sobre el 5H le da destino al 3D, y con él se destapa la carta que lo tapa.
  const s = escenario({
    foundations: [[], [], [], [C(1, 'C'), C(2, 'C'), C(3, 'C'), C(4, 'C')]],
    tableau: [[C(5, 'H')], [X(9, 'C'), C(3, 'D')]],
  });

  assert.deepEqual(engine.usefulMoves(s), [], 'no queda ninguna jugada normal');
  assert.equal(engine.isStuck(s), true);

  const r = recomendar(s);
  assert.equal(r.reason, RAZON.RESCATE);
  assert.ok(mismoMovimiento(r.move, { type: 'move', from: F(3), to: T(0), count: 1 }));
  assert.equal(engine.isLegal(s, r.move), true);
});

test('el rescate no se propone mientras quede algo que hacer', () => {
  // Mismo tablero, pero con una carta en el mazo: desandar una fundación deja de
  // tener sentido en cuanto hay algo más barato que probar.
  const s = escenario({
    foundations: [[], [], [], [C(1, 'C'), C(2, 'C'), C(3, 'C'), C(4, 'C')]],
    tableau: [[C(5, 'H')], [X(9, 'C'), C(3, 'D')]],
    stock: [X(7, 'S')],
  });

  assert.equal(engine.isStuck(s), false);
  const r = recomendar(s);
  assert.equal(r.reason, RAZON.ROBAR);
  const todas = [r, ...r.alternatives];
  assert.ok(todas.every((a) => a.move.from?.pile !== PILE.FOUNDATION),
    'ninguna jugada propuesta baja de las fundaciones');
});

test('atascada pero sin que bajar de la fundación abra nada: no hay rescate que valga', () => {
  // El 4C cabe sobre el 5H, pero después solo se puede volver a subir. Eso no es
  // rescatar la partida, es deshacer el rescate.
  const s = escenario({
    foundations: [[], [], [], [C(1, 'C'), C(2, 'C'), C(3, 'C'), C(4, 'C')]],
    tableau: [[C(5, 'H')], [X(9, 'C'), C(8, 'D')]],
  });

  assert.equal(engine.isStuck(s), true);
  assert.equal(recomendar(s), null);
});

// --- legalidad, pureza y casos límite ---

test('toda jugada devuelta —principal o alternativa— es legal en el estado que se le dio', () => {
  for (const seed of SOLVABLE_SEEDS.slice(0, 10)) {
    for (const drawCount of [1, 3]) {
      let s = engine.newGame({ seed, drawCount });
      const anteriores = [];
      for (let i = 0; i < 80 && !engine.isWon(s); i++) {
        const r = recomendar(s, { historial: memoria(s, anteriores) });
        if (!r) break;
        assert.equal(engine.isLegal(s, r.move), true, `pista ilegal en el reparto ${seed}`);
        for (const a of r.alternatives) {
          assert.equal(engine.isLegal(s, a.move), true, `alternativa ilegal en el reparto ${seed}`);
        }
        anteriores.push(huella(s));
        s = engine.applyMove(s, r.move).state;
      }
    }
  }
});

test('recomendar no toca el estado que recibe', () => {
  // Simula sobre copias: si mutara el original, la pista cambiaría la partida.
  const s = escenario({
    tableau: [[X(7, 'C'), C(5, 'H')], [C(6, 'S')], [C(5, 'S')]],
    waste: [C(4, 'D')],
    stock: [X(9, 'C')],
  });
  const antes = JSON.stringify(s);
  recomendar(s);
  mejorDestinoPara(s, T(0), 1);
  assert.equal(JSON.stringify(s), antes);
});

test('una partida ganada no tiene nada que recomendar', () => {
  const ganada = escenario({
    foundations: ['S', 'H', 'D', 'C'].map((suit) => Array.from({ length: 13 }, (_, i) => C(i + 1, suit))),
  });
  assert.equal(engine.isWon(ganada), true);
  assert.equal(recomendar(ganada), null);
});

// --- mejorDestinoPara: lo que usa el toque ---

test('mejorDestinoPara nunca manda subir arriesgando: esa la decide el jugador arrastrando', () => {
  const sola = escenario({ foundations: [picasHasta(8)], tableau: [[C(9, 'S')]] });
  assert.equal(recomendar(sola).reason, RAZON.FUNDACION_RIESGO, 'la pista sí la ofrece');
  assert.equal(mejorDestinoPara(sola, T(0), 1), null, 'el toque no');

  const conColumna = escenario({ foundations: [picasHasta(8)], tableau: [[C(9, 'S')], [C(10, 'H')]] });
  const destino = mejorDestinoPara(conColumna, T(0), 1);
  assert.deepEqual(destino.move.to, T(1), 'con una columna donde apoyarse, ahí va');
});

test('para un mismo origen, la pista y el toque eligen el mismo destino', () => {
  // Es el motivo de que mejorDestinoPara comparta ranking con recomendar: que
  // tocar una carta no la mande a un sitio distinto del que señala la pista.
  let comprobadas = 0;
  for (const seed of SOLVABLE_SEEDS.slice(0, 8)) {
    let s = engine.newGame({ seed, drawCount: 1 });
    const anteriores = [];
    for (let i = 0; i < 80 && !engine.isWon(s); i++) {
      // Sin historial en la comparación: las dos funciones han de decidir con la
      // misma información. El paseo por la partida sí lo usa, para no dar vueltas.
      const pista = recomendar(s);
      if (pista && pista.move.type === 'move'
        && pista.move.from.pile !== PILE.FOUNDATION
        && pista.reason !== RAZON.FUNDACION_RIESGO) {
        const toque = mejorDestinoPara(s, pista.move.from, pista.move.count ?? 1);
        assert.ok(toque, 'si la pista mueve esa carta, el toque también sabe adónde');
        assert.deepEqual(toque.move.to, pista.move.to, `pista y toque discrepan en el reparto ${seed}`);
        assert.equal(toque.reason, pista.reason);
        comprobadas++;
      }
      const avance = recomendar(s, { historial: memoria(s, anteriores) });
      if (!avance) break;
      anteriores.push(huella(s));
      s = engine.applyMove(s, avance.move).state;
    }
  }
  assert.ok(comprobadas > 50, `la comparación tiene que darse muchas veces, y solo se dio ${comprobadas}`);
});

test('mejorDestinoPara solo devuelve destinos legales, y ninguno insegura a fundación', () => {
  for (const seed of SOLVABLE_SEEDS.slice(0, 6)) {
    let s = engine.newGame({ seed, drawCount: 3 });
    const anteriores = [];
    for (let i = 0; i < 60 && !engine.isWon(s); i++) {
      const origenes = [W, ...s.tableau.map((_, index) => T(index))];
      for (const from of origenes) {
        const pila = from.pile === PILE.WASTE ? s.waste : s.tableau[from.index];
        for (let count = 1; count <= pila.length; count++) {
          const d = mejorDestinoPara(s, from, count);
          if (!d) continue;
          assert.equal(engine.isLegal(s, d.move), true);
          assert.notEqual(d.reason, RAZON.FUNDACION_RIESGO);
          if (d.move.to.pile === PILE.FOUNDATION) {
            const origen = from.pile === PILE.WASTE ? s.waste : s.tableau[from.index];
            assert.equal(engine.isSafeToFoundation(s, origen[origen.length - count]), true,
              `el toque mandó arriba una carta que abajo hace falta (reparto ${seed})`);
          }
        }
      }
      const r = recomendar(s, { historial: memoria(s, anteriores) });
      if (!r) break;
      anteriores.push(huella(s));
      s = engine.applyMove(s, r.move).state;
    }
  }
});

// --- memoria: el historial pesa ---

test('una posición por la que ya se ha pasado deja de recomendarse si hay otra razonable', () => {
  const s = escenario({
    tableau: [[X(7, 'C'), C(5, 'H')], [C(6, 'S')], [C(5, 'S')]],
    waste: [C(4, 'D')],
  });

  const primera = recomendar(s);
  assert.equal(primera.reason, RAZON.DESTAPAR);

  // Se le dice que a esa posición ya se ha llegado antes: la buena pasa a ser la
  // siguiente razonable, no la misma una y otra vez.
  const yaVista = huella(engine.applyMove(s, primera.move).state);
  const segunda = recomendar(s, { historial: new Set([yaVista]) });
  assert.equal(segunda.reason, RAZON.DESCARTE);
  assert.ok(!mismoMovimiento(segunda.move, primera.move));
  assert.ok(segunda.alternatives.every((a) => !mismoMovimiento(a.move, primera.move)),
    'repetir una posición reciente no es "peor": es que no se ofrece');
});

test('siguiendo la pista 300 veces la partida avanza o termina, nunca da vueltas sobre la misma posición', () => {
  // El historial es lo que rompe el bucle: sin memoria, una política de un solo
  // movimiento acaba oscilando siempre. Se le pasa el mismo Set que le pasa
  // game.js —el estado actual más los doce anteriores— y se exige que ninguna
  // posición se repita en toda la partida.
  for (const seed of SOLVABLE_SEEDS.slice(0, 12)) {
    for (const drawCount of [1, 3]) {
      let s = engine.newGame({ seed, drawCount });
      const anteriores = [];
      const vistas = new Set();
      let final = 'sigue';

      for (let paso = 0; paso < 300; paso++) {
        const h = huella(s);
        assert.equal(vistas.has(h), false,
          `el reparto ${seed} (robo de ${drawCount}) vuelve a la misma posición en el paso ${paso}`);
        vistas.add(h);
        if (engine.isWon(s)) { final = 'ganada'; break; }

        const r = recomendar(s, { historial: memoria(s, anteriores) });
        if (!r) { final = 'sin jugadas'; break; }
        anteriores.push(h);
        s = engine.applyMove(s, r.move).state;
      }

      assert.notEqual(final, 'sigue',
        `el reparto ${seed} (robo de ${drawCount}) no acabó en 300 jugadas: la pista se ha quedado dando vueltas`);
    }
  }
});

// --- huella ---

test('la huella es estable y no distingue dos columnas intercambiadas', () => {
  // Es la memoria del recomendador: si la misma posición diera huellas distintas,
  // no reconocería que está volviendo sobre sus pasos.
  const s = escenario({
    tableau: [[X(7, 'C'), C(5, 'H')], [C(6, 'S')]],
    foundations: [picasHasta(2)],
    waste: [C(4, 'D')],
  });
  assert.equal(huella(s), huella(s), 'la misma llamada dos veces');
  assert.equal(huella(s), huella(engine.cloneState(s)), 'una copia es la misma posición');

  const cambiadas = escenario({
    tableau: [[C(6, 'S')], [], [], [X(7, 'C'), C(5, 'H')]],
    foundations: [picasHasta(2)],
    waste: [C(4, 'D')],
  });
  assert.equal(huella(cambiadas), huella(s),
    'dos columnas intercambiadas son la misma posición a efectos de juego');
});

test('la huella ignora el mazo, que el jugador no ve', () => {
  // Si el orden del mazo entrara en la huella, el recomendador podría distinguir
  // estados por una información que no le corresponde.
  const base = { tableau: [[C(6, 'S')]], waste: [C(4, 'D')] };
  assert.equal(
    huella(escenario({ ...base, stock: [X(9, 'S'), X(3, 'H')] })),
    huella(escenario({ ...base, stock: [X(2, 'C')] })),
  );
});

test('la huella no delata qué carta hay boca abajo', () => {
  // Dos posiciones que el jugador ve exactamente iguales tienen que dar la misma
  // huella. Si no, la memoria antibucle distingue estados indistinguibles —y la
  // huella, que es API pública, filtra lo que nadie debería poder mirar.
  const con = (tapada) => escenario({
    tableau: [[tapada, C(5, 'H')], [C(6, 'S')]],
    waste: [C(4, 'D')],
  });
  assert.equal(huella(con(X(7, 'C'))), huella(con(X(2, 'D'))));
  // Pero destaparla sí es otra posición: ahí ya se ve de qué carta se trata.
  assert.notEqual(
    huella(con(X(7, 'C'))),
    huella(escenario({ tableau: [[C(7, 'C'), C(5, 'H')], [C(6, 'S')]], waste: [C(4, 'D')] })),
  );
});

test('la pista no mira lo que hay debajo de la carta que levanta', () => {
  // Dos tableros idénticos salvo en qué carta esconde la columna 0. El
  // recomendador puntúa como si siguiera boca abajo, así que tiene que
  // recomendar lo mismo en los dos: si mirase, elegiría distinto.
  const montar = (tapada) => escenario({
    tableau: [[tapada, C(5, 'H')], [C(6, 'S')], [C(5, 'S')], [C(2, 'H')]],
    foundations: [[], [C(1, 'H')], [], []],
    waste: [C(4, 'D')],
  });

  const conAs = recomendar(montar(X(1, 'D')));       // debajo, un as que subiría solo
  const conBasura = recomendar(montar(X(9, 'C')));   // debajo, una carta que no sirve de nada
  assert.deepEqual(conAs.move, conBasura.move);
  assert.equal(conAs.reason, conBasura.reason);
  assert.equal(conAs.score, conBasura.score, 'y con la misma puntuación: la carta tapada no cuenta');
});
