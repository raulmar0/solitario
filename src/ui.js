// Tablero: dibuja las cartas y recoge ratón, dedo y teclado.
// Las 52 cartas son elementos fijos que solo cambian de `transform`,
// así el navegador anima cada movimiento sin que haya que orquestar nada.

import { RANK_LABEL, SUIT_GLYPH, isRed } from './cards.js';
import * as advisor from './advisor.js';
import * as engine from './engine.js';
import * as motion from './motion.js';
import { PILE } from './engine.js';

const DRAG_THRESHOLD = 5;     // px antes de considerar que se está arrastrando
const DOUBLE_TAP_MS = 320;
const REPARTO_PASO = 60;      // ms entre carta y carta al repartir: 3–5 vuelos a la vez
// Y al robar. Aquí son tres cartas, no veintiocho, así que el hueco entre una y
// otra tiene que verse: por debajo de esto parece que salen las tres a la vez.
// Por arriba tampoco puede pasarse, que robando de tres se roba mucho.
const ROBO_PASO = 55;
const VOLTEO_POR_DEFECTO = 280;   // reserva si el navegador no resuelve --flip-speed
// El montón del mazo se dibuja escalonado: cada carta asoma un pelo sobre la de
// abajo, hasta seis, para que se vea que hay mazo y no una carta suelta.
const MAZO_ESCALON = 0.6;
const MAZO_ESCALONES = 6;
const ALTO_MAZO = MAZO_ESCALON * MAZO_ESCALONES;
const BUMP_MS = 320;          // lo que dura el salto del contador del mazo
/**
 * Radio de rescate del toque. En las pantallas estrechas las columnas quedan a
 * un pelo y el dedo cae en el filo de la carta de al lado, casi siempre una
 * tapada: si a menos de esto hay una carta jugable, se entiende que iba a por
 * ella. Más ancho empezaría a mover cartas que nadie ha pedido.
 */
const CERCANIA = 22;
/**
 * Ancho mínimo de carta: los 44 px que pide Apple para un objetivo táctil. Por
 * debajo de eso el dedo deja de acertar y arrastrar se vuelve lotería.
 *
 * Es un suelo para lo que encoge por ALTO, no una promesa absoluta: siete
 * columnas de 44 px con sus huecos piden 354 px y hay teléfonos de 320, así que
 * a lo ancho manda lo que cabe — antes una carta estrecha que una barra de
 * desplazamiento. Ahí el objetivo lo repone `cartaMasCercana`, que rescata el
 * toque que cae en el filo de la columna de al lado.
 */
const ANCHO_MIN = 44;
// Escalones de una columna, en fracción del alto de carta: lo que asoma de una
// carta tapada y lo que asoma de una destapada, que enseña rango y palo.
const PASO_ABAJO = 0.1;
const PASO_ARRIBA = 0.24;
// Hasta un tercio del escalón las cartas se siguen distinguiendo; por debajo son
// una mancha. Es el suelo antes de empezar a encoger la carta entera.
const ESCALON_MIN = 0.34;
// Reserva por si el navegador no sabe resolver la variable de CSS. Tiene que
// coincidir con --card-speed en styles.css; hay una prueba que lo vigila.
export const VUELO_POR_DEFECTO = 324;
const Z_VUELO = 1000;         // una carta en movimiento va por encima del tablero
const Z_ARRASTRE = 2000;      // y la que lleva el jugador en la mano, por encima de todo
const PISTA_MS = 2400;        // 800 ms x 3 pasadas: lo que dura la animación de la pista
/**
 * Hueco que se guarda a cada lado del tablero. Las animaciones sacan la carta
 * de su sitio —el temblor de «esa no puede ser» la mueve 5 px y el latido de la
 * pista la agranda un 7%—, y sin este margen las columnas de los extremos se
 * salían del ancho de la pantalla. Hay una prueba que vigila que siga bastando.
 */
export const MARGEN_ANIM = 8;

/**
 * Reparto de la fila de arriba, en columnas: las cuatro fundaciones a la
 * izquierda, un hueco de respiro, y el mazo con su descarte a la derecha (que
 * es donde cae el pulgar). El descarte se abanica hacia la izquierda, hacia el
 * hueco, para no meterse debajo del mazo.
 */
export const COLUMNA = {
  foundation: (index) => index,   // 0, 1, 2 y 3
  waste: 5,
  stock: 6,
};

/**
 * El tablero no escribe ni una frase: `onMessage(clave, params, opciones)` recibe
 * claves de traducción y quien las reciba las traduce. `onDropIlegal({from, to,
 * count})` es opcional y avisa de que el jugador ha soltado donde no se podía,
 * para poder explicarle la regla en vez de devolverle la carta sin más.
 */
