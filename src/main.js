// Arranque: monta el juego, la barra superior, el teclado y los diálogos.
// Aquí no se escribe ni una frase a mano: todo texto sale de i18n por su clave,
// y este fichero es el único que traduce lo que le cuentan el tablero y los paneles.

import { createStore } from './storage.js';
import { createGame, formatTime } from './game.js';
import { createBoard } from './ui.js';
import { createPanels } from './panels.js';
import { formatScore } from './scoring.js';
import { isKnownSolvable } from './solvable-seeds.js';
import { claveDia, esJugable, fechaDeClave, semillaDelDia } from './reto.js';
import { PILE } from './engine.js';
import { VERSION } from './version.js';
import { registrarServiceWorker, crearInstalador, esStandalone, esIos } from './pwa.js';
import { crearSonidos } from './sonidos.js';
import * as i18n from './i18n.js';
import * as motion from './motion.js';

const {
  alCambiarIdioma, fechaCorta, fijarIdioma, nombreCarta, nombrePila, resolverIdioma, t, traducirDom,
} = i18n;

const $ = (sel) => document.querySelector(sel);

const store = createStore(globalThis.localStorage);

// El idioma se fija antes de que aparezca un solo texto: el primer aviso y la
// ayuda de bienvenida ya tienen que salir en el idioma del jugador, no en español
// y traducidos un instante después.
fijarIdioma(resolverIdioma(store.getPrefs().lang));
traducirDom();

// El callback se ejecuta más tarde, cuando `game` ya existe.
const sonidos = crearSonidos({ activo: () => game.prefs.sound !== false });
const game = createGame({
  store,
  onEvents: (eventos) => { sonarJugada(eventos); avisarPasadas(eventos); },
});
const board = createBoard({
  root: $('#board'),
  game,
  onMessage: message,
  onNegar: () => sonidos.nada(),
  onDropIlegal: explicarIlegal,
});

/** Cada cosa que pasa en el tablero suena distinta. */
function sonarJugada(eventos) {
  for (const ev of eventos) {
    if (ev.type === 'draw') sonidos.robar();
    else if (ev.type === 'recycle') sonidos.barajar();
    else if (ev.type === 'flip') sonidos.voltear();
    else if (ev.type === 'move') {
      if (ev.to === PILE.FOUNDATION) sonidos.fundacion(); else sonidos.colocar();
    }
  }
}

/** En Vegas las pasadas al mazo se cuentan: al reciclar hay que decir cuántas quedan. */
function avisarPasadas(eventos) {
  const reciclado = eventos.find((ev) => ev.type === 'recycle');
  const tope = game.state?.maxRecycles;
  if (!reciclado || !Number.isFinite(tope)) return;
  const quedan = Math.max(0, tope - reciclado.recycles);
  message('msg.mazo.restantes', { count: quedan, n: quedan });
}

// ---------- aplicación instalable ----------

const pwa = registrarServiceWorker({
  onVersionNueva: () => { $('#btn-update-pill').hidden = false; },
});
const instalador = crearInstalador({ onCambio: () => pintarAjustesApp() });

function pintarAjustesApp() {
  $('#app-version').textContent = t('app.version', { version: VERSION });
  const fila = $('#install-row');
  const boton = $('#btn-install');
  if (instalador.puede) {
    fila.hidden = false;
    boton.hidden = false;
    $('#install-hint').textContent = t('app.install.nota');
  } else if (instalador.pistaIos) {
    fila.hidden = false;
    boton.hidden = true;
    $('#install-hint').textContent = t('app.install.ios');
  } else {
    fila.hidden = !esStandalone();
    boton.hidden = true;
    if (esStandalone()) $('#install-hint').textContent = t('app.install.ya');
  }
  $('#btn-update').disabled = !pwa.soportado;
  if (!pwa.soportado) $('#update-hint').textContent = t('app.update.nosoportado');
}

const panels = createPanels({
  game,
  store,
  onMessage: message,
  onPrefsChanged: () => { applyPrefs(); refresh(); },
  onOpenSettings: pintarAjustesApp,
});

