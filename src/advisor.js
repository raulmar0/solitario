// Recomendador de jugadas. Puro: no toca el DOM ni sabe de textos, solo dice qué
// jugada conviene y por qué; el mensaje lo pone i18n.
//
// Dos límites que no se cruzan. Profundidad UNO: se simula el movimiento y se
// puntúa lo que queda, sin solucionador. Y solo información visible: por eso el
// mazo no se simula nunca —sabríamos qué carta va a salir— y la carta que una
// jugada levanta se puntúa como si siguiera boca abajo.

import {
  PILE,
  applyMove,
  buscarSalida,
  cardMoves,
  cloneState,
  esLateral,
  huellaEstado,
  isLegal,
  isSafeToFoundation,
  isWon,
  quedaJuegoEnElMazo,
  top,
  usefulMoves,
} from './engine.js';

/** Razones semánticas de una recomendación. El texto lo pone i18n. */
export const RAZON = {
  DESTAPAR: 'destapar',
  FUNDACION_SEGURA: 'fundacion-segura',
  FUNDACION_RIESGO: 'fundacion-riesgo',
  DESCARTE: 'descarte',
  VACIAR_COLUMNA: 'vaciar-columna',
  MOVILIDAD: 'movilidad',
  ROBAR: 'robar',
  RECICLAR: 'reciclar',
  RESCATE: 'rescate',
};

/**
 * Cuánto vale cada razón. Son excluyentes —cada jugada tiene una sola—, así que
 * esta tabla es literalmente el orden de preferencia leído de arriba abajo.
 */
const VALOR = {
  [RAZON.DESTAPAR]: 100,          // lo único que no se deshace solo: cada carta levantada acerca el final
  [RAZON.FUNDACION_SEGURA]: 80,   // subir sin arrepentimiento: ninguna carta del color contrario la necesita abajo
  [RAZON.DESCARTE]: 60,           // el descarte es una pila muerta: sacar de ahí devuelve una carta al juego
  [RAZON.VACIAR_COLUMNA]: 50,     // el primer hueco es por donde entran los reyes, y sin reyes el fondo no se destapa
  [RAZON.RESCATE]: 40,            // solo con la partida atascada: ahí desandar una fundación vale más que rendirse
  [RAZON.ROBAR]: 20,              // barato y siempre enseña algo nuevo: antes que mover cartas por moverlas
  [RAZON.RECICLAR]: 8,            // no enseña nada que no se haya visto, y en Vegas las pasadas se acaban
  [RAZON.MOVILIDAD]: 0,           // recolocar no es progreso: que lo justifiquen los modificadores
  [RAZON.FUNDACION_RIESGO]: -250, // subir una carta que abajo hace falta: solo si no queda otra cosa
};

/** Correcciones que se suman al valor de la razón. */
const MOD = {
  abreCamino: 70,       // el paseo que abre juego tiene que ganar a robar aunque pierda movilidad por el camino
  destapaAdemas: 25,    // subir a la fundación y encima descubrir una carta es mejor que subir y ya
  ocupaHueco: -20,      // gastar una columna libre cierra la puerta a los demás reyes: que lo pague quien no gane nada
  callejon: -45,        // dejar el tablero sin una sola jugada directa y sin mazo es quedarse a oscuras
  movilidad: 3,         // desempate fino: tener después más jugadas a mano es mejor, pero no manda sobre la razón
  movilidadTope: 30,    // …y por eso lleva techo: un recuento de jugadas no puede tumbar una subida segura
  paseoEsteril: -1000,  // pasear cartas sin que lleve a nada es el bucle clásico de las pistas tontas
  repetido: -1000,      // volver a una posición por la que se acaba de pasar es marear al jugador
};

/** Por debajo de esto una jugada no se ofrece: es ruido, no una recomendación. */
const UMBRAL = -600;

const acotar = (v, tope) => Math.max(-tope, Math.min(tope, v));

function pilaDe(state, ref) {
  if (ref.pile === PILE.TABLEAU) return state.tableau[ref.index];
  if (ref.pile === PILE.FOUNDATION) return state.foundations[ref.index];
  if (ref.pile === PILE.WASTE) return state.waste;
  return null;
}

/** La primera carta del grupo que se mueve: la que decide si el destino vale. */
function cabeza(state, m) {
  const pila = pilaDe(state, m.from);
  return pila ? pila[pila.length - (m.count ?? 1)] ?? null : null;
}

/** ¿Deja al descubierto una carta tapada? */
function destapa(state, m) {
  if (m.type !== 'move' || m.from.pile !== PILE.TABLEAU) return false;
  const src = state.tableau[m.from.index];
  const debajo = src[src.length - (m.count ?? 1) - 1];
  return !!debajo && !debajo.faceUp;
}

