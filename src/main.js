// Arranque: monta el juego, la barra superior, el teclado y los diálogos.

import { createStore } from './storage.js';
import { createGame, formatTime } from './game.js';
import { createBoard } from './ui.js';
import { createPanels } from './panels.js';
import { formatScore } from './scoring.js';
import { isKnownSolvable } from './solvable-seeds.js';
import { PILE } from './engine.js';

const $ = (sel) => document.querySelector(sel);

const store = createStore(globalThis.localStorage);
const game = createGame({ store });
const board = createBoard({ root: $('#board'), game, onMessage: message });

const panels = createPanels({
  game,
  store,
  onMessage: message,
  onPrefsChanged: () => { applyPrefs(); refresh(); },
});

let bannerTimer = null;
let autoTimer = null;
let winShownFor = null;
let ultimaPuntuacion = null;

function message(texto, aviso = false) {
  const el = $('#banner');
  el.textContent = texto;
  el.classList.toggle('warn', aviso);
  clearTimeout(bannerTimer);
  if (texto) bannerTimer = setTimeout(() => { el.textContent = ''; el.classList.remove('warn'); }, 4200);
}

function applyPrefs() {
  const prefs = game.prefs;
  const tema = prefs.theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : prefs.theme;
  document.documentElement.dataset.theme = tema;
  $('#board').classList.toggle('anim', prefs.animations !== false);
}

function refreshHeader() {
  const prefs = game.prefs;
  const puntos = game.score;
  $('#score').textContent = formatScore(prefs.scoring, puntos);
  $('#moves').textContent = String(game.moves);
  $('#clock').textContent = game.mode.timed ? formatTime(game.elapsedMs) : '—';
  const semilla = game.seed;
  $('#seed').textContent = semilla == null ? '—' : `#${semilla}${isKnownSolvable(semilla) ? ' ✓' : ''}`;
  $('#seed').title = isKnownSolvable(semilla) ? 'Este reparto tiene solución comprobada' : '';

  if (ultimaPuntuacion !== null && puntos !== ultimaPuntuacion) {
    const caja = $('#score').closest('.stat');
    caja.classList.remove('bump');
    void caja.offsetWidth;
    caja.classList.add('bump');
  }
  ultimaPuntuacion = puntos;

  $('#btn-undo').disabled = !game.canUndo;
  $('#btn-redo').disabled = !game.canRedo;
  const jugando = game.status === 'playing' || game.status === 'stuck';
  $('#btn-hint').disabled = !jugando;
  $('#btn-auto').disabled = game.status !== 'playing';
}

function refresh() {
  refreshHeader();
  board.paint();

  if (game.status === 'won' && winShownFor !== game.lastResult?.at) {
    winShownFor = game.lastResult?.at;
    detenerAuto();
    setTimeout(() => panels.showWin(), 420);
  }
  if (game.status === 'stuck') {
    message('No veo jugadas útiles. Puedes bajar una carta de las pilas de arriba, deshacer o repartir.', true);
  } else if (game.canAutoComplete && !autoTimer) {
    message('Ya está resuelto: pulsa «Auto» para colocar el resto.');
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
function detenerAuto() { clearInterval(autoTimer); autoTimer = null; }

function autoCompletar() {
  if (autoTimer) { detenerAuto(); return; }
  if (!game.canAutoComplete) {
    const subidas = game.autoSafe();
    message(subidas ? `${subidas} carta${subidas === 1 ? '' : 's'} arriba.` : 'De momento no hay ninguna carta que subir sin riesgo.');
    return;
  }
  autoTimer = setInterval(() => {
    if (!game.autoCompleteStep()) detenerAuto();
  }, game.prefs.animations === false ? 0 : 90);
}

// ---------- botones ----------
const confirmarSiEnJuego = (texto) =>
  !(game.status === 'playing' && game.moves > 0) || confirm(texto);

$('#btn-new').addEventListener('click', () => {
  if (!confirmarSiEnJuego('La partida en curso contará como perdida. ¿Repartimos otra?')) return;
  detenerAuto();
  game.newGame();
  message('Cartas nuevas.');
});

$('#btn-restart').addEventListener('click', () => {
  if (!confirmarSiEnJuego('Vuelve a empezar este mismo reparto y la partida actual cuenta como perdida. ¿Seguimos?')) return;
  detenerAuto();
  game.restart();
  message('Mismo reparto, desde el principio.');
});

$('#btn-undo').addEventListener('click', () => { detenerAuto(); if (!game.undo()) message('No hay nada que deshacer.'); });
$('#btn-redo').addEventListener('click', () => { if (!game.redo()) message('No hay nada que rehacer.'); });

$('#btn-hint').addEventListener('click', () => {
  const jugada = game.hint();
  if (!jugada) { message('No veo ninguna jugada.', true); return; }
  if (jugada.type === 'draw') message('Roba del mazo.');
  else if (jugada.type === 'recycle') message('Recicla el descarte.');
  board.flashHint(jugada);
});

$('#btn-auto').addEventListener('click', autoCompletar);
$('#btn-stats').addEventListener('click', () => panels.openStats());
$('#btn-settings').addEventListener('click', () => panels.openSettings());
$('#btn-help').addEventListener('click', () => panels.openHelp());

// ---------- teclado ----------
addEventListener('keydown', (event) => {
  const enTexto = event.target.matches?.('input, textarea');
  if (enTexto) return;
  if (panels.anyOpen && event.key !== 'Escape') return;

  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) game.redo(); else { detenerAuto(); game.undo(); }
    return;
  }
  if (ctrl && event.key.toLowerCase() === 'y') { event.preventDefault(); game.redo(); return; }
  if (ctrl) return;

  const tecla = event.key;
  if (tecla === ' ') { event.preventDefault(); game.stockClick(); return; }
  if (tecla >= '1' && tecla <= '7') {
    event.preventDefault();
    if (!game.sendToFoundation({ pile: PILE.TABLEAU, index: Number(tecla) - 1 })) {
      message(`La columna ${tecla} no tiene ninguna carta lista para subir.`);
    }
    return;
  }
  if (tecla === '0') {
    event.preventDefault();
    if (!game.sendToFoundation({ pile: PILE.WASTE })) message('El descarte no tiene ninguna carta lista para subir.');
    return;
  }

  switch (tecla.toLowerCase()) {
    case 'escape': board.clearSelection(); break;
    case 'u': detenerAuto(); game.undo(); break;
    case 'h': $('#btn-hint').click(); break;
    case 'a': autoCompletar(); break;
    case 'n': $('#btn-new').click(); break;
    case 'r': $('#btn-restart').click(); break;
    case 'p': panels.openStats(); break;
    case ',': panels.openSettings(); break;
    case '?': panels.openHelp(); break;
    default: break;
  }
});

// Punto de entrada para la consola del navegador y para las pruebas.
globalThis.solitario = { game, store, board, panels, message };

// ---------- en marcha ----------
applyPrefs();
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyPrefs);

if (game.resume()) {
  message('Retomamos la partida que dejaste a medias.');
} else {
  game.newGame();
  // La primera vez se explica el juego, salvo que ya haya algo abierto por delante.
  if (!store.getStats('standard', 1).played && !store.getStats('standard', 3).played) {
    setTimeout(() => { if (!panels.anyOpen) panels.openHelp(); }, 500);
  }
}
refresh();
