import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/engine.js';
import { PILE } from '../src/engine.js';
import { SUITS, cardId, createDeck, mulberry32, shuffle } from '../src/cards.js';

const F = (index) => ({ pile: PILE.FOUNDATION, index });
const T = (index) => ({ pile: PILE.TABLEAU, index });
const W = { pile: PILE.WASTE };

/** Carta suelta para montar posiciones a mano, con el id de verdad de la baraja. */
const carta = (rank, suit, faceUp = true) => ({ id: cardId(rank, suit), rank, suit, faceUp });

function allCards(state) {
  return [
    ...state.stock, ...state.waste,
    ...state.foundations.flat(), ...state.tableau.flat(),
  ];
}

function checkInvariants(state, label = '') {
  const cards = allCards(state);
  assert.equal(cards.length, 52, `${label}: se han perdido o duplicado cartas`);
  assert.equal(new Set(cards.map((c) => c.id)).size, 52, `${label}: ids repetidos`);
  for (const c of state.stock) assert.equal(c.faceUp, false, `${label}: carta boca arriba en el mazo`);
  for (const c of state.waste) assert.equal(c.faceUp, true, `${label}: carta boca abajo en el descarte`);
  state.foundations.forEach((pile, i) => {
    pile.forEach((c, j) => {
      assert.equal(c.suit, SUITS[i], `${label}: palo incorrecto en fundación`);
      assert.equal(c.rank, j + 1, `${label}: fundación desordenada`);
    });
  });
  for (const pile of state.tableau) {
    let seenFaceUp = false;
    for (const c of pile) {
      if (c.faceUp) seenFaceUp = true;
      else assert.equal(seenFaceUp, false, `${label}: carta boca abajo sobre una boca arriba`);
    }
    const firstUp = pile.findIndex((c) => c.faceUp);
    if (firstUp >= 0) {
      assert.ok(engine.isValidRun(pile, firstUp), `${label}: secuencia inválida en el tableau`);
    }
  }
}