async function buscarActualizacion(boton) {
  boton.disabled = true;
  boton.textContent = t('app.update.buscando');
  try {
    const resultado = await pwa.actualizar();
    if (resultado === 'aldia') avisar('app.update.aldia', { version: VERSION });
    else if (resultado === 'primera-vez') avisar('app.update.primera');
    else if (resultado === 'instalando') avisar('app.update.instalando');
    else if (resultado === 'error') avisar('app.update.error', {}, 'err');
    // 'actualizando' recarga la página, no hace falta decir nada
  } catch {
    avisar('app.update.error', {}, 'err');
  } finally {
    boton.disabled = false;
    boton.textContent = t('app.update.buscar');
  }
}

$('#btn-update').addEventListener('click', (event) => buscarActualizacion(event.currentTarget));

$('#btn-update-pill').addEventListener('click', async (event) => {
  const pill = event.currentTarget;
  pill.disabled = true;
  game.flush();                       // la partida se guarda antes de recargar
  const resultado = await pwa.actualizar();
  if (resultado === 'instalando') message('app.update.instalando');
  else if (resultado === 'error') { pill.disabled = false; message('app.update.error.saltar', {}, { aviso: true }); }
  else if (resultado !== 'actualizando') { pill.disabled = false; pill.hidden = true; }
});

$('#btn-install').addEventListener('click', async () => {
  const salida = await instalador.instalar();
  if (salida === 'accepted') avisar('app.install.hecha');
  else if (salida === 'error') avisar('app.install.error', {}, 'err');
  pintarAjustesApp();
});

let bannerTimer = null;
let bannerFijo = null;         // el aviso que no caduca, para reescribirlo si cambia el idioma
let bannerVivo = null;         // el de paso que está puesto ahora, por el mismo motivo
let copiadoTimer = null;
let autoTimer = null;
let winShownFor = null;
let ultimaPuntuacion = null;
let atascadoAvisado = false;
let ultimoReparto = null;      // se fija al arrancar: el primer reparto no suena
let mazoTocado = null;         // el toque que iba al mazo, a la espera de saber si hizo algo

// Lo que se dice cuando la partida se queda sin jugadas. Se queda fijo en el
// tablero: no es un aviso de paso, es el estado en el que está la partida. Y se
// distingue si aún queda el recurso de bajar una carta de arriba: no es lo mismo
// estar atascado que estar muerto.
const sinSalida = () => (game.hasAnyMove ? 'msg.bloqueo.rescate' : 'msg.bloqueo.sinsalida');

function message(clave, params = {}, { aviso = false, fijo = false } = {}) {
  const el = $('#banner');
  const texto = t(clave, params);
  el.textContent = texto;
  el.classList.toggle('warn', aviso);
  clearTimeout(bannerTimer);
  // El aviso fijo se recuerda para poder reescribirlo si cambia el idioma; los de
  // paso pasan por encima sin borrarlo, y un mensaje vacío se lo lleva.
  if (!texto) { bannerFijo = null; bannerVivo = null; }
  else if (fijo) { bannerFijo = { clave, params, aviso }; bannerVivo = null; }
  else {
    bannerVivo = { clave, params, aviso };
    // Al caducar no se borra en seco: si había un aviso fijo —la partida sin
    // salida— se repone. Si no, el cartel de bloqueo desaparecía para siempre en
    // cuanto el jugador tocaba una carta muerta.
    bannerTimer = setTimeout(() => {
      bannerVivo = null;
      // El cartel se reescribe sin tocar su temporizador: reemitir el aviso de paso
  // con message() le regalaría otros 4,2 s de vida solo por cambiar de idioma.
  if (bannerFijo) message(bannerFijo.clave, bannerFijo.params, { aviso: bannerFijo.aviso, fijo: true });
  else if (bannerVivo) $('#banner').textContent = t(bannerVivo.clave, bannerVivo.params);
      else { el.textContent = ''; el.classList.remove('warn'); }
    }, 4200);
  }
}

/**
 * Avisa donde el jugador está mirando. Los botones de actualizar e instalar
 * viven dentro del diálogo, y el cartel del tablero queda debajo del velo del
 * modal: allí el aviso no se ve. Fuera del diálogo, el cartel de siempre.
 */