export function createBoard({
  root, game, onMessage = () => {}, onNegar = () => {}, onDropIlegal = () => {},
}) {
  const layer = root.querySelector('#cards');
  const contador = root.querySelector('#stock-count');
  const slots = [...root.querySelectorAll('.slot')];
  const els = new Map();       // id de carta -> elemento
  let layout = null;
  let drag = null;
  let ultimoAuto = { at: 0, x: 0, y: 0 };   // dónde y cuándo se jugó sola la última carta
  let enMazo = null;           // ids que aún no se han repartido: se dibujan sobre el mazo
  let tapadas = null;          // ids que siguen boca abajo mientras vuelan a su sitio
  let relojes = [];            // temporizadores del reparto
  let repartoFrame = null;     // frame pendiente de pintar la siguiente salida
  let repartoVersion = 0;      // invalida callbacks de repartos ya cancelados
  let volando = new Map();     // id -> temporizador; mientras vuela, la carta va arriba del todo
  let posiciones = new Map();  // id -> {x, y} del último pintado, para saber qué se ha movido
  let snapbacks = new Map();   // id -> {dur, dist, dx} para retorno proporcional tras arrastre
  let caras = new Map();       // id -> ¿estaba boca abajo?, para saber cuál se acaba de voltear
  let volteos = new Map();     // id -> temporizador del volteo en marcha
  let robadas = new Set();     // ids que salen del mazo y siguen boca abajo hasta llegar al descarte
  let relojesRobo = [];        // temporizadores del robo escalonado
  let resaltada = null;        // carta que el ratón señala sin llegar a pulsarla
  let bumpTimer = null;
  let ultimoMazo = null;       // cuántas cartas tenía el mazo la última vez que se pintó

  // --- creación de las cartas (una sola vez) ---
  for (const suit of ['S', 'H', 'D', 'C']) {
    for (let rank = 1; rank <= 13; rank++) {
      const el = document.createElement('div');
      const label = RANK_LABEL[rank];
      const glyph = SUIT_GLYPH[suit];
      el.className = `card${isRed(suit) ? ' red' : ''}${rank > 10 ? ' court' : ''}`;
      el.dataset.id = `${label}${suit}`;
      el.dataset.suit = suit;      // la baraja de cuatro colores se pinta por palo desde el CSS
      el.innerHTML =
        '<div class="back"></div>'
        + '<div class="face">'
        + `<span class="corner tl"><span class="rank">${label}</span><span class="suit">${glyph}</span></span>`
        + `<span class="pip">${rank > 10 ? label : glyph}</span>`
        + `<span class="corner br"><span class="rank">${label}</span><span class="suit">${glyph}</span></span>`
        + '</div>';
      el.setAttribute('aria-hidden', 'true');
      els.set(el.dataset.id, el);
      layer.appendChild(el);
    }
  }

  const slotFor = (pile, index) =>
    slots.find((s) => s.dataset.pile === pile && (index == null || Number(s.dataset.index) === index));

  // --- medidas ---

  /** El aire entre la fila de arriba y las columnas, que va con el alto de carta. */
  const huecoFila = (alto) => Math.max(9, alto * 0.13);

  /**
   * Lo que pide en escalones la columna más larga, en múltiplos del alto de
   * carta. Es la única parte del tablero que crece durante la partida, y por eso
   * se mide aparte de la talla de la carta.
   */
  function escalonesNecesarios(state) {
    let peor = 0;
    for (const pila of state?.tableau ?? []) {
      const abajo = pila.filter((c) => !c.faceUp).length;
      const arriba = pila.length - abajo;
      // Cada carta se apoya en la anterior, así que el escalón lo pone la de debajo.
      const pasos = arriba
        ? abajo * PASO_ABAJO + (arriba - 1) * PASO_ARRIBA
        : Math.max(0, abajo - 1) * PASO_ABAJO;
      if (pasos > peor) peor = pasos;
    }
    return peor;
  }

  const numero = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

  /**
   * El alto que le queda de verdad al tablero: lo que mide su contenedor menos
   * su relleno y menos lo que ocupan sus hermanos —el cartel de avisos, que
   * siempre reserva su línea, y el botón de rematar cuando aparece—. Antes se
   * descontaba un 30 fijo que solo cubría el relleno, y en un móvil apaisado el
   * tablero pedía 69 px más de los que había: seis cartas quedaban por debajo
   * del borde, y como el tapete no se desplaza, fuera del alcance del dedo.
   */
  function altoDisponible(host) {
    const cs = window.getComputedStyle(host);
    let libre = host.clientHeight - numero(cs.paddingTop) - numero(cs.paddingBottom);
    for (const hermano of host.children) {
      // `offsetParent` nulo es «no se está pintando»: ni el botón oculto ni,
      // en jsdom, ningún hermano. Ahí manda el alto del contenedor y ya está.
      if (hermano === root || hermano.hidden || hermano.offsetParent === null) continue;
      const hs = window.getComputedStyle(hermano);
      libre -= hermano.offsetHeight + numero(hs.marginTop) + numero(hs.marginBottom);
    }
    return libre;
  }

  function measure(state) {
    const host = root.parentElement;
    // Los suelos son solo para que un contenedor sin medir (0 px) no dé cartas
    // negativas: por encima de eso manda siempre lo que hay, que si no el
    // tablero se salía de la pantalla.
    const availW = Math.max(140, host.clientWidth - 2 * MARGEN_ANIM);
    const availH = Math.max(120, altoDisponible(host));

    const gap = Math.max(5, Math.min(13, availW * 0.013));
    const cabeALoAncho = (availW - 6 * gap) / 7;
    let cw = Math.min(cabeALoAncho, 104);
    let ch = cw * 1.4;
    // Reserva para una columna razonablemente larga: así la talla de la carta la
    // decide la pantalla y no la partida, y las cartas no cambian de tamaño a
    // media jugada. Lo que de verdad haya sobre la mesa se ajusta luego.
    const reserva = 2 * ch + huecoFila(ch) + 6.5 * (ch * PASO_ARRIBA);
    if (reserva > availH) {
      // Encogen por alto, pero nunca más anchas de lo que cabe ni por debajo del
      // objetivo táctil: una carta más estrecha que la yema no se puede coger.
      cw = Math.min(cabeALoAncho, Math.max(ANCHO_MIN, cw * (availH / reserva)));
      ch = cw * 1.4;
    }

    // Y ahora, la columna que de verdad hay. Primero se aprietan los escalones
    // —solaparse un poco más se sigue leyendo— y solo si con ellos al mínimo
    // sigue sin caber se encoge la carta: el tablero no hace scroll.
    const escalones = escalonesNecesarios(state);
    const alto = (c, k) => 2 * c + huecoFila(c) + escalones * k * c;
    const apretar = (c) => (availH - 2 * c - huecoFila(c)) / (escalones * c);
    let factor = 1;
    if (escalones > 0 && alto(ch, 1) > availH) {
      factor = Math.min(1, Math.max(ESCALON_MIN, apretar(ch)));
      if (alto(ch, factor) > availH) {
        // Se despeja el alto de carta que cabe, con las dos ramas del hueco de
        // la fila: el 13 % y el suelo de 9 px.
        const base = 2 + escalones * factor;
        let cabe = availH / (base + 0.13);
        if (cabe * 0.13 < 9) cabe = (availH - 9) / base;
        cw = Math.min(cw, Math.max(ANCHO_MIN, cabe / 1.4));
        ch = cw * 1.4;
        // Con la carta ya en su mínimo solo queda apretar más los escalones:
        // antes un solapamiento feo que una barra de desplazamiento.
        if (alto(ch, factor) > availH) factor = Math.max(0, apretar(ch));
      }
    }

    const rowGap = huecoFila(ch);
    return {
      cw, ch, gap, rowGap, tableauY: ch + rowGap,
      stepDown: ch * PASO_ABAJO * factor, stepUp: ch * PASO_ARRIBA * factor,
    };
  }

  const colX = (i, m) => i * (m.cw + m.gap);

  /** Dónde va cada carta y cuáles se pueden coger. */
  function computeLayout(state) {
    const m = measure(state);
    // Atascado es solo un aviso: se sigue pudiendo coger cartas (bajar una de la
    // fundación al tableau suele ser justo lo que desatasca la partida).
    const enJuego = game.status === 'playing' || game.status === 'stuck';
    const positions = new Map();
    const columns = [];
    let z = 0;

    const stockX = colX(COLUMNA.stock, m);
    state.stock.forEach((card, i) => {
      positions.set(card.id, {
        x: stockX, y: Math.min(i, MAZO_ESCALONES) * MAZO_ESCALON, z: z++, faceUp: false, playable: false,
      });
    });

    const wasteX = colX(COLUMNA.waste, m);
    const visible = Math.min(state.drawCount === 3 ? 3 : 1, state.waste.length);
    const wasteFan = Math.min(m.cw * 0.3, m.gap + m.cw * 0.24);
    state.waste.forEach((card, i) => {
      const fromTop = state.waste.length - 1 - i;
      const slotIdx = Math.max(0, visible - 1 - fromTop);
      positions.set(card.id, {
        x: wasteX - slotIdx * wasteFan,   // el abanico crece hacia la izquierda
        y: 0,
        z: z++,
        faceUp: true,
        playable: fromTop === 0 && enJuego,
        from: { pile: PILE.WASTE },
      });
    });

    state.foundations.forEach((pile, index) => {
      const x = colX(COLUMNA.foundation(index), m);
      pile.forEach((card, i) => {
        positions.set(card.id, {
          x, y: 0, z: z++, faceUp: true,
          playable: i === pile.length - 1 && enJuego,
          from: { pile: PILE.FOUNDATION, index },
        });
      });
    });

    state.tableau.forEach((pile, index) => {
      const x = colX(index, m);
      // Los escalones ya vienen ajustados de `measure`, y son los mismos para las
      // siete columnas: apretar solo la larga las dejaría descuadradas entre sí.
      let y = m.tableauY;
      pile.forEach((card, i) => {
        if (i > 0) y += pile[i - 1].faceUp ? m.stepUp : m.stepDown;
        positions.set(card.id, {
          x, y, z: z++, faceUp: card.faceUp,
          playable: card.faceUp && enJuego && engine.isValidRun(pile, i),
          from: { pile: PILE.TABLEAU, index },
          offset: i,
        });
      });
      columns.push({ index, x, top: m.tableauY, bottom: y + m.ch });
    });

    return { m, positions, columns };
  }

  /**
   * Una carta que se está moviendo tiene que ir por encima de las demás: su
   * z-index natural es el del sitio al que va, y por el camino cruza columnas
   * que están más arriba en la pila. Se le sube mientras dura la transición.
   */
  function soltarVuelo(el) {
    if (!el) return;
    el.classList.remove('volando');
    el.style.removeProperty('--vuelo-ms');
    el.style.removeProperty('--vuelo-espera');
    el.style.removeProperty('--alza');
    el.style.removeProperty('--giro');
  }

  function alzar(id, duracion = vueloMs(), espera = 0, dist = 0, dx = 0) {
    clearTimeout(volando.get(id));
    const el = els.get(id);
    if (el) {
      // La animación del levantamiento dura exactamente lo que el vuelo: así la
      // carta despega al salir y se posa justo al llegar, en vez de seguir
      // subiendo con la jugada ya hecha.
      el.style.setProperty('--vuelo-ms', `${duracion}ms`);
      el.style.setProperty('--vuelo-espera', `${espera}ms`);
      el.style.setProperty('--alza', `-${motion.alturaVuelo(dist)}px`);
      el.style.setProperty('--giro', `${motion.giroVuelo(dx)}deg`);
      // Volver a poner una clase que ya estaba no reinicia su animación, y en
      // una cascada la segunda carta se quedaba sin levantarse.
      if (el.classList.contains('volando')) {
        el.classList.remove('volando');
        void el.offsetWidth;
      }
      el.classList.add('volando');
    }
    volando.set(id, setTimeout(() => {
      volando.delete(id);
      if (!el) return;
      soltarVuelo(el);
      // Si para cuando aterriza el jugador la tiene cogida, el z lo manda el
      // arrastre: devolverle el suyo la hundía por debajo del tablero.
      if (drag?.ids.includes(id)) return;
      if (el.dataset.z != null) el.style.zIndex = el.dataset.z;
    }, duracion + espera + 30));
  }

  /**
   * Una carta que el jugador coge deja de estar volando: la animación del vuelo
   * fija `translate`, `scale` y la sombra mientras dura, y una animación gana a
   * las declaraciones, así que la carta se quedaba pegada a la mesa en la mano
   * hasta que vencía el temporizador y entonces pegaba un salto.
   */
  function aterrizar(id) {
    clearTimeout(volando.get(id));
    volando.delete(id);
    const el = els.get(id);
    if (!el) return;
    soltarVuelo(el);
  }

  /** Marca el volteo para que la carta se levante mientras se da la vuelta. */
  function marcarVolteo(id, retraso = 0) {
    const el = els.get(id);
    if (!el) return;
    clearTimeout(volteos.get(id));
    const ejecutar = () => {
      if (el.classList.contains('volteando')) {
        el.classList.remove('volteando');
        void el.offsetWidth;
      }
      el.classList.add('volteando');
      volteos.set(id, setTimeout(() => {
        volteos.delete(id);
        el.classList.remove('volteando');
      }, volteoMs() + 30));
    };
    if (retraso > 0) {
      volteos.set(id, setTimeout(ejecutar, retraso));
    } else {
      ejecutar();
    }
  }

  /**
   * Deja de tapar a las que venían del mazo. La cara se la da su sitio de ahora,
   * no el que tenían al salir: si por el camino la jugada se deshizo, la carta
   * ha vuelto al mazo y ahí sigue boca abajo.
   */
  function destaparRobada(id) {
    if (!robadas.delete(id)) return;
    if (!layout?.positions.get(id)?.faceUp) return;
    caras.set(id, false);
    els.get(id)?.classList.remove('down');
  }

  /** Corta el robo escalonado que hubiera a medias. */
  function cortarRobo() {
    relojesRobo.forEach(clearTimeout);
    relojesRobo = [];
    for (const id of [...robadas]) destaparRobada(id);
    robadas.clear();
  }

  const PASO_RECICLADO = 12;

  /**
   * Al reciclar el descarte entero hacia el mazo, las cartas se recogen en
   * cascada escalonada en vez de salir todas de golpe en bloque monolítico.
   */
  function retrasosDelReciclado(state, mazoX, wasteX) {
    if (!state.stock.length) return null;
    const delDescarte = state.stock.filter((card) => {
      const antes = posiciones.get(card.id);
      return antes && Math.abs(antes.x - wasteX) < 1 && antes.y <= ALTO_MAZO + 1;
    });
    if (!delDescarte.length) return null;
    const mapa = new Map();
    const paso = Math.max(6, Math.min(PASO_RECICLADO, Math.floor(160 / delDescarte.length)));
    delDescarte.forEach((card, i) => mapa.set(card.id, i * paso));
    return mapa;
  }

  /**
   * Las cartas que acaban de salir del mazo, con lo que tiene que esperar cada
   * una. Robando de tres no salen las tres a la vez: en la mesa se reparten de
   * una en una, y mientras vuelan siguen boca abajo —se destapan al llegar al
   * descarte, que es cuando el jugador ve lo que le ha tocado—.
   */
  function retrasosDelRobo(state, mazoX) {
    const n = Math.min(state.drawCount ?? 1, state.waste.length);
    if (!n) return null;
    // De las de arriba del descarte, las que estaban en el montón del mazo. Hay
    // que mirar también la Y: `COLUMNA.stock` es 6, o sea que el mazo y la
    // séptima columna caen en la misma X, y sin la Y una carta que vuelve del
    // tableau al descarte (deshacer) se tomaba por una carta recién robada y
    // salía tapada y con retraso.
    const delMazo = (card) => {
      const antes = posiciones.get(card.id);
      return antes && Math.abs(antes.x - mazoX) < 0.5 && antes.y <= ALTO_MAZO + 0.5;
    };
    // El escalón se cuenta sobre las que de verdad salen, no sobre el tamaño del
    // robo: en la última tanda pueden salir menos de tres, y numerarlas por la
    // ventana las hacía esperar el turno de unas cartas que no existen.
    const salidas = state.waste.slice(-n).filter(delMazo);
    if (!salidas.length) return null;
    const mapa = new Map();
    salidas.forEach((card, i) => mapa.set(card.id, i * ROBO_PASO));
    return mapa;
  }

  /**
   * Que el número del mazo cambie sin más no se ve; el salto de la cifra es lo
   * que dice «has robado». El token evita que un salto viejo apague el de ahora.
   */
  function acusarMazo(n) {
    if (ultimoMazo === n) return;
    const primerPintado = ultimoMazo === null;
    ultimoMazo = n;
    if (primerPintado) return;      // colocar el tablero no es robar
    clearTimeout(bumpTimer);
    contador.classList.remove('bump');
    void contador.offsetWidth;      // reinicia la animación
    contador.classList.add('bump');
    bumpTimer = setTimeout(() => contador.classList.remove('bump'), BUMP_MS);
  }

  function paint({ vuelo = true } = {}) {
    const state = game.state;
    if (!state) return;
    layout = computeLayout(state);
    const { m, positions } = layout;

    const style = document.documentElement.style;
    style.setProperty('--cw', `${m.cw}px`);
    style.setProperty('--ch', `${m.ch}px`);
    style.setProperty('--gap', `${m.gap}px`);

    for (const slot of slots) {
      const pile = slot.dataset.pile;
      const index = Number(slot.dataset.index || 0);
      const x = pile === 'stock' ? colX(COLUMNA.stock, m)
        : pile === 'waste' ? colX(COLUMNA.waste, m)
          : pile === 'foundation' ? colX(COLUMNA.foundation(index), m)
            : colX(index, m);
      const y = pile === 'tableau' ? m.tableauY : 0;
      slot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }

    const stock = slotFor('stock');
    stock.classList.toggle('empty', state.stock.length === 0);
    stock.classList.toggle('dead', state.stock.length === 0 && !engine.isLegal(state, { type: 'recycle' }));

    const mazoX = colX(COLUMNA.stock, m);
    const wasteX = colX(COLUMNA.waste, m);
    if (contador) {
      // Con el mazo vacío el hueco ya enseña su flecha de reciclar: un cero ahí solo estorba.
      contador.hidden = state.stock.length === 0;
      contador.firstElementChild.textContent = String(state.stock.length);
      contador.style.transform = `translate3d(${mazoX}px, 0, 0)`;
      acusarMazo(state.stock.length);
    }
    // El robo escalonado se decide antes del bucle: hay que mirar el descarte
    // entero para saber cuál sale primero, y dentro del bucle solo se aplica.
    const retrasos = vuelo && animando() ? retrasosDelRobo(state, mazoX) : null;
    const retrasosReciclar = vuelo && animando() ? retrasosDelReciclado(state, mazoX, wasteX) : null;
    if (retrasos) { cortarRobo(); for (const id of retrasos.keys()) robadas.add(id); }

    for (const [id, el] of els) {
      const p = positions.get(id);
      if (!p) { el.style.visibility = 'hidden'; continue; }
      el.style.visibility = '';
      const sinRepartir = enMazo?.has(id);
      el.dataset.z = String(p.z);
      if (!drag || !drag.ids.includes(id)) {
        const x = sinRepartir ? mazoX : p.x;
        const y = sinRepartir ? 0 : p.y;
        // Se comparan números y no `style.transform`: el navegador reescribe lo
        // que le pasas (el `0` sale como `0px`), así que comparar cadenas daba
        // siempre "se ha movido" y levantaba las 52 cartas a la vez, que es como
        // no levantar ninguna.
        const antes = posiciones.get(id);
        const seMueve = antes && (Math.abs(antes.x - x) > 0.5 || Math.abs(antes.y - y) > 0.5);
        const snap = snapbacks.get(id);
        if (vuelo && (seMueve || snap) && animando()) {
          const dx = snap ? snap.dx : (x - antes.x);
          const dist = snap ? snap.dist : Math.hypot(dx, y - antes.y);
          const dur = snap ? snap.dur : motion.duracionVuelo(dist, vueloMs());
          const espera = retrasos?.get(id) ?? retrasosReciclar?.get(id) ?? 0;
          // Vuelo a la medida de la distancia. Son DOS duraciones porque en la
          // hoja de estilos `.anim .card` transiciona dos propiedades, transform
          // y translate. Si se manda una de más, el navegador la descarta —se
          // emparejan por índice—, así que el segundo valor tiene que estar.
          el.style.transitionDuration = `${dur}ms, 140ms`;
          el.style.transitionDelay = espera ? `${espera}ms, ${espera}ms` : '';
          alzar(id, dur, espera, dist, dx);
          if (espera || robadas.has(id)) programarRobo(id, dur + espera);
        } else {
          if (el.style.transitionDuration) el.style.transitionDuration = '';
          if (el.style.transitionDelay) el.style.transitionDelay = '';
        }
        snapbacks.delete(id);
        posiciones.set(id, { x, y });
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        // Sumar p.z mantiene el orden entre las cartas que vuelan a la vez
        // (una secuencia arrastrada llega en el mismo orden en que iba).
        el.style.zIndex = String(volando.has(id) ? Z_VUELO + p.z : p.z);
      }
      // Boca abajo si la carta lo está, si aún no ha llegado a su sitio en el
      // reparto o si viene volando del mazo y todavía no ha aterrizado.
      const abajo = !p.faceUp || !!tapadas?.has(id) || robadas.has(id);
      const antesAbajo = caras.get(id);
      if (antesAbajo !== undefined && antesAbajo !== abajo && animando()) {
        const delay = (antesAbajo && !abajo && p.from?.pile === PILE.TABLEAU) ? 80
          : (retrasosReciclar?.has(id) ? ((retrasosReciclar.get(id) ?? 0) + 60) : 0);
        marcarVolteo(id, delay);
      }
      caras.set(id, abajo);
      el.classList.toggle('down', abajo);
      el.classList.toggle('playable', !!p.playable);
      if (!drag || !drag.ids.includes(id)) el.classList.remove('dragging');
    }

    // `measure` ya ha encogido escalones y carta para que esto quepa en el alto
    // útil del contenedor: aquí solo se recoge el resultado, sin sorpresas.
    root.style.minHeight = `${Math.max(...layout.columns.map((c) => c.bottom), m.ch)}px`;
  }

  // --- reparto animado ---

  // Hacen falta las dos: la preferencia manda, y sin la clase `anim` no hay
  // transición en CSS, así que escalonar las cartas solo daría saltos secos.
  const animando = () => game.prefs.animations !== false
    && root.classList.contains('anim')
    && !matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Un tiempo de la hoja de estilos, en milisegundos. */
  function tiempoCss(variable, reserva) {
    const valor = window.getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    const numero = parseFloat(valor);
    if (!Number.isFinite(numero)) return reserva;
    return valor.endsWith('s') && !valor.endsWith('ms') ? numero * 1000 : numero;
  }

  /** Cuánto tarda una carta en volar, según la hoja de estilos. */
  const vueloMs = () => tiempoCss('--card-speed', VUELO_POR_DEFECTO);
  /** Y cuánto tarda en darse la vuelta. */
  const volteoMs = () => tiempoCss('--flip-speed', VOLTEO_POR_DEFECTO);

  /** La carta robada se destapa al aterrizar en el descarte, no al despegar. */
  function programarRobo(id, cuando) {
    relojesRobo.push(setTimeout(() => {
      if (!robadas.has(id)) return;
      const enElDescarte = layout?.positions.get(id)?.faceUp;
      destaparRobada(id);
      if (enElDescarte) marcarVolteo(id);
    }, cuando));
  }

  /** El orden en que se reparte de verdad: por filas, no columna a columna. */
  function ordenDeReparto(state) {
    const orden = [];
    for (let fila = 0; fila < 7; fila++) {
      for (let col = fila; col < 7; col++) {
        const card = state.tableau[col][fila];
        if (card) orden.push(card.id);
      }
    }
    return orden;
  }

  function cancelarFrameReparto() {
    const frame = repartoFrame;
    if (!frame) return;
    repartoFrame = null;
    if (frame.raf && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(frame.id);
    } else {
      clearTimeout(frame.id);
    }
  }

  function programarFrameReparto(epoca, version) {
    if (repartoFrame) return;

    const frame = { id: null, raf: typeof window.requestAnimationFrame === 'function' };
    repartoFrame = frame;
    const pintar = () => {
      // `cancelAnimationFrame` no garantiza que no llegue un callback que ya
      // estaba encolado: la identidad del frame lo vuelve inocuo si aparece.
      if (repartoFrame !== frame) return;
      repartoFrame = null;
      if (repartoVersion !== version) return;
      if (game.epoch !== epoca) { cortarReparto(); return; }
      paint();
    };

    frame.id = frame.raf
      ? window.requestAnimationFrame(pintar)
      : setTimeout(pintar, 0);
  }

  function cortarReparto({ pintar = true } = {}) {
    repartoVersion += 1;
    cancelarFrameReparto();
    if (!relojes.length && !enMazo && !tapadas) return;
    relojes.forEach(clearTimeout);
    relojes = [];
    enMazo = null;
    tapadas = null;
    if (pintar) paint();
  }

  /** Al cambiar el tamaño se recolocan todas: eso no es que estén volando. */
  function repintarSinVuelo() {
    for (const [id, reloj] of volando) {
      clearTimeout(reloj);
      soltarVuelo(els.get(id));
    }
    volando = new Map();
    posiciones = new Map();
    // Un robo a medias se planta: sus temporizadores contaban con las posiciones
    // de antes de recolocar, y sin esto la carta se quedaría boca abajo.
    cortarRobo();
    paint({ vuelo: false });
  }

  /**
   * Las 28 cartas del tableau salen del mazo de una en una, como en la mesa, y
   * cada una se destapa al llegar. Un toque en cualquier sitio se lo salta.
   */
  function repartir() {
    ultimoMazo = null;      // un reparto nuevo no es una carta robada: el contador no salta
    cortarReparto({ pintar: false });
    // Y el robo del reparto anterior, también: sus temporizadores llegaban con
    // las cartas ya barajadas y destapaban una que estaba sobre el mazo nuevo.
    cortarRobo();
    if (!animando()) { paint(); return; }

    const orden = ordenDeReparto(game.state);
    if (!orden.length) { paint(); return; }
    enMazo = new Set(orden);
    tapadas = new Set(orden);

    // El montón se planta sobre el mazo de golpe: animar también la recogida
    // haría que las primeras cartas salieran mientras las últimas aún llegan.
    root.classList.remove('anim');
    paint({ vuelo: false });
    void root.offsetWidth;         // fuerza el reflow para que el salto no se anime
    root.classList.add('anim');

    const epoca = game.epoch;
    const version = repartoVersion;
    const vuelo = vueloMs();
    const programar = (ms, fn) => relojes.push(setTimeout(() => {
      if (repartoVersion !== version) return;
      if (game.epoch !== epoca) { cortarReparto(); return; }   // el jugador se adelantó
      fn();
      programarFrameReparto(epoca, version);
    }, ms));

    // Cada carta se destapa cuando aterriza, no cuando aterrizaría la que más
    // lejos va: la primera columna está al otro lado de la mesa y la última cae
    // pegada al mazo. Con un tiempo único, media docena de cartas se quedaban
    // boca abajo un cuarto de segundo después de haber llegado.
    const donde = computeLayout(game.state);
    const salida = colX(COLUMNA.stock, donde.m);
    const vueloDe = (id) => {
      const p = donde.positions.get(id);
      return p ? motion.duracionVuelo(Math.hypot(p.x - salida, p.y), vuelo) : vuelo;
    };

    orden.forEach((id, i) => {
      programar(i * REPARTO_PASO, () => enMazo?.delete(id));
      programar(i * REPARTO_PASO + vueloDe(id), () => {
        tapadas?.delete(id);
        if (tapadas && !tapadas.size) { enMazo = null; tapadas = null; }
      });
    });
  }

  // --- zonas donde se puede soltar ---
  function dropZones() {
    const rect = root.getBoundingClientRect();
    const { m, columns } = layout;
    const zones = [];
    for (let i = 0; i < 4; i++) {
      zones.push({
        to: { pile: PILE.FOUNDATION, index: i },
        left: rect.left + colX(COLUMNA.foundation(i), m), top: rect.top,
        right: rect.left + colX(COLUMNA.foundation(i), m) + m.cw, bottom: rect.top + m.ch,
      });
    }
    for (const c of columns) {
      zones.push({
        to: { pile: PILE.TABLEAU, index: c.index },
        left: rect.left + c.x, top: rect.top + c.top,
        right: rect.left + c.x + m.cw, bottom: rect.top + Math.max(c.bottom, c.top + m.ch),
      });
    }
    return zones;
  }

  const overlap = (a, z) => {
    const w = Math.min(a.right, z.right) - Math.max(a.left, z.left);
    const h = Math.min(a.bottom, z.bottom) - Math.max(a.top, z.top);
    return w > 0 && h > 0 ? w * h : 0;
  };

  function bestZone(cardRect) {
    let best = null;
    for (const z of dropZones()) {
      const area = overlap(cardRect, z);
      if (area > 0 && (!best || area > best.area)) best = { zone: z, area };
    }
    return best?.zone ?? null;
  }

  // --- coger cartas ---
  function grabbable(id) {
    const p = layout?.positions.get(id);
    if (!p || !p.playable || !p.from) return null;
    if (p.from.pile === PILE.TABLEAU) {
      const pile = game.state.tableau[p.from.index];
      return { from: p.from, count: pile.length - p.offset };
    }
    return { from: p.from, count: 1 };
  }

  /**
   * La carta jugable cuyo centro cae más cerca del punto, si es que hay alguna a
   * tiro. Con las columnas casi pegadas el dedo se come el filo de la carta de al
   * lado —casi siempre una tapada, que no hace nada— y el toque se pierde: esto
   * rescata la intención sin llegar a adivinar.
   */
  function cartaMasCercana(x, y) {
    if (!layout) return null;
    const { m, positions } = layout;
    const rect = root.getBoundingClientRect();
    let mejor = null;
    for (const [id, p] of positions) {
      if (!p.playable || !p.from) continue;
      const dist = Math.hypot(x - (rect.left + p.x + m.cw / 2), y - (rect.top + p.y + m.ch / 2));
      if (dist <= CERCANIA && (!mejor || dist < mejor.dist)) mejor = { id, dist };
    }
    return mejor?.id ?? null;
  }

  function pileOf(from) {
    if (!from) return null;
    if (from.pile === PILE.WASTE) return game.state.waste;
    if (from.pile === PILE.FOUNDATION) return game.state.foundations[from.index];
    if (from.pile === PILE.TABLEAU) return game.state.tableau[from.index];
    return null;
  }

  function idsOf(grab) {
    const pile = pileOf(grab.from);
    if (!pile || grab.count > pile.length) return [];
    return pile.slice(pile.length - grab.count).map((c) => c.id);
  }

  /**
   * ¿Las cartas anotadas siguen siendo las de arriba de su pila? Entre que se cogen
   * y se sueltan pueden haber cambiado (otro dedo, el teclado, deshacer, autoSafe),
   * y jugar con la referencia vieja movería una carta distinta a la que se ve.
   */
  function sigueValida(ref) {
    if (!ref?.ids?.length) return false;
    const ahora = idsOf(ref);
    return ahora.length === ref.ids.length && ahora.every((id, i) => id === ref.ids[i]);
  }

  function highlightTargets(grab) {
    for (const slot of slots) {
      const pile = slot.dataset.pile;
      if (pile !== 'tableau' && pile !== 'foundation') continue;
      const to = { pile, index: Number(slot.dataset.index) };
      const legal = engine.isLegal(game.state, { type: 'move', from: grab.from, to, count: grab.count });
      slot.classList.toggle('drop-ok', legal);
    }
  }

  const clearHighlights = () => slots.forEach((s) => s.classList.remove('drop-ok'));

  /**
   * Con ratón no hace falta pulsar nada para ver dónde cabe una carta: basta con
   * pasar por encima. Con el dedo no existe ese «encima», y por eso ahí los
   * destinos salen en cuanto se apoya —lo hace `startDrag`— y siguen puestos
   * mientras no se levante, que es lo que se espera de una pulsación mantenida.
   */
  function resaltarAlPasar(id) {
    if (drag || resaltada === id) return;
    const grab = id ? grabbable(id) : null;
    if (!grab) { quitarResaltado(); return; }
    resaltada = id;
    highlightTargets(grab);
  }

  function quitarResaltado() {
    if (!resaltada) return;
    resaltada = null;
    if (!drag) clearHighlights();   // en pleno arrastre las marcas son del arrastre
  }

  function startDrag(event, id, grab) {
    const ids = idsOf(grab);
    if (!ids.length) return;
    grab.ids = ids;
    drag = {
      ids, grab, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      lastX: event.clientX, lastY: event.clientY,
      lastTime: performance.now(),
      tilt: 0,
      bases: ids.map((cid) => {
        const p = layout.positions.get(cid);
        return { id: cid, x: p.x, y: p.y };
      }),
      moved: false, id,
    };
    ids.forEach((cid, i) => {
      aterrizar(cid);                 // en la mano ya no vuela: manda el arrastre
      const el = els.get(cid);
      el.classList.add('dragging');
      el.style.zIndex = String(Z_ARRASTRE + i);
    });
    resaltada = null;       // a partir de aquí las marcas son del arrastre
    highlightTargets(grab);
  }

  function moveDrag(event) {
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;

    // Balanceo dinámico según la velocidad del arrastre (inercia y resistencia física)
    const now = performance.now();
    const dt = Math.max(16, now - (drag.lastTime || now));
    const vx = (event.clientX - (drag.lastX ?? event.clientX)) / dt;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = now;

    const targetTilt = Math.max(-5, Math.min(5, vx * 12));
    drag.tilt = drag.tilt * 0.65 + targetTilt * 0.35;
    const baseGiro = animando() ? Math.round(drag.tilt * 10) / 10 : 0;

    for (let i = 0; i < drag.bases.length; i++) {
      const base = drag.bases[i];
      const el = els.get(base.id);
      if (!el) continue;
      // Las cartas inferiores de la secuencia llevan un sutil ladeo acentuado simulando flexibilidad
      const giro = animando() ? Math.round((baseGiro * (1 + i * 0.08)) * 10) / 10 : 0;
      const rot = giro ? ` rotate(${giro}deg)` : '';
      el.style.transform = `translate3d(${base.x + dx}px, ${base.y + dy}px, 0)${rot}`;
    }
  }

  /** Se suelta fuera, el sistema se queda el puntero o llega otro dedo: no se juega nada. */
  function cancelDrag() {
    if (!drag) return;
    const { ids, bases, moved, startX, startY, lastX, lastY } = drag;
    // Si se había movido, registrar el retorno proporcional con la distancia recorrida
    if (moved && animando() && bases?.length) {
      const curDx = (lastX ?? startX) - startX;
      const curDy = (lastY ?? startY) - startY;
      const dist = Math.hypot(curDx, curDy);
      const dur = motion.duracionVuelo(dist, vueloMs());
      ids.forEach((cid) => snapbacks.set(cid, { dx: curDx, dist, dur }));
    }
    ids.forEach((cid) => {
      const el = els.get(cid);
      el?.classList.remove('dragging');
      if (el) el.style.transitionDuration = '';   // la vuelta va al ritmo de siempre
      if (animando()) alzar(cid);       // vuelve volando desde donde estuviera el dedo
    });
    clearHighlights();
    drag = null;
    paint();
  }

  function endDrag(event) {
    const { ids, grab, moved, id, bases, startX, startY, lastX, lastY } = drag;
    ids.forEach((cid) => {
      const el = els.get(cid);
      el.classList.remove('dragging');
      el.style.transitionDuration = '';      // la vuelta va al ritmo de siempre
      if (moved && animando()) alzar(cid);   // el trayecto de vuelta también va por arriba
    });
    clearHighlights();
    drag = null;

    if (!moved) {
      const jugado = tapCard(id, grab, event.clientX, event.clientY);
      if (!jugado) paint();
      return;
    }

    if (!sigueValida(grab)) { paint(); return; }   // el tablero cambió mientras arrastrábamos

    const curDx = (lastX ?? event.clientX) - startX;
    const curDy = (lastY ?? event.clientY) - startY;
    const dist = Math.hypot(curDx, curDy);
    const dur = motion.duracionVuelo(dist, vueloMs());

    const rect = els.get(ids[0]).getBoundingClientRect();
    const zone = bestZone({
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    }) ?? bestZone({
      left: event.clientX - 1, top: event.clientY - 1, right: event.clientX + 1, bottom: event.clientY + 1,
    });

    let exito = false;
    if (zone) {
      const move = { type: 'move', from: grab.from, to: zone.to, count: grab.count };
      const subeCarta = grab.count === 1 && grab.from.pile !== PILE.FOUNDATION;
      exito = game.play(move);
      if (!exito) {
        // Soltó sobre la fundación equivocada: se prueba la suya antes de negar.
        const colada = subeCarta && zone.to.pile === PILE.FOUNDATION
          && game.sendToFoundation(grab.from, ids[0]);
        if (!colada) {
          onDropIlegal({ from: grab.from, to: zone.to, count: grab.count });
        } else {
          exito = true;
        }
      }
    }

    // Si soltó fuera o la jugada no fue legal, la vuelta es un retorno proporcional
    if (!exito && animando() && bases?.length) {
      ids.forEach((cid) => snapbacks.set(cid, { dx: curDx, dist, dur }));
    }

    paint();
  }

  /**
   * A dónde va la carta que se pica cuando no hay una pista activa. Una fundación
   * legal tiene prioridad aunque sea arriesgada; así el toque no convierte una
   * jugada válida en otra columna distinta. Si hay una pista para esa carta,
   * `jugadaSugerida` conserva el destino que acaba de señalar.
   */
  function mejorDestino(ref) {
    return advisor.mejorDestinoPara(game.state, ref.from, ref.count, { preferFoundation: true })?.move ?? null;
  }

  /** Un toque en la palma, si el jugador lo quiere y el aparato sabe darlo. */
  function vibrar(patron) {
    if (game.prefs.haptics === false) return;
    globalThis.navigator?.vibrate?.(patron);
  }

  let nopeTimer = null;

  function negar(id) {
    onNegar();
    vibrar([12, 40, 12]);      // dos golpes secos: el «no» se nota sin mirar
    const el = els.get(id);
    if (!el) return;
    clearTimeout(nopeTimer);                  // un aviso viejo no puede apagar el nuevo
    for (const otro of els.values()) otro.classList.remove('nope');
    void el.offsetWidth;
    el.classList.add('nope');
    nopeTimer = setTimeout(() => el.classList.remove('nope'), 400);
  }

  /**
   * Picar una carta la lleva sola a donde pueda. Si quieres elegir el sitio —dos
   * huecos libres, dos columnas donde encaja— arrástrala.
   */
  function tapCard(id, grab, x, y) {
    if (!grab) return;
    // El segundo clic de un doble clic cae en el mismo sitio, sobre la carta que
    // acaba de quedar al descubierto: se ignora. Un toque en otro punto, no.
    if (Date.now() - ultimoAuto.at < DOUBLE_TAP_MS
      && Math.hypot(x - ultimoAuto.x, y - ultimoAuto.y) < 24) return false;

    // Si la pista está señalando justo esta carta, se hace lo que la pista dice.
    // Es la regla que impide que señale un sitio y el dedo la lleve a otro: pasaba
    // al ciclar entre alternativas (misma carta, destino distinto) y, con el
    // rescate, al marcar una carta de las pilas de arriba que el toque rechazaba.
    const sugerida = jugadaSugerida(grab);
    if (sugerida) {
      if (game.play(sugerida)) {
        ultimoAuto = { at: Date.now(), x, y };
        vibrar(8);
        return true;
      }
      return false;
    }

    if (grab.from.pile === PILE.FOUNDATION) {
      onMessage('msg.fundacion.arrastrar');
      return false;
    }

    const ref = { ...grab, ids: grab.ids ?? idsOf(grab) };
    if (!sigueValida(ref)) return false;      // el tablero cambió entre el toque y el dedo levantado

    const move = mejorDestino(ref);
    if (!move) {
      negar(id);
      onMessage(ref.count > 1 ? 'msg.sin.jugada.secuencia' : 'msg.sin.jugada');
      return false;
    }
    if (game.play(move)) {
      ultimoAuto = { at: Date.now(), x, y };
      vibrar(8);      // la carta ya va a su sitio: un golpecito y a otra cosa
      return true;
    }
    return false;
  }

  /** Los huecos ya no reciben cartas por toque; el único que hace algo es el mazo. */
  function tapSlot(slot) {
    if (slot.dataset.pile === 'stock') game.stockClick();
  }

  // --- eventos ---
  root.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    if (enMazo) { event.preventDefault(); cortarReparto(); return; }   // sin esperar al reparto
    if (drag) { cancelDrag(); return; }     // un segundo dedo cancela, no juega dos veces
    if (game.status !== 'playing' && game.status !== 'stuck') return;
    const cardEl = event.target.closest('.card');
    if (cardEl) {
      let id = cardEl.dataset.id;
      let grab = grabbable(id);
      if (!grab) {
        // Carta tapada del tableau o del mazo: solo cuenta si es el mazo.
        const p = layout?.positions.get(id);
        if (p && !p.from) { game.stockClick(); return; }   // carta boca abajo del mazo
        // Si no, puede ser puntería: en pantallas estrechas la jugable de al lado
        // está a un pelo y es a la que iba el dedo.
        const cerca = cartaMasCercana(event.clientX, event.clientY);
        grab = cerca ? grabbable(cerca) : null;
        if (!grab) return;
        id = cerca;
      }
      event.preventDefault();
      root.setPointerCapture?.(event.pointerId);
      startDrag(event, id, grab);
      return;
    }
    const slot = event.target.closest('.slot');
    if (slot) { event.preventDefault(); tapSlot(slot); }
  });

  // Solo el ratón: con el dedo, `pointerover` llega pegado al `pointerdown` y
  // resaltaría lo mismo que ya resalta la pulsación, además de dejar las marcas
  // encendidas después de levantar el dedo, que no tiene dónde «salirse».
  root.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'mouse') return;
    if (game.status !== 'playing' && game.status !== 'stuck') return;
    resaltarAlPasar(event.target.closest?.('.card')?.dataset.id ?? null);
  });

  root.addEventListener('pointerout', (event) => {
    // Ir de una carta a otra dispara `out` antes que `over`: aquí solo se apaga
    // cuando el puntero se va del tablero; lo de dentro lo arregla el `over`.
    if (event.pointerType !== 'mouse') return;
    if (event.relatedTarget && root.contains(event.relatedTarget)) return;
    quitarResaltado();
  });

  root.addEventListener('pointermove', (event) => {
    if (drag && event.pointerId === drag.pointerId) moveDrag(event);
  });

  root.addEventListener('pointerup', (event) => {
    if (drag && event.pointerId === drag.pointerId) endDrag(event);
  });
  const cancelar = (event) => { if (drag && event.pointerId === drag.pointerId) cancelDrag(); };
  root.addEventListener('pointercancel', cancelar);
  root.addEventListener('lostpointercapture', cancelar);
  window.addEventListener('blur', cancelDrag);
  root.addEventListener('contextmenu', (event) => { if (drag) event.preventDefault(); });
  root.addEventListener('dblclick', (event) => event.preventDefault());

  // --- api ---
  let pistaTimer = null;
  let pistaEls = [];              // lo marcado por la pista que está activa
  let pistaMove = null;           // la jugada que está señalando, para que el toque la respete
  let pistaEpoch = -1;            // en qué versión del tablero se pidió

  /**
   * ¿Está la pista señalando estas cartas? Solo cuenta si sigue viva y si el
   * tablero no ha cambiado desde que se pidió.
   *
   * No se exige que el toque coja exactamente las mismas cartas: la pista marca
   * la secuencia entera, y quien toca una carta de en medio está señalando esa
   * misma jugada. Pedir que `count` coincidiera dejaba fuera justo ese caso y la
   * carta se iba a otro sitio del que estaba latiendo.
   */
  function jugadaSugerida(grab) {
    if (!pistaMove || pistaEpoch !== game.epoch) return null;
    if (pistaMove.type !== 'move') return null;
    const mismoOrigen = pistaMove.from.pile === grab.from.pile
      && (pistaMove.from.index ?? null) === (grab.from.index ?? null);
    if (!mismoOrigen || !engine.isLegal(game.state, pistaMove)) return null;
    // Y que la carta tocada sea de verdad una de las marcadas.
    const marcadas = idsOf({ from: pistaMove.from, count: pistaMove.count ?? 1 });
    const cogidas = idsOf(grab);
    return cogidas.some((id) => marcadas.includes(id)) ? pistaMove : null;
  }

  /** Retira la pista que haya: ninguna marca ni ningún temporizador viejo. */
  function quitarPista() {
    clearTimeout(pistaTimer);
    pistaMove = null;
    for (const [el, clase] of pistaEls) el?.classList.remove(clase);
    pistaEls = [];
  }

  const api = {
    paint,
    /** Corta cualquier gesto o reparto a medias (la tecla Escape, y las pruebas). */
    cancel() {
      cortarReparto({ pintar: false });
      cortarRobo();
      cancelDrag();
      resaltada = null;
      clearHighlights();
      quitarPista();
      ultimoAuto = { at: 0, x: 0, y: 0 };   // el guardián del doble clic también se suelta
      paint();
    },
    /** Deja el tablero colocado ya, sin nada en el aire. */
    settle() { repintarSinVuelo(); },
    /** Lo que tarda una carta en ir de un sitio a otro, según la hoja de estilos. */
    get flightMs() { return vueloMs(); },
    get repartiendo() { return !!enMazo; },
    /**
     * Marca la jugada sugerida: la carta que hay que tocar late fuerte y el
     * sitio al que va, flojito. Así se distingue de un vistazo qué se pica.
     * Solo hay una pista a la vez: pedir otra (o cancelar) se lleva la anterior.
     */
    flashHint(move) {
      quitarPista();
      if (!move) return;
      const marcar = (el, clase = 'hint') => {
        if (!el) return;
        el.classList.remove('hint', 'hint-destino');
        void el.offsetWidth;      // reinicia la animación
        el.classList.add(clase);
        pistaEls.push([el, clase]);
      };
      // Robar señala la carta de arriba del montón, no el hueco que hay debajo:
      // el hueco lo tapan las cartas y el anillo se quedaba enterrado. Solo
      // cuando el mazo está vacío —reciclar— la marca es la del hueco.
      if (move.type === 'draw' || move.type === 'recycle') {
        const arriba = engine.top(game.state.stock);
        marcar(arriba ? els.get(arriba.id) : slotFor('stock'));
      }
      else {
        for (const id of idsOf({ from: move.from, count: move.count ?? 1 })) marcar(els.get(id));
        if (move.to.pile === PILE.FOUNDATION || move.to.pile === PILE.TABLEAU) {
          const destino = move.to.pile === PILE.FOUNDATION
            ? slotFor('foundation', move.to.index)
            : slotFor('tableau', move.to.index);
          if (destino && (move.to.pile === PILE.FOUNDATION ? game.state.foundations[move.to.index].length === 0
            : game.state.tableau[move.to.index].length === 0)) marcar(destino, 'hint-destino');
          else {
            const pila = move.to.pile === PILE.FOUNDATION ? game.state.foundations[move.to.index] : game.state.tableau[move.to.index];
            marcar(els.get(engine.top(pila)?.id), 'hint-destino');
          }
        }
      }
      pistaMove = move;
      pistaEpoch = game.epoch;
      pistaTimer = setTimeout(quitarPista, PISTA_MS);
    },
  };

  let ultimoReparto = game.dealId;
  game.subscribe(() => {
    // La pista señala una posición concreta: en cuanto el tablero cambia, esas
    // marcas están sobre cartas que ya no están ahí. Sin esto, pedir pista y
    // repartir dejaba dos cartas del reparto anterior latiendo sobre el nuevo.
    if (pistaMove && pistaEpoch !== game.epoch) quitarPista();
    if (game.dealId === ultimoReparto) return;
    ultimoReparto = game.dealId;
    repartir();
  });

  window.addEventListener('resize', repintarSinVuelo);
  window.addEventListener('orientationchange', repintarSinVuelo);
  return api;
}