test('el reparto inicial es un Klondike válido', () => {
  const s = engine.newGame({ seed: 1 });
  assert.deepEqual(s.tableau.map((p) => p.length), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(s.stock.length, 24);
  assert.equal(s.waste.length, 0);
  for (const pile of s.tableau) {
    assert.equal(engine.top(pile).faceUp, true, 'la última carta de cada columna va boca arriba');
    for (let i = 0; i < pile.length - 1; i++) assert.equal(pile[i].faceUp, false);
  }
  checkInvariants(s, 'reparto');
});

test('la misma semilla da el mismo reparto y semillas distintas no', () => {
  const a = engine.newGame({ seed: 12345 });
  const b = engine.newGame({ seed: 12345 });
  const c = engine.newGame({ seed: 12346 });
  const ids = (s) => s.tableau.flat().map((x) => x.id).join(',');
  assert.equal(ids(a), ids(b));
  assert.notEqual(ids(a), ids(c));
});

test('shuffle es una permutación, no pierde cartas', () => {
  const deck = createDeck();
  const out = shuffle(deck, mulberry32(99));
  assert.equal(out.length, 52);
  assert.equal(new Set(out.map((c) => c.id)).size, 52);
  assert.deepEqual(deck.map((c) => c.id).sort(), out.map((c) => c.id).sort());
  assert.notEqual(deck.map((c) => c.id).join(), out.map((c) => c.id).join());
});

test('robar de 1 pasa la carta de arriba del mazo al descarte', () => {
  const s = engine.newGame({ seed: 3, drawCount: 1 });
  const expected = engine.top(s.stock).id;
  const { state } = engine.applyMove(s, { type: 'draw' });
  assert.equal(state.stock.length, 23);
  assert.equal(engine.top(state.waste).id, expected);
  assert.equal(engine.top(state.waste).faceUp, true);
  checkInvariants(state, 'draw 1');
});

test('robar de 3 deja arriba la tercera carta, como al repartirlas una a una', () => {
  const s = engine.newGame({ seed: 3, drawCount: 3 });
  const n = s.stock.length;
  const third = s.stock[n - 3].id;   // tercera contando desde arriba
  const first = s.stock[n - 1].id;
  const { state } = engine.applyMove(s, { type: 'draw' });
  assert.equal(state.waste.length, 3);
  assert.equal(engine.top(state.waste).id, third);
  assert.equal(state.waste[0].id, first);
  checkInvariants(state, 'draw 3');
});

test('robar de 3 con menos de 3 cartas coge las que queden', () => {
  let s = engine.newGame({ seed: 5, drawCount: 3 });
  s = { ...engine.cloneState(s), stock: s.stock.slice(0, 2) };
  const { state } = engine.applyMove(s, { type: 'draw' });
  assert.equal(state.stock.length, 0);
  assert.equal(state.waste.length, 2);
});

test('no se puede robar con el mazo vacío', () => {
  const s = engine.newGame({ seed: 5 });
  const empty = { ...engine.cloneState(s), stock: [] };
  assert.equal(engine.applyMove(empty, { type: 'draw' }), null);
});

test('reciclar devuelve el descarte al mazo en el mismo orden', () => {
  let s = engine.newGame({ seed: 8, drawCount: 1 });
  const orden = [];
  while (s.stock.length) {
    orden.push(engine.top(s.stock).id);
    s = engine.applyMove(s, { type: 'draw' }).state;
  }
  s = engine.applyMove(s, { type: 'recycle' }).state;
  assert.equal(s.waste.length, 0);
  assert.equal(s.stock.length, 24);
  assert.equal(s.recycles, 1);
  const orden2 = [];
  let t = s;
  while (t.stock.length) {
    orden2.push(engine.top(t.stock).id);
    t = engine.applyMove(t, { type: 'draw' }).state;
  }
  assert.deepEqual(orden2, orden, 'la segunda pasada debe repetir el orden de la primera');
  checkInvariants(s, 'recycle');
});

test('no se recicla si el mazo no está vacío ni si el descarte lo está', () => {
  const s = engine.newGame({ seed: 8 });
  assert.equal(engine.applyMove(s, { type: 'recycle' }), null);
  const vacio = { ...engine.cloneState(s), stock: [], waste: [] };
  assert.equal(engine.applyMove(vacio, { type: 'recycle' }), null);
});

test('Vegas limita las pasadas: 0 reciclajes robando de 1, 2 robando de 3', () => {
  assert.equal(engine.maxRecyclesFor('vegas', 1), 0);
  assert.equal(engine.maxRecyclesFor('vegas', 3), 2);
  assert.equal(engine.maxRecyclesFor('standard', 1), Infinity);

  let s = engine.newGame({ seed: 8, drawCount: 1, scoring: 'vegas' });
  while (s.stock.length) s = engine.applyMove(s, { type: 'draw' }).state;
  assert.equal(engine.applyMove(s, { type: 'recycle' }), null, 'en Vegas draw-1 no hay segunda pasada');
});

test('reglas de apilado en el tableau', () => {
  const rojo6 = { rank: 6, suit: 'H', faceUp: true };
  const negro7 = { rank: 7, suit: 'S', faceUp: true };
  const rojo7 = { rank: 7, suit: 'D', faceUp: true };
  const rey = { rank: 13, suit: 'C', faceUp: true };

  assert.equal(engine.canStackTableau(rojo6, negro7), true, 'rojo sobre negro, uno menos');
  assert.equal(engine.canStackTableau(rojo6, rojo7), false, 'mismo color no vale');
  assert.equal(engine.canStackTableau(rojo6, { rank: 8, suit: 'S', faceUp: true }), false, 'salto de rango');
  assert.equal(engine.canStackTableau(rey, null), true, 'el hueco solo acepta Rey');
  assert.equal(engine.canStackTableau(rojo6, null), false);
  assert.equal(engine.canStackTableau(rojo6, { ...negro7, faceUp: false }), false, 'no sobre carta tapada');
});

test('reglas de las fundaciones', () => {
  assert.equal(engine.canStackFoundation({ rank: 1, suit: 'S' }, []), true);
  assert.equal(engine.canStackFoundation({ rank: 2, suit: 'S' }, []), false);
  const pica = [{ rank: 1, suit: 'S' }];
  assert.equal(engine.canStackFoundation({ rank: 2, suit: 'S' }, pica), true);
  assert.equal(engine.canStackFoundation({ rank: 2, suit: 'C' }, pica), false, 'palo distinto');
  assert.equal(engine.canStackFoundation({ rank: 3, suit: 'S' }, pica), false, 'salto de rango');
});

test('solo se mueven secuencias válidas del tableau, y arrastran a las de debajo', () => {
  const s = engine.newGame({ seed: 1 });
  const st = engine.cloneState(s);
  st.tableau[0] = [
    { id: 'x', rank: 5, suit: 'C', faceUp: false },
    { id: 'KS', rank: 13, suit: 'S', faceUp: true },
    { id: 'QH', rank: 12, suit: 'H', faceUp: true },
    { id: 'JS', rank: 11, suit: 'S', faceUp: true },
  ];
  st.tableau[1] = [];
  assert.equal(engine.isValidRun(st.tableau[0], 1), true);
  assert.equal(engine.isValidRun(st.tableau[0], 0), false, 'incluye una carta boca abajo');

  const ok = engine.applyMove(st, { type: 'move', from: T(0), to: T(1), count: 3 });
  assert.ok(ok, 'K-Q-J debe poder ir al hueco');
  assert.deepEqual(ok.state.tableau[1].map((c) => c.id), ['KS', 'QH', 'JS']);
  assert.equal(ok.state.tableau[0].length, 1);
  assert.equal(ok.state.tableau[0][0].faceUp, true, 'la carta que queda se destapa');
  assert.ok(ok.events.some((e) => e.type === 'flip'));

  st.tableau[2] = [{ id: 'QS', rank: 12, suit: 'S', faceUp: true }];
  assert.equal(
    engine.applyMove(st, { type: 'move', from: T(0), to: T(2), count: 2 }),
    null,
    'Q-J no es una secuencia contigua empezando dos por debajo del final',
  );
});

test('a las fundaciones solo sube una carta y del palo correcto', () => {
  const st = engine.cloneState(engine.newGame({ seed: 2 }));
  st.foundations[1] = [{ id: 'AH', rank: 1, suit: 'H', faceUp: true }];  // índice 1 = corazones
  st.tableau[0] = [
    { id: 'AS', rank: 1, suit: 'S', faceUp: true },
    { id: '2H', rank: 2, suit: 'H', faceUp: true },
  ];
  assert.equal(engine.applyMove(st, { type: 'move', from: T(0), to: F(1), count: 2 }), null, 'nunca dos cartas');
  assert.equal(engine.applyMove(st, { type: 'move', from: T(0), to: F(0), count: 1 }), null, 'el 2H no va a picas');
  assert.equal(engine.applyMove(st, { type: 'move', from: T(0), to: F(2), count: 1 }), null, 'ni a diamantes');
  const ok = engine.applyMove(st, { type: 'move', from: T(0), to: F(1), count: 1 });
  assert.ok(ok, 'el 2H sobre el AH sí');
  assert.equal(ok.state.foundations[1].length, 2);

  const vacia = engine.cloneState(st);
  vacia.foundations[1] = [];
  assert.equal(engine.applyMove(vacia, { type: 'move', from: T(0), to: F(1), count: 1 }), null, 'sobre fundación vacía solo el As');
});

test('del descarte solo se mueve la carta de arriba', () => {
  let s = engine.newGame({ seed: 11, drawCount: 3 });
  s = engine.applyMove(s, { type: 'draw' }).state;
  assert.equal(engine.applyMove(s, { type: 'move', from: W, to: T(0), count: 2 }), null);
  assert.equal(engine.applyMove(s, { type: 'move', from: { pile: PILE.STOCK }, to: T(0), count: 1 }), null);
});

test('mover una columna sobre sí misma es ilegal', () => {
  const st = engine.cloneState(engine.newGame({ seed: 4 }));
  st.tableau[3] = [{ id: 'KD', rank: 13, suit: 'D', faceUp: true }];
  assert.equal(engine.applyMove(st, { type: 'move', from: T(3), to: T(3), count: 1 }), null);
});

test('bajar de la fundación al tableau es legal y emite el evento', () => {
  const st = engine.cloneState(engine.newGame({ seed: 6 }));
  st.foundations[0] = [{ id: 'AS', rank: 1, suit: 'S', faceUp: true }];
  st.tableau[0] = [{ id: '2H', rank: 2, suit: 'H', faceUp: true }];
  const res = engine.applyMove(st, { type: 'move', from: F(0), to: T(0), count: 1 });
  assert.ok(res);
  assert.equal(res.state.foundations[0].length, 0);
  assert.equal(res.events[0].from, PILE.FOUNDATION);
});

test('applyMove no muta el estado de entrada', () => {
  const s = engine.newGame({ seed: 21 });
  const antes = JSON.stringify(s);
  engine.applyMove(s, { type: 'draw' });
  assert.equal(JSON.stringify(s), antes);
});

test('isWon, canAutoComplete e isSafeToFoundation', () => {
  const st = engine.cloneState(engine.newGame({ seed: 31 }));
  st.stock = []; st.waste = [];
  st.tableau = [[], [], [], [], [], [], []];
  st.foundations = SUITS.map((suit) => Array.from({ length: 13 }, (_, i) => ({ id: `${i}${suit}`, rank: i + 1, suit, faceUp: true })));
  assert.equal(engine.isWon(st), true);
  assert.equal(engine.canAutoComplete(st), false, 'ya ganada, no hay nada que completar');

  const casi = engine.cloneState(st);
  casi.foundations[0].pop();
  casi.tableau[0] = [{ id: 'KS', rank: 13, suit: 'S', faceUp: true }];
  assert.equal(engine.isWon(casi), false);
  assert.equal(engine.canAutoComplete(casi), true);

  const tapada = engine.cloneState(casi);
  tapada.tableau[1] = [{ id: 'x', rank: 4, suit: 'H', faceUp: false }];
  assert.equal(engine.canAutoComplete(tapada), false, 'quedan cartas tapadas');

  const s2 = engine.newGame({ seed: 5 });
  assert.equal(engine.isSafeToFoundation(s2, { rank: 1, suit: 'S' }), true, 'los ases siempre');
  assert.equal(engine.isSafeToFoundation(s2, { rank: 2, suit: 'H' }), true, 'los doses siempre');
  assert.equal(engine.isSafeToFoundation(s2, { rank: 5, suit: 'H' }), false, 'faltan negras por subir');
});

test('isStuck detecta la partida muerta y no confunde una ganada', () => {
  const st = engine.cloneState(engine.newGame({ seed: 41 }));
  st.stock = []; st.waste = [];
  st.tableau = [[{ id: '5H', rank: 5, suit: 'H', faceUp: true }], [], [], [], [], [], []];
  st.foundations = [[], [], [], []];
  // Un 5 solo, sin ases ni huecos donde encaje: no hay jugada.
  st.tableau[1] = [{ id: '3C', rank: 3, suit: 'C', faceUp: false }];
  assert.equal(engine.isStuck(st), true);

  const ganada = engine.cloneState(st);
  ganada.tableau = [[], [], [], [], [], [], []];
  ganada.foundations = SUITS.map((suit) => Array.from({ length: 13 }, (_, i) => ({ id: `${i}${suit}`, rank: i + 1, suit, faceUp: true })));
  assert.equal(engine.isStuck(ganada), false);
});

test('los paseos entre columnas no mantienen viva una partida muerta', () => {
  // Lo único legal es mover el 9S sobre el 10H una y otra vez: antes eso
  // contaba como jugada y la partida parecía viva para siempre.
  const st = engine.cloneState(engine.newGame({ seed: 41 }));
  st.stock = []; st.waste = [];
  st.foundations = [[], [], [], []];
  st.tableau = [
    [carta(10, 'H')],
    [carta(9, 'S')],
    [], [], [], [], [],
  ];
  assert.equal(engine.cardMoves(st).length, 1, 'lo único legal es pasear el 9S');
  assert.deepEqual(engine.buscarSalida(st), { hay: false, paso: null }, 'ese paseo no desemboca en nada');
  assert.equal(engine.isStuck(st), true, 'pasear sin destino no es estar vivo');

  const vuelta = engine.applyMove(st, engine.cardMoves(st)[0]).state;
  assert.equal(engine.isStuck(vuelta), true, 'después del paseo sigue muerta');
});

test('un mazo lleno no basta: si ninguna de sus cartas cabe, la partida está cerrada', () => {
  // Antes bastaba con que el mazo tuviera cartas para dar la partida por viva, y
  // el jugador se pasaba diez minutos dando vueltas al montón. Lo que decide es
  // si alguna de las que pueden salir cabe en algún sitio.
  const st = engine.cloneState(engine.newGame({ seed: 41 }));
  st.foundations = [[], [], [], []];
  st.waste = [];
  st.tableau = [[carta(10, 'H')], [carta(9, 'S')], [], [], [], [], []];
  // Ni el 2D ni el 7C caben: no son ases, no van sobre el 10H ni sobre el 9S, y
  // en un hueco solo entra un rey.
  st.stock = [carta(2, 'D', false), carta(7, 'C', false)];
  assert.equal(engine.quedaJuegoEnElMazo(st), false);
  assert.equal(engine.isStuck(st), true, 'seis cartas por robar y ninguna sirve: está cerrada');

  // Con un 8 rojo, el 9S tiene quien se le apoye y la partida sigue viva.
  st.stock = [carta(2, 'D', false), carta(8, 'H', false)];
  assert.equal(engine.quedaJuegoEnElMazo(st), true);
  assert.equal(engine.isStuck(st), false);

  // Y un rey también vale: el hueco de la columna 2 es su sitio.
  st.stock = [carta(2, 'D', false), carta(13, 'D', false)];
  assert.equal(engine.isStuck(st), false);
});

test('robando de tres, solo cuenta lo que de verdad llega a lo alto del descarte', () => {
  // Robando de tres se pone a tiro una de cada tres, y reciclar no lo arregla:
  // la vuelta conserva el orden, así que la pasada siguiente deja arriba las
  // mismas. Un as enterrado en una posición que nunca sale no salva la partida.
  const base = () => {
    const st = engine.cloneState(engine.newGame({ seed: 41, drawCount: 3 }));
    st.drawCount = 3;
    st.foundations = [[], [], [], []];
    st.waste = [];
    st.tableau = [[carta(10, 'H')], [carta(9, 'S')], [], [], [], [], []];
    return st;
  };

  // El último del array es el de arriba del mazo, así que salen en orden
  // inverso. Robando de tres se queda arriba la 3.ª de cada tanda; aquí, el 7C y
  // el 5C. El as de corazones sale el segundo y se queda siempre tapado.
  const cerrada = base();
  cerrada.stock = ['5C', '6C', '4C', '7C', '1H', '2D']
    .map((id) => carta(Number(id.slice(0, -1)), id.slice(-1), false));
  assert.equal(engine.quedaJuegoEnElMazo(cerrada), false, 'el as está, pero no se alcanza');
  assert.equal(engine.isStuck(cerrada), true);

  // Robando de una sí se alcanza: misma baraja, otra modalidad, otra partida.
  const deUna = engine.cloneState(cerrada);
  deUna.drawCount = 1;
  assert.equal(engine.quedaJuegoEnElMazo(deUna), true);
  assert.equal(engine.isStuck(deUna), false);

  // Y si el as cae en una posición que sí sale —la tercera de la tanda—, la
  // partida de tres sigue viva con la misma baraja.
  const viva = base();
  viva.stock = ['5C', '6C', '4C', '1H', '7C', '2D']
    .map((id) => carta(Number(id.slice(0, -1)), id.slice(-1), false));
  assert.equal(engine.quedaJuegoEnElMazo(viva), true, 'ahora el as sale el tercero');
  assert.equal(engine.isStuck(viva), false);
});

test('lo que el motor da por alcanzable es exactamente lo que sale al pasar el mazo', () => {
  // La cuenta de `alcanzablesDelMazo` es puro papel: se contrasta contra la
  // realidad, robando y reciclando sin jugar nada y anotando qué cartas llegan a
  // lo alto del descarte. El error que importa es el de dar por cerrada una
  // partida viva, así que se cuentan las dos direcciones por separado.
  const rojo = (suit) => suit === 'H' || suit === 'D';

  /** Las que de verdad llegan arriba del descarte si no se juega nada. */
  const asomanDeVerdad = (state) => {
    const vistas = new Set();
    let s = engine.cloneState(state);
    for (let i = 0; i < 500; i++) {
      if (s.waste.length) vistas.add(s.waste.at(-1).id);
      if (engine.isLegal(s, { type: 'draw' })) s = engine.applyMove(s, { type: 'draw' }).state;
      else if (engine.isLegal(s, { type: 'recycle' })) s = engine.applyMove(s, { type: 'recycle' }).state;
      else break;
      if (s.recycles > 4) break;      // a la tercera vuelta ya se repite el ciclo
    }
    if (s.waste.length) vistas.add(s.waste.at(-1).id);
    return vistas;
  };

  let casos = 0;
  let daPorMuertaUnaViva = 0;
  let daPorVivaUnaMuerta = 0;

  for (const seed of [1, 5, 17, 99]) {
    for (const [drawCount, scoring] of [[1, 'standard'], [3, 'standard'], [3, 'vegas']]) {
      for (const robos of [0, 2, 9, 23]) {
        let s = engine.newGame({ seed, drawCount, scoring });
        for (let i = 0; i < robos && s.stock.length; i++) s = engine.applyMove(s, { type: 'draw' }).state;
        const pendientes = [...s.stock, ...s.waste];
        const asoman = asomanDeVerdad(s);

        for (const c of pendientes) {
          if (c.rank >= 13) continue;         // un rey entra en cualquier hueco: otro caso
          // Un tablero que solo acepta una carta: una columna con la de rango+1
          // y color contrario, las otras seis tapadas (encima de una carta boca
          // abajo no se pone nada) y las fundaciones bloqueadas con un rey.
          const t = engine.cloneState(s);
          const anfitrion = { id: 'ANF', rank: c.rank + 1, suit: rojo(c.suit) ? 'S' : 'H', faceUp: true };
          t.tableau = [[anfitrion], ...Array.from({ length: 6 }, (_, i) => [{ id: `T${i}`, rank: 5, suit: 'C', faceUp: false }])];
          t.foundations = ['S', 'H', 'D', 'C'].map((suit, i) => [{ id: `F${i}`, rank: 13, suit, faceUp: true }]);

          casos++;
          const viva = !engine.isStuck(t);
          const vivaDeVerdad = [...asoman].some((id) => {
            const x = pendientes.find((p) => p.id === id);
            return x.rank === anfitrion.rank - 1 && rojo(x.suit) !== rojo(anfitrion.suit);
          });
          if (!viva && vivaDeVerdad) daPorMuertaUnaViva++;
          if (viva && !vivaDeVerdad) daPorVivaUnaMuerta++;
        }
      }
    }
  }

  assert.ok(casos > 1000, `hacen falta muchos casos para que esto diga algo; hubo ${casos}`);
  assert.equal(daPorMuertaUnaViva, 0, 'dar por cerrada una partida viva se lleva la partida por delante');
  assert.equal(daPorVivaUnaMuerta, 0, 'y darla por viva estando cerrada deja al jugador dando vueltas al mazo');
});

test('sin más pasadas al mazo, lo que quede en el descarte por debajo ya no cuenta', () => {
  // En Vegas robando de una no se recicla: lo que pase de largo se queda dentro.
  const st = engine.cloneState(engine.newGame({ seed: 41, scoring: 'vegas' }));
  st.scoring = 'vegas';
  st.maxRecycles = engine.maxRecyclesFor('vegas', 1);
  st.recycles = 0;
  st.stock = [];
  st.foundations = [[], [], [], []];
  st.tableau = [[carta(10, 'H')], [carta(9, 'S')], [], [], [], [], []];
  // El as está en el descarte, pero enterrado, y ya no hay vuelta que darle.
  st.waste = [carta(1, 'H'), carta(4, 'C')];
  assert.equal(engine.isLegal(st, { type: 'recycle' }), false, 'no quedan pasadas');
  assert.equal(engine.quedaJuegoEnElMazo(st), false);
  assert.equal(engine.isStuck(st), true);

  // En estándar sí se recicla, así que ese mismo as vuelve a estar en juego.
  const estandar = engine.cloneState(st);
  estandar.scoring = 'standard';
  estandar.maxRecycles = Infinity;
  assert.equal(engine.quedaJuegoEnElMazo(estandar), true);
  assert.equal(engine.isStuck(estandar), false);
});

test('un paseo que abre una jugada sí cuenta, y buscarSalida dice por dónde se empieza', () => {
  // Pasear el 3H sobre el 4C parece un paseo… pero deja a la vista el 4S, que sube.
  const st = engine.cloneState(engine.newGame({ seed: 41 }));
  st.stock = []; st.waste = [];
  st.foundations = [
    [1, 2, 3].map((r) => carta(r, 'S')),
    [], [], [],
  ];
  st.tableau = [
    [carta(4, 'S'), carta(3, 'H')],
    [carta(4, 'C')],
    [], [], [], [], [],
  ];
  assert.equal(engine.isStuck(st), false, 'el paseo lleva a una jugada de verdad');

  const salida = engine.buscarSalida(st);
  assert.equal(salida.hay, true);
  assert.deepEqual(salida.paso, { type: 'move', from: T(0), to: T(1), count: 1 },
    'y el primer paso del camino es justamente el paseo que descubre el 4S');

  const despues = engine.applyMove(st, salida.paso).state;
  assert.equal(engine.usefulMoves(despues).some((m) => m.to.pile === PILE.FOUNDATION), true, 'el 4S ya puede subir');
});

test('con una jugada de verdad a la vista, buscarSalida contesta sin recorrer nada', () => {
  // El as sube ya: no hay laberinto que explorar, así que tampoco hay un primer
  // paso que señalar. Ese `paso: null` es lo que distingue «no hace falta rodeo»
  // de «hay que dar este rodeo».
  const st = engine.cloneState(engine.newGame({ seed: 41 }));
  st.stock = []; st.waste = [];
  st.foundations = [[], [], [], []];
  st.tableau = [[carta(1, 'S')], [carta(9, 'S')], [carta(10, 'H')], [], [], [], []];
  assert.deepEqual(engine.buscarSalida(st), { hay: true, paso: null });
  assert.equal(engine.isStuck(st), false);
});

test('buscarSalida no se marea: un paseo que vuelve sobre sus pasos no es una salida', () => {
  // El 9S va del 10H al 10D y del 10D al 10H mientras el jugador aguante. Sin
  // memoria de las posiciones ya vistas, esto sería un bucle infinito.
  const st = engine.cloneState(engine.newGame({ seed: 41 }));
  st.stock = []; st.waste = [];
  st.foundations = [[], [], [], []];
  st.tableau = [[carta(10, 'H')], [carta(10, 'D')], [carta(9, 'S')], [], [], [], []];
  assert.equal(engine.usefulMoves(st).length, 2, 'el 9S tiene dos dieces donde apoyarse');
  assert.deepEqual(engine.buscarSalida(st), { hay: false, paso: null });
  assert.equal(engine.isStuck(st), true);
});

/** Recorre TODOS los paseos posibles, sin el tope del motor: ¿alguno abre una jugada? */
function algunPaseoAbreJuego(state) {
  const visto = new Set([engine.huellaEstado(state)]);
  let frontera = [state];
  while (frontera.length) {
    const siguiente = [];
    for (const s of frontera) {
      for (const m of engine.usefulMoves(s)) {
        if (!engine.esLateral(s, m)) continue;
        const hijo = engine.applyMove(s, m).state;
        const h = engine.huellaEstado(hijo);
        if (visto.has(h)) continue;
        visto.add(h);
        if (engine.usefulMoves(hijo).some((x) => !engine.esLateral(hijo, x))) return true;
        siguiente.push(hijo);
      }
    }
    frontera = siguiente;
  }
  return false;
}

test('ante un laberinto de paseos, buscarSalida se rinde a favor del jugador', () => {
  // Veinte cartas descubiertas que se dejan recolocar de más de dos mil maneras
  // sin que ninguna abra nada. La búsqueda lleva tope, y al pasarlo prefiere
  // decir que hay salida: dar por muerta una partida viva sería peor que callar.
  const columnas = [
    [[11, 'D'], [10, 'C'], [9, 'D'], [8, 'S']],
    [[12, 'S'], [11, 'H']],
    [[10, 'S'], [9, 'H'], [8, 'C'], [7, 'D']],
    [[4, 'C'], [3, 'D'], [2, 'C']],
    [[3, 'H']],
    [[7, 'H'], [6, 'C'], [5, 'D'], [4, 'S']],
    [[6, 'S'], [5, 'H']],
  ];
  const st = engine.cloneState(engine.newGame({ seed: 41 }));
  st.stock = []; st.waste = [];
  st.foundations = [[], [], [], []];
  st.tableau = columnas.map((col) => col.map(([rank, suit]) => carta(rank, suit)));

  assert.equal(engine.usefulMoves(st).every((m) => engine.esLateral(st, m)), true,
    'no hay ni una jugada directa: todo lo que se puede hacer es recolocar cartas');
  assert.equal(algunPaseoAbreJuego(st), false, 'y recorridos todos los paseos, ninguno abre nada');

  assert.deepEqual(engine.buscarSalida(st), { hay: true, paso: null },
    'aun así se da la salida por buena: el tope corta antes de agotar el laberinto');
  assert.equal(engine.isStuck(st), false, 'y por eso no se anuncia el atasco');
});

test('la huella es la misma posición mirada dos veces, aunque cambien las columnas de sitio', () => {
  // Es la memoria con la que el motor y el recomendador reconocen que están
  // volviendo sobre sus pasos: si la misma posición diera huellas distintas, no
  // habría forma de detectar los bucles.
  const st = engine.cloneState(engine.newGame({ seed: 41 }));
  st.stock = []; st.waste = [carta(4, 'D')];
  st.foundations = [[carta(1, 'S')], [], [], []];
  st.tableau = [[carta(7, 'C', false), carta(5, 'H')], [carta(6, 'S')], [], [], [], [], []];

  assert.equal(engine.huellaEstado(st), engine.huellaEstado(st), 'la misma llamada dos veces');
  assert.equal(engine.huellaEstado(st), engine.huellaEstado(engine.cloneState(st)), 'una copia es la misma posición');

  const cambiadas = engine.cloneState(st);
  cambiadas.tableau = [[carta(6, 'S')], [], [], [carta(7, 'C', false), carta(5, 'H')], [], [], []];
  assert.equal(engine.huellaEstado(cambiadas), engine.huellaEstado(st),
    'dos columnas intercambiadas son la misma posición a efectos de juego');

  const movida = engine.applyMove(st, { type: 'move', from: T(0), to: T(1), count: 1 }).state;
  assert.notEqual(engine.huellaEstado(movida), engine.huellaEstado(st),
    'pero mover una carta de verdad sí cambia la huella');
});

test('la huella solo cuenta lo que está a la vista: el mazo no entra y lo tapado se marca como tapado', () => {
  // El mazo es información que el jugador no tiene, así que no puede distinguir
  // posiciones; lo que sí distingue es haber levantado una carta, porque eso
  // cambia la partida para siempre.
  const base = engine.cloneState(engine.newGame({ seed: 41 }));
  base.waste = []; base.foundations = [[], [], [], []];
  base.tableau = [[carta(7, 'C', false), carta(5, 'H')], [carta(6, 'S')], [], [], [], [], []];

  const conMazo = { ...base, stock: [carta(9, 'S', false), carta(3, 'H', false)] };
  const sinMazo = { ...base, stock: [] };
  assert.equal(engine.huellaEstado(conMazo), engine.huellaEstado(sinMazo), 'el mazo no forma parte de la posición');

  const destapada = engine.cloneState(sinMazo);
  destapada.tableau[0][0].faceUp = true;
  assert.notEqual(engine.huellaEstado(destapada), engine.huellaEstado(sinMazo),
    'una carta levantada es otra posición, aunque las cartas estén en el mismo sitio');
});

test('esLateral separa el paseo entre columnas del movimiento que cambia algo', () => {
  const st = engine.cloneState(engine.newGame({ seed: 41 }));
  st.stock = [];
  st.waste = [carta(8, 'S')];
  st.foundations = [[carta(1, 'S')], [], [carta(1, 'D')], []];
  st.tableau = [
    [carta(5, 'C', false), carta(10, 'H'), carta(9, 'S')],
    [carta(10, 'D')],
    [carta(13, 'S')],
    [carta(11, 'S')],
    [],
    [carta(9, 'H')],
    [carta(2, 'D')],
  ];

  const paseo = { type: 'move', from: T(0), to: T(1), count: 1 };          // el 9S cambia de diez
  const destapa = { type: 'move', from: T(0), to: T(3), count: 2 };        // el 10H-9S deja al aire la tapada
  const vaciar = { type: 'move', from: T(2), to: T(4), count: 1 };         // el rey se muda de hueco
  const subir = { type: 'move', from: T(6), to: F(2), count: 1 };          // el 2D a diamantes
  const delDescarte = { type: 'move', from: W, to: T(5), count: 1 };       // el 8S sale del descarte
  const rescate = { type: 'move', from: F(0), to: T(6), count: 1 };        // el As baja de la fundación
  // Todos son jugadas de verdad: lo que se compara es cómo las clasifica, no si valen.
  for (const m of [paseo, destapa, vaciar, subir, delDescarte, rescate]) assert.ok(engine.isLegal(st, m));

  assert.equal(engine.esLateral(st, paseo), true, 'cambiar una carta de columna sin destapar nada es pasear');
  assert.equal(engine.esLateral(st, vaciar), true, 'llevarse la columna entera tampoco destapa nada: sigue siendo un paseo');
  assert.equal(engine.esLateral(st, destapa), false, 'dejar a la vista una carta tapada es progreso');
  assert.equal(engine.esLateral(st, subir), false, 'subir a la fundación es progreso');
  assert.equal(engine.esLateral(st, delDescarte), false, 'sacar una carta del descarte la devuelve al juego');
  assert.equal(engine.esLateral(st, rescate), false, 'bajar de la fundación cambia el reparto de arriba');
});

test('paseo aleatorio largo: los invariantes aguantan', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed * 7919);
    let s = engine.newGame({ seed, drawCount: seed % 2 ? 1 : 3 });
    for (let i = 0; i < 400; i++) {
      const moves = engine.legalMoves(s);
      if (!moves.length) break;
      const move = moves[Math.floor(rng() * moves.length)];
      const res = engine.applyMove(s, move);
      assert.ok(res, `movimiento declarado legal pero rechazado (semilla ${seed})`);
      s = res.state;
      checkInvariants(s, `paseo seed ${seed} paso ${i}`);
      if (engine.isWon(s)) break;
    }
  }
});