/** ¿Se lleva la columna entera y la deja libre? */
function vaciaColumna(state, m) {
  return m.type === 'move' && m.from.pile === PILE.TABLEAU
    && (m.count ?? 1) === state.tableau[m.from.index].length;
}

const columnasVacias = (state) => state.tableau.reduce((n, p) => n + (p.length ? 0 : 1), 0);

const mismaJugada = (a, b) => !!a && !!b && a.type === b.type
  && a.from.pile === b.from.pile && (a.from.index ?? null) === (b.from.index ?? null)
  && a.to.pile === b.to.pile && (a.to.index ?? null) === (b.to.index ?? null)
  && (a.count ?? 1) === (b.count ?? 1);

/**
 * El estado con el que se puntúa. Si la jugada levanta una carta se puntúa con
 * ella todavía boca abajo: la pista no sabe qué hay debajo y, si lo mirase,
 * estaría recomendando por algo que el jugador no ve.
 */
function estadoVisible(r) {
  const vuelta = r.events.find((e) => e.type === 'flip');
  if (!vuelta) return r.state;
  const copia = cloneState(r.state);
  top(copia.tableau[vuelta.column]).faceUp = false;
  return copia;
}

/**
 * Un paseo entre columnas solo cuenta si es el primer paso del camino que
 * `buscarSalida` ha encontrado. Si no hay camino ninguno vale —la partida está
 * muerta y moverlas es entretener al jugador—; y si la salida ya es una jugada
 * directa, se salvan únicamente los que dejan una columna libre, que sí cambian
 * la forma del tablero y no se pueden deshacer (a un hueco solo vuelve un rey).
 */
function esPaseoEsteril(ctx, m) {
  if (m.type !== 'move' || !esLateral(ctx.state, m)) return false;
  if (!ctx.salida.hay) return true;
  if (ctx.salida.paso) return !mismaJugada(m, ctx.salida.paso);
  return !vaciaColumna(ctx.state, m);
}

/**
 * ¿Este paseo pone a tiro una carta que antes no podía jugarse?
 *
 * `buscarSalida` contesta en cuanto encuentra UNA jugada directa y ahí se para,
 * sin mirar los paseos; y entonces `esPaseoEsteril` los descarta todos. Eso está
 * bien mientras la jugada directa valga la pena, pero cuando la única que hay es
 * subir una carta arriesgando, el paseo que deja a tiro un 6 que sube a su
 * fundación es muchísimo mejor y se estaba tirando a la basura.
 *
 * Se comparan CARTAS y no jugadas: mover la misma carta de una columna a otra
 * cambia la jugada (cambia el origen) pero no pone nada nuevo a tiro, y contarlo
 * como que abre juego es el bucle de ir y venir con la misma carta.
 */
function abreJugada(ctx, visible) {
  const jugables = (estado, lista) => new Set(lista
    .filter((m) => !esLateral(estado, m))
    .map((m) => cabeza(estado, m)?.id));
  const antes = jugables(ctx.state, ctx.utiles);
  const despues = jugables(visible, usefulMoves(visible));
  for (const id of despues) if (!antes.has(id)) return true;
  return false;
}

function razonDe(ctx, m) {
  if (m.type === 'draw') return RAZON.ROBAR;
  if (m.type === 'recycle') return RAZON.RECICLAR;
  if (m.from.pile === PILE.FOUNDATION) return RAZON.RESCATE;
  if (m.to.pile === PILE.FOUNDATION) {
    return isSafeToFoundation(ctx.state, cabeza(ctx.state, m))
      ? RAZON.FUNDACION_SEGURA : RAZON.FUNDACION_RIESGO;
  }
  if (destapa(ctx.state, m)) return RAZON.DESTAPAR;
  if (m.from.pile === PILE.WASTE) return RAZON.DESCARTE;
  // Vaciar la segunda columna no es un logro: el hueco que valía ya lo tenías.
  if (vaciaColumna(ctx.state, m) && ctx.huecos === 0) return RAZON.VACIAR_COLUMNA;
  return RAZON.MOVILIDAD;
}

/**
 * Lo que hace falta saber del estado antes de mirar candidato alguno. La
 * búsqueda de salida se hace una sola vez: está acotada, pero en cuanto hay una
 * jugada directa vuelve enseguida y no cuesta nada.
 */
function contexto(state) {
  const salida = buscarSalida(state);
  const utiles = usefulMoves(state);
  return {
    state,
    salida,
    utiles,
    movilidad: utiles.length,
    huecos: columnasVacias(state),
    // Es isStuck, pero repetirlo aquí evita lanzar la búsqueda por segunda vez.
    // Un mazo con cartas ya no basta para darla por viva: si ninguna de las que
    // pueden salir cabe en ningún sitio, robar es dar vueltas.
    atascado: !isWon(state) && !salida.hay && !quedaJuegoEnElMazo(state),
  };
}