function avisar(clave, params = {}, tipo = '') {
  if (panels.anyOpen) panels.avisoPanel(clave, params, tipo);
  else message(clave, params, { aviso: tipo === 'err' });
}

// Arriba del degradado del tapete, que es lo que se ve en las zonas seguras.
// Tiene que ir con --felt-1 de cada tema: hay una prueba que lo vigila.
const COLOR_TAPETE = { dark: '#14663f', light: '#35a066' };

function applyPrefs() {
  const prefs = game.prefs;
  const tema = prefs.theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : prefs.theme;
  document.documentElement.dataset.theme = tema;
  // El sistema pinta con esto la barra de estado y el hueco del navegador: si no
  // se mueve con el tema, en claro queda una franja oscura sobre el tapete.
  $('meta[name="theme-color"]')?.setAttribute('content', COLOR_TAPETE[tema] ?? COLOR_TAPETE.dark);
  document.documentElement.dataset.deck = prefs.fourColor ? '4' : '2';
  // El movimiento efectivo lo decide `motion`: la preferencia manda, pero quien
  // pide menos animación en el sistema la pide también aquí.
  $('#board').classList.toggle('anim', motion.aplicarMovimiento(prefs));
}

/**
 * «Estándar · 1 carta · crono»: la modalidad con la que se repartió, no la
 * preferencia. Con el reto diario manda la fecha —es lo que distingue esta mano
 * de cualquier otra— y el reloj se cae del chip para que quepa.
 */
function textoModo() {
  const { scoring, drawCount, timed } = game.mode;
  const puntuacion = t(`modo.${scoring}`);
  const robo = t(`modo.robo.${drawCount}`);
  if (game.dia) return t('modo.chip.reto', { fecha: fechaCorta(fechaDeClave(game.dia)), puntuacion, robo });
  return t('modo.chip', { puntuacion, robo, reloj: t(timed ? 'modo.crono' : 'modo.sincrono') });
}

function refreshHeader() {
  const prefs = game.prefs;
  const puntos = game.score;
  $('#score').textContent = formatScore(prefs.scoring, puntos);
  $('#moves').textContent = String(game.moves);
  $('#clock').textContent = game.mode.timed ? formatTime(game.elapsedMs) : t('hud.vacio');
  // Un crono parado con la partida empezada parece un crono roto: se dice que está en pausa.
  $('#clock-paused').hidden = !(game.status === 'playing' && game.moves > 0 && !game.clockRunning);

  // La caja de «Fundaciones» se quitó de la cabecera: el mismo dato lo cuenta la
  // barra de progreso, que ocupa 3 px y no una fila entera. Para quien no la ve,
  // el dato va en la propia barra, que ahora es una `progressbar` con su valor.
  const arriba = game.foundationCount;
  const progreso = $('#progress');
  progreso.firstElementChild.style.width = `${((arriba / 52) * 100).toFixed(1)}%`;
  progreso.setAttribute('aria-valuenow', String(arriba));
  progreso.setAttribute('aria-valuetext', t('hud.fundaciones.valor', { n: arriba }));

  const semilla = game.seed;
  const comprobado = semilla != null && isKnownSolvable(semilla);
  $('#seed').textContent = semilla == null
    ? t('hud.vacio')
    : t(comprobado ? 'hud.reparto.comprobado' : 'hud.reparto.numero', { n: semilla });
  $('#seed').title = comprobado ? t('hud.reparto.titulo') : '';
  // El número va DENTRO del nombre accesible: con un aria-label fijo, el lector
  // leía «Copiar el enlace de este reparto» y se comía el único dato que importa.
  $('#seed').setAttribute('aria-label', semilla == null
    ? t('hud.reparto.copiar')
    : t('hud.reparto.copiar.n', { n: semilla }));
  $('#mode-chip').textContent = textoModo();

  if (ultimaPuntuacion !== null && puntos !== ultimaPuntuacion) {
    const caja = $('#score').closest('.stat');
    caja.classList.remove('bump');
    void caja.offsetWidth;
    caja.classList.add('bump');
  }
  ultimaPuntuacion = puntos;

  // `game.undo()` se niega con la partida ganada, así que el botón tiene que
  // apagarse con la misma condición: si no, queda encendido y al pulsarlo dice
  // que no hay nada que deshacer con ochenta jugadas de historial detrás.
  $('#btn-undo').disabled = !game.canUndo || game.status === 'won';
  const jugando = game.status === 'playing' || game.status === 'stuck';
  $('#btn-hint').disabled = !jugando;
  pintarBotonFinal();
}