test('legalMoves y isLegal coinciden', () => {
  let s = engine.newGame({ seed: 77, drawCount: 3 });
  for (let i = 0; i < 50; i++) {
    for (const m of engine.legalMoves(s)) assert.ok(engine.isLegal(s, m));
    const moves = engine.legalMoves(s);
    if (!moves.length) break;
    s = engine.applyMove(s, moves[0]).state;
  }
});

// --- Solucionador de prueba: demuestra que se puede ganar solo con movimientos legales ---

const stateKey = (s) => JSON.stringify([
  s.stock.map((c) => c.id),
  s.waste.map((c) => c.id),
  s.foundations.map((p) => p.length),
  s.tableau.map((p) => p.map((c) => (c.faceUp ? '+' : '-') + c.id)),
]);

function orderedMoves(s) {
  const moves = engine.cardMoves(s, { includeFoundationToTableau: false });
  const rank = (m) => {
    if (m.to.pile === PILE.FOUNDATION) {
      const src = m.from.pile === PILE.WASTE ? s.waste : s.tableau[m.from.index];
      return engine.isSafeToFoundation(s, engine.top(src)) ? 0 : 1;
    }
    if (m.from.pile === PILE.TABLEAU) {
      const src = s.tableau[m.from.index];
      const under = src[src.length - m.count - 1];
      if (under && !under.faceUp) return 2;
      if (m.count === src.length && s.tableau[m.to.index].length === 0) return 99; // bucle
      return 5;
    }
    if (m.from.pile === PILE.WASTE) return 3;
    return 7;
  };
  const out = moves.filter((m) => rank(m) < 99).sort((a, b) => rank(a) - rank(b));
  if (engine.isLegal(s, { type: 'draw' })) out.push({ type: 'draw' });
  if (engine.isLegal(s, { type: 'recycle' })) out.push({ type: 'recycle' });
  return out;
}