/**
 * ¿Bajar esta carta de la fundación abre algo? Vale tanto una jugada directa
 * como un camino de paseos que desemboque en una: es exactamente lo que mira
 * `buscarSalida`, y es la misma vara con la que `isStuck` decide que la partida
 * NO está muerta. Si aquí se pidiera una jugada directa inmediata —como se hacía
 * antes— el aviso del tablero diría «todavía puedes bajar una carta» y la pista
 * contestaría «no veo ninguna jugada»: medido sobre 400 repartos jugados hasta
 * atascarse, las ocho posiciones con rescate posible abrían camino y ninguna se
 * llegaba a ofrecer.
 *
 * Lo que no cuenta es volver a subir la carta que se acaba de bajar: eso no
 * rescata nada, deshace el rescate.
 */
function abreJuego(state, m) {
  const bajada = top(pilaDe(state, m.from));
  const r = applyMove(state, m);
  if (!r || !bajada) return false;
  // Subir de nuevo la carta que acaba de bajar no cuenta, esté donde esté: es
  // deshacer el rescate. Se sigue por su id porque los paseos pueden haberla
  // movido de columna antes de que se plantee devolverla.
  const devolverla = (s, x) => x.to.pile === PILE.FOUNDATION
    && top(pilaDe(s, x.from))?.id === bajada.id;
  // Y también cuenta que la carta bajada le dé sitio a alguna de las que quedan
  // por robar: con el mazo cerrado, eso es exactamente lo que reabre la partida.
  return buscarSalida(r.state, { ignorar: devolverla }).hay || quedaJuegoEnElMazo(r.state);
}

function candidatos(ctx) {
  const lista = ctx.utiles.slice();
  // Con la partida cerrada, robar y reciclar no son candidatos: el mazo puede
  // seguir lleno, pero si ninguna de sus cartas cabe en ningún sitio, mandar a
  // robar es mandar a dar vueltas. Ahí lo único que queda es el rescate.
  if (!ctx.atascado) {
    if (isLegal(ctx.state, { type: 'draw' })) lista.push({ type: 'draw' });
    // Reciclar un descarte que cabe en un solo robo no cambia nada: la vuelta lo
    // devuelve en el mismo orden. Es legal, y el jugador puede hacerlo, pero
    // recomendarlo es mandar al jugador a dar vueltas sobre sí mismo.
    if (isLegal(ctx.state, { type: 'recycle' })
      && ctx.state.waste.length > (ctx.state.drawCount ?? 1)) lista.push({ type: 'recycle' });
  } else {
    // Bajar de una fundación es legal siempre, pero como sugerencia solo tiene
    // sentido cuando ya no queda nada más y encima sirve para algo.
    for (const m of cardMoves(ctx.state, { includeFoundationToTableau: true })) {
      if (m.from.pile === PILE.FOUNDATION && abreJuego(ctx.state, m)) lista.push(m);
    }
  }
  return lista;
}

function valorar(ctx, m) {
  const reason = razonDe(ctx, m);
  const r = applyMove(ctx.state, m);
  if (!r) return null;                       // candidato ilegal: fuera sin más
  // Robar no se puntúa por lo que salga: esa carta no la ve el jugador y la
  // pista tampoco debe verla. La partida simulada solo sirve para la huella, y
  // esa comparación no delata nada —si la posición coincide con una reciente es
  // porque la carta ya pasó por el descarte y se vio—. Sin eso, reciclar y robar
  // se turnan hasta el fin de los tiempos en cuanto el mazo se queda corto.
  if (m.type === 'draw') return { move: m, reason, score: VALOR[reason], esteril: false, despues: r.state };

  const visible = estadoVisible(r);
  const levanta = destapa(ctx.state, m);
  const utiles = usefulMoves(visible);
  let esteril = false;
  let score = VALOR[reason]
    + acotar(MOD.movilidad * (utiles.length - ctx.movilidad), MOD.movilidadTope);

  if (m.type === 'move') {
    if (levanta && reason !== RAZON.DESTAPAR) score += MOD.destapaAdemas;
    if (m.to.pile === PILE.TABLEAU && !ctx.state.tableau[m.to.index].length) score += MOD.ocupaHueco;
    if (ctx.salida.paso && mismaJugada(m, ctx.salida.paso)) score += MOD.abreCamino;
    esteril = esPaseoEsteril(ctx, m) && !abreJugada(ctx, visible);
    if (esteril) score += MOD.paseoEsteril;
  }
  // Quedarse sin mazo y sin una sola jugada directa es quedarse a oscuras. A la
  // jugada que levanta una carta no se la juzga así: lo que hay debajo no se ve
  // y puede cambiarlo todo.
  if (!levanta && !isWon(r.state) && !r.state.stock.length
    && !isLegal(r.state, { type: 'recycle' })
    && !utiles.some((x) => !esLateral(visible, x))) score += MOD.callejon;

  return { move: m, reason, score, esteril, despues: r.state };
}