function refresh() {
  refreshHeader();
  board.paint();

  if (ultimoReparto !== null && game.dealId !== ultimoReparto) sonidos.barajar();
  ultimoReparto = game.dealId;      // en la primera vuelta solo se apunta: el reparto de bienvenida no suena

  if (game.status === 'won' && winShownFor !== game.lastResult?.at) {
    winShownFor = game.lastResult?.at;
    detenerAuto();
    sonidos.ganar();
    setTimeout(() => panels.showWin(), 420);
  }
  if (game.status === 'stuck' && !atascadoAvisado) {
    atascadoAvisado = true;
    sonidos.atasco();
    message(sinSalida(), {}, { aviso: true, fijo: true });
    // Se deja llegar a la carta que acaba de volar antes de tapar el tablero.
    setTimeout(() => { if (game.status === 'stuck') panels.showStuck(); }, 420);
  } else if (game.status !== 'stuck' && atascadoAvisado) {
    atascadoAvisado = false;
    message('');                       // hubo salida: el aviso fijo se retira
  } else if (game.canAutoComplete && !autoTimer) {
    message('msg.rematar');
  }
}

game.subscribe(refresh);

// ---------- reloj ----------
setInterval(() => {
  if (game.status === 'playing' && game.mode.timed) refreshHeader();
}, 500);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { game.pause(); game.flush(); }
  else if (game.status === 'playing' && game.moves > 0) game.resumeClock();
});
addEventListener('pagehide', () => game.flush());
addEventListener('beforeunload', () => game.flush());

// ---------- autocompletar ----------
function detenerAuto() {
  clearInterval(autoTimer);
  autoTimer = null;
  pintarBotonFinal();
}

/** El botón de rematar solo tiene sentido cuando ya no queda nada que decidir. */
function pintarBotonFinal() {
  const btn = $('#btn-finish');
  const corriendo = !!autoTimer;
  const visible = game.canAutoComplete || corriendo;
  const estado = `${visible}·${corriendo}`;
  if (btn.dataset.estado === estado) return;   // el reloj pasa por aquí dos veces por segundo
  btn.dataset.estado = estado;
  btn.hidden = !visible;
  btn.dataset.corriendo = corriendo ? 'si' : 'no';
  // El rótulo va en su propio <span> con clave: así lo alcanza el cambio de idioma.
  btn.innerHTML = corriendo
    ? '<span aria-hidden="true">■</span> <span data-i18n="tool.detener"></span>'
    : '<span aria-hidden="true">✨</span> <span data-i18n="tool.rematar"></span>';
  traducirDom(btn);
}

function autoCompletar() {
  if (autoTimer) { detenerAuto(); return; }
  if (!game.canAutoComplete) {
    const subidas = game.autoSafe();
    if (subidas) message('msg.autosubir', { count: subidas, n: subidas });
    else message('msg.autosubir.ninguna');
    return;
  }
  // Una carta cada cuarto de vuelo: se solapan lo justo para que parezca una cascada.
  // Sin movimiento no hay cascada que espaciar y la partida se remata de golpe.
  const ritmo = motion.hayMovimiento(game.prefs) ? Math.round(board.flightMs / 4) : 0;
  // La cascada se ata al reparto en el que empezó. Repartir desde el panel no
  // pasa por `detenerAuto()`, y el intervalo viejo seguía jugando solo sobre la
  // mano recién repartida.
  const reparto = game.dealId;
  autoTimer = setInterval(() => {
    if (game.dealId !== reparto || !game.autoCompleteStep()) detenerAuto();
  }, ritmo);
  pintarBotonFinal();
}

// ---------- de un movimiento a una frase ----------