function solve(seed, budget = 40000) {
  const seen = new Set();
  const path = [];
  let nodes = 0;
  const dfs = (s) => {
    if (engine.isWon(s)) return true;
    if (++nodes > budget) return false;
    const key = stateKey(s);
    if (seen.has(key)) return false;
    seen.add(key);
    for (const move of orderedMoves(s)) {
      const res = engine.applyMove(s, move);
      if (!res) continue;
      path.push(move);
      if (dfs(res.state)) return true;
      path.pop();
      if (nodes > budget) return false;
    }
    return false;
  };
  return { won: dfs(engine.newGame({ seed, drawCount: 1 })), path: path.slice(), nodes };
}

test('repartos conocidos con solución: el motor llega a la victoria y la reconoce', () => {
  for (const seed of [1, 2, 5, 8, 9]) {
    const { won, path } = solve(seed);
    assert.ok(won, `el reparto ${seed} debería tener solución`);

    // Se repite la partida desde cero comprobando cada jugada.
    let s = engine.newGame({ seed, drawCount: 1 });
    for (const [i, move] of path.entries()) {
      assert.ok(engine.isLegal(s, move), `jugada ${i} ilegal al repetir el reparto ${seed}`);
      s = engine.applyMove(s, move).state;
      checkInvariants(s, `solución ${seed} jugada ${i}`);
    }
    assert.equal(engine.isWon(s), true, `el reparto ${seed} no acabó ganado`);
    assert.equal(s.foundations.reduce((n, p) => n + p.length, 0), 52);
    assert.equal(engine.isStuck(s), false);
  }
});