/**
 * Puntúa la lista entera y la ordena de mejor a peor. El orden de llegada hace
 * de desempate —`sort` es estable—, y ese orden es el mismo que genera el motor,
 * así que `recomendar` y `mejorDestinoPara` eligen igual ante un empate.
 */
function ordenar(ctx, lista, vistos) {
  const out = [];
  for (const m of lista) {
    const e = valorar(ctx, m);
    if (!e) continue;
    // Volver a una posición reciente es justo la sensación de que la pista te
    // marea, y da igual que se llegue moviendo cartas o dando otra vuelta al
    // mazo: si la posición ya se ha visto, esa vuelta no lleva a ningún sitio.
    if (vistos?.size && e.despues && vistos.has(huellaEstado(e.despues))) e.score += MOD.repetido;
    out.push(e);
  }
  return out.sort((a, b) => b.score - a.score);
}

const publica = ({ move, reason, score }) => ({ move, reason, score });

/**
 * La jugada recomendada, o null si de verdad no queda ninguna: y eso no es «no
 * veo nada», es que la partida está cerrada. `opts.historial` es un Set de
 * huellas recientes: lo que ya se ha visto pesa en contra.
 *
 * El umbral aparta el ruido, pero no puede dejar al jugador sin respuesta: si
 * todo lo que hay son paseos estériles se ofrece el mejor de ellos igualmente.
 * Callarse teniendo una jugada legal que enseñar es lo que hacía que la pista
 * dijera «no veo ninguna jugada» en partidas que aún se podían mover.
 */
export function recomendar(state, opts = {}) {
  if (!state || isWon(state)) return null;
  const vistos = opts.historial instanceof Set
    ? opts.historial : new Set(opts.historial ?? []);
  const ctx = contexto(state);
  const ordenadas = ordenar(ctx, candidatos(ctx), vistos);
  // El umbral aparta el ruido, pero no puede dejar al jugador sin respuesta: si
  // todo lo que queda ha caído por debajo —por dar vueltas al mazo hasta volver
  // a la misma posición, casi siempre— se ofrece lo mejor que quede. Es el caso
  // de «he dado la vuelta entera al mazo y no ha salido nada»: ahí lo que toca es
  // tragarse la subida arriesgada, no seguir robando.
  //
  // Lo único que no entra ni así es el paseo estéril, que es el bucle que se ve.
  // Volver a una posición reciente sí entra, y a propósito: devolver null
  // significa «la partida está cerrada», y decírselo a alguien que aún tiene
  // jugadas es mucho peor que repetirle una pista. El castigo del historial son
  // mil puntos, más que cualquier distancia entre razones, así que si queda
  // alguna jugada que NO repite posición, el orden ya la pone la primera.
  let dignas = ordenadas.filter((e) => e.score > UMBRAL);
  if (!dignas.length) dignas = ordenadas.filter((e) => !e.esteril);
  if (!dignas.length) return null;
  const [mejor, ...resto] = dignas.map(publica);
  return { ...mejor, alternatives: resto };
}

/**
 * El ranking filtrado a un origen concreto. Por omisión conserva el criterio del
 * consejero; `preferFoundation` lo usa el toque directo para respetar una subida
 * legal aunque el consejero la considere estratégicamente arriesgada.
 */
export function mejorDestinoPara(state, from, count = 1, { preferFoundation = false } = {}) {
  if (!state || !from) return null;
  const ctx = contexto(state);
  const n = count ?? 1;
  const propios = ctx.utiles.filter((m) => m.from.pile === from.pile
    && (m.from.index ?? null) === (from.index ?? null) && (m.count ?? 1) === n);
  const ordenados = ordenar(ctx, propios);
  // El toque directo puede pedir una subida legal aunque no sea estratégicamente
  // segura. La opción no cambia el ranking de las pistas: solo evita que el gesto
  // del jugador convierta una jugada válida en otra columna distinta.
  const fundacion = preferFoundation
    ? ordenados.find((e) => e.move.to.pile === PILE.FOUNDATION)
    : null;
  const conSitio = ordenados.filter((e) => e.reason !== RAZON.FUNDACION_RIESGO);
  const mejor = fundacion ?? (conSitio.length ? conSitio : ordenados)[0];
  return mejor ? { move: mejor.move, reason: mejor.reason } : null;
}

/** La huella la calcula el motor; aquí solo se le pone el nombre público. */
export const huella = huellaEstado;