/** La carta que encabeza un movimiento: es de la que hablan la pista y los avisos. */
function cartaDelMovimiento(move) {
  const st = game.state;
  if (!st || !move?.from) return null;
  const pila = move.from.pile === PILE.WASTE ? st.waste
    : move.from.pile === PILE.FOUNDATION ? st.foundations[move.from.index]
      : st.tableau[move.from.index];
  return pila?.[pila.length - (move.count ?? 1)] ?? null;
}

/** Los tres huecos que rellenan los textos de pista: carta, de dónde y a dónde. */
const partesDe = (move) => ({
  carta: nombreCarta(cartaDelMovimiento(move)),
  origen: nombrePila(move?.from, game.state),
  destino: nombrePila(move?.to, game.state),
});

/**
 * Por qué esa carta no cabía ahí. Se dice la regla, no un «no puede ser»: quien
 * suelta en un sitio ilegal casi siempre es que no la sabe todavía.
 */
function explicarIlegal({ from, to, count = 1 } = {}) {
  const carta = nombreCarta(cartaDelMovimiento({ from, count }));
  if (to?.pile === PILE.FOUNDATION) { message('msg.ilegal.fundacion', { carta }); return; }
  if (to?.pile === PILE.TABLEAU) {
    const columna = game.state?.tableau[to.index] ?? [];
    if (!columna.length) message('msg.ilegal.hueco');
    else message('msg.ilegal.tableau', { carta, destino: nombreCarta(columna.at(-1)) });
    return;
  }
  message('msg.ilegal.sitio', { carta });
}

/**
 * Por qué el mazo no da más. Solo habla cuando de verdad no queda nada: si el
 * toque robó o recicló, esta función no llega a decidir nada.
 */
function explicarMazo() {
  const st = game.state;
  if (!st || st.stock.length) return;
  if (game.status !== 'playing' && game.status !== 'stuck') return;
  if (!st.waste.length) { message('msg.mazo.vacio'); return; }
  // El motor cuenta reciclados y el texto habla de pasadas al mazo, que son una
  // más: en Vegas de una carta no se recicla nunca y aun así se pasa el mazo una vez.
  const tope = st.maxRecycles;
  if (Number.isFinite(tope) && st.recycles >= tope) {
    const pasadas = tope + 1;
    message('msg.mazo.pasadas', { count: pasadas, n: pasadas });
  }
}

// ---------- botones ----------
const confirmarSiEnJuego = (clave) =>
  !(game.status === 'playing' && game.moves > 0) || confirm(t(clave));

$('#btn-new').addEventListener('click', () => {
  if (!confirmarSiEnJuego('confirm.nueva')) return;
  detenerAuto();
  game.newGame();
  message('msg.nueva');
});

$('#btn-restart').addEventListener('click', () => {
  if (!confirmarSiEnJuego('confirm.repetir')) return;
  detenerAuto();
  game.restart();
  message('msg.repetida');
});

function deshacer() {
  detenerAuto();
  if (game.undo()) sonidos.deshacer(); else message('msg.nada.deshacer');
}

$('#btn-undo').addEventListener('click', deshacer);

/**
 * La pista: la mejor jugada y solo esa. Pulsar otra vez sin jugar repite la
 * misma —si es la mejor, sigue siéndolo—; antes iba pasando por las
 * alternativas y el jugador acababa sin saber cuál de las cuatro le convenía.
 *
 * Y no existe el «no veo ninguna jugada»: si no hay nada sobre la mesa la pista
 * es robar, y si tampoco queda nada que robar es que la partida está cerrada,
 * que es otra cosa muy distinta y se dice como tal.
 */
function pedirPista() {
  const rec = game.hint();
  if (!rec) {
    board.flashHint(null);
    message(sinSalida(), {}, { aviso: true, fijo: true });
    panels.showStuck();
    return;
  }
  message(`pista.${rec.reason}`, partesDe(rec.move));
  board.flashHint(rec.move);
}

$('#btn-hint').addEventListener('click', pedirPista);
$('#btn-finish').addEventListener('click', autoCompletar);
$('#btn-settings').addEventListener('click', () => panels.openSettings());
$('#mode-chip').addEventListener('click', () => panels.openSettings());

/**
 * Compartir una mano es dar su número, y el enlace ya lo lleva puesto. Si lo que
 * se está jugando es el reto del día, el enlace lleva además la fecha: quien lo
 * abra juega el reto —y el resultado le cuenta en su calendario— en vez de una
 * mano suelta con las mismas cartas.
 */
async function compartirReparto() {
  const semilla = game.seed;
  if (semilla == null) return;
  const loc = globalThis.location;
  const reto = game.dia ? `&reto=${game.dia}` : '';
  const url = `${loc?.origin ?? ''}${loc?.pathname ?? ''}?seed=${semilla}${reto}`;
  if (!globalThis.navigator?.clipboard?.writeText) { message('msg.reparto.url', { url }); return; }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // El portapapeles se niega si el permiso está denegado o la página no tiene
    // el foco. Enseñar la URL deja al jugador con lo que venía a buscar; decirle
    // solo que no se pudo copiar lo deja sin nada.
    message('msg.reparto.url', { url });
    return;
  }
  const chip = $('#seed');
  chip.classList.add('copiado');
  clearTimeout(copiadoTimer);
  copiadoTimer = setTimeout(() => chip.classList.remove('copiado'), 1200);
  message('msg.reparto.copiado', { n: semilla });
}

$('#seed').addEventListener('click', compartirReparto);

// ---------- teclado ----------
addEventListener('keydown', (event) => {
  const enTexto = event.target.matches?.('input, textarea');
  if (enTexto) return;
  if (panels.anyOpen && event.key !== 'Escape') return;

  const ctrl = event.ctrlKey || event.metaKey;
  // Ctrl+Z deshace; Ctrl+Mayús+Z era rehacer y ya no existe, así que se traga sin
  // hacer nada: a quien lo pulse por costumbre, deshacerle otra jugada le movería
  // la partida justo al revés de lo que pedía.
  if (ctrl && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (!event.shiftKey) deshacer();
    return;
  }
  if (ctrl) return;

  const tecla = event.key;
  if (tecla === ' ') {
    // Con un botón o un desplegable enfocado, el espacio es «púlsalo», no «roba».
    // Sin esta salida el preventDefault() de abajo cancelaba la activación nativa
    // y el atajo del mazo se comía la pulsación: quien navega con el tabulador
    // pulsaba «Deshacer» y robaba una carta —o reciclaba, −100 puntos—.
    if (event.target.closest?.('button, select')) return;
    event.preventDefault();
    if (!game.stockClick()) explicarMazo();
    return;
  }
  if (tecla >= '1' && tecla <= '7') {
    event.preventDefault();
    if (!game.sendToFoundation({ pile: PILE.TABLEAU, index: Number(tecla) - 1 })) {
      message('msg.columna.sin.subida', { n: tecla });
    }
    return;
  }
  if (tecla === '0') {
    event.preventDefault();
    if (!game.sendToFoundation({ pile: PILE.WASTE })) message('msg.descarte.sin.subida');
    return;
  }

  switch (tecla.toLowerCase()) {
    case 'escape': board.cancel(); break;
    case 'u': deshacer(); break;
    case 'h': $('#btn-hint').click(); break;
    case 'a': autoCompletar(); break;
    case 'n': $('#btn-new').click(); break;
    case 'r': $('#btn-restart').click(); break;
    case 'd': panels.openReto(); break;
    case 'p': panels.openStats(); break;
    case ',': panels.openSettings(); break;
    case '?': panels.openHelp(); break;
    default: break;
  }
});

// ---------- el mazo, cuando ya no da más ----------
// Quien recibe el toque del mazo es el tablero, que no habla. Se apunta antes de
// que lo atienda si el toque iba al mazo, y se juzga después: si el estado no se
// movió, es que no quedaba nada que robar ni que reciclar, y eso hay que decirlo.
const vaAlMazo = (target) => {
  if (target?.closest?.('.slot-stock')) return true;
  const id = target?.closest?.('.card')?.dataset.id;
  return !!id && !!game.state?.stock.some((c) => c.id === id);
};

document.addEventListener('pointerdown', (event) => {
  const primario = event.button == null || event.button === 0;
  mazoTocado = primario && !board.repartiendo && vaAlMazo(event.target) ? { epoch: game.epoch } : null;
}, true);

document.addEventListener('pointerdown', () => {
  const toque = mazoTocado;
  mazoTocado = null;
  if (toque && game.epoch === toque.epoch) explicarMazo();
});

// ---------- nada de zoom ----------
// El viewport ya lo pide y la hoja de estilos también (touch-action), pero
// Safari en iOS se salta `user-scalable=no`: el pellizco le llega como gesto
// propio. Se corta a mano, que si no el tablero se descoloca de un dedazo.
for (const gesto of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(gesto, (event) => event.preventDefault(), { passive: false });
}
document.addEventListener('touchmove', (event) => {
  if (event.touches.length > 1) event.preventDefault();
}, { passive: false });
// El doble clic de zoom sí, pero el de seleccionar una palabra en un campo no.
document.addEventListener('dblclick', (event) => {
  if (!event.target.closest?.('input, textarea')) event.preventDefault();
});

// Punto de entrada para la consola del navegador y para las pruebas.
globalThis.solitario = { game, store, board, panels, message, refresh, pwa, instalador, i18n, VERSION };

// ---------- en marcha ----------
applyPrefs();
pintarAjustesApp();
if (esStandalone() || esIos()) document.documentElement.dataset.instalada = String(esStandalone());
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyPrefs);
// El ajuste de movimiento del sistema puede cambiar con la partida abierta.
motion.alCambiarMovimiento(() => applyPrefs());

// Cambiar de idioma no interrumpe nada: se vuelve a pintar todo lo que hay puesto,
// sin tocar la partida ni cerrar el diálogo desde el que se acaba de cambiar.
alCambiarIdioma(() => {
  traducirDom();
  delete $('#btn-finish').dataset.estado;   // su rótulo va cacheado: se invalida a mano
  refresh();
  pintarAjustesApp();
  // El cartel se reescribe sin tocar su temporizador: reemitir el aviso de paso
  // con message() le regalaría otros 4,2 s de vida solo por cambiar de idioma.
  if (bannerFijo) message(bannerFijo.clave, bannerFijo.params, { aviso: bannerFijo.aviso, fijo: true });
  else if (bannerVivo) $('#banner').textContent = t(bannerVivo.clave, bannerVivo.params);
  panels.retraducir?.();
});

/** ?seed=N para abrir directamente la mano que alguien ha compartido. */
function semillaDeLaUrl() {
  const crudo = new URLSearchParams(globalThis.location?.search ?? '').get('seed');
  if (crudo == null || !/^\d+$/.test(crudo.trim())) return null;
  const n = Number(crudo);
  return n >= 1 && n <= 999999 ? n : null;
}

/** ?reto=hoy o ?reto=AAAA-MM-DD para abrir directamente el reparto de ese día. */
function retoDeLaUrl() {
  const crudo = new URLSearchParams(globalThis.location?.search ?? '').get('reto');
  if (crudo == null) return null;
  const clave = crudo.trim() === 'hoy' ? claveDia() : crudo.trim();
  return esJugable(clave) ? clave : null;
}

/** La primera vez se explica el juego, salvo que ya haya algo abierto por delante. */
function quizasAyuda() {
  if (store.getStats('standard', 1).played || store.getStats('standard', 3).played) return;
  setTimeout(() => { if (!panels.anyOpen) panels.openHelp(); }, 500);
}

const semillaCompartida = semillaDeLaUrl();
const retoCompartido = retoDeLaUrl();
if (game.resume()) {
  // La partida a medias manda sobre el enlace: nadie quiere perderla por abrirlo.
  message('msg.retomada');
} else if (retoCompartido !== null) {
  game.newGame(semillaDelDia(retoCompartido), { dia: retoCompartido });
  message('msg.reto.nuevo', { fecha: fechaCorta(fechaDeClave(retoCompartido)) });
  quizasAyuda();
} else if (semillaCompartida !== null) {
  game.newGame(semillaCompartida);
  message(isKnownSolvable(semillaCompartida) ? 'msg.reparto.nuevo.comprobado' : 'msg.reparto.nuevo', { n: semillaCompartida });
  quizasAyuda();
} else {
  game.newGame();
  quizasAyuda();
}
refresh();
