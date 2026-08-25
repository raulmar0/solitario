// Diálogos: récords, ajustes, ayuda y final de partida.

import { formatTime } from './game.js';
import { formatScore, MODE_LABEL } from './scoring.js';
import { isKnownSolvable } from './solvable-seeds.js';

const $ = (sel, root = document) => root.querySelector(sel);
const MODES = [
  { scoring: 'standard', drawCount: 1 },
  { scoring: 'standard', drawCount: 3 },
  { scoring: 'vegas', drawCount: 1 },
  { scoring: 'vegas', drawCount: 3 },
];
const modeName = ({ scoring, drawCount }) => `${MODE_LABEL[scoring]} · de ${drawCount === 1 ? 'una' : 'tres'}`;

const fecha = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
};

export function createPanels({ game, store, onMessage, onPrefsChanged, onOpenSettings = () => {} }) {
  const dlgWin = $('#dlg-win');
  const dlgStats = $('#dlg-stats');
  const dlgSettings = $('#dlg-settings');
  const dlgHelp = $('#dlg-help');
  let statsMode = null;

  for (const dlg of [dlgWin, dlgStats, dlgSettings, dlgHelp]) {
    dlg.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) dlg.close();
      else if (event.target === dlg) dlg.close();   // clic en el fondo
    });
  }

  // ---------- récords ----------

  function renderStats() {
    const tabs = $('#stats-tabs');
    const panel = $('#stats-panel');
    const enPestanas = tabs.contains(document.activeElement);
    tabs.replaceChildren(...MODES.map((mode, i) => {
      const b = document.createElement('button');
      b.className = 'tab';
      b.type = 'button';
      b.id = `tab-${mode.scoring}-${mode.drawCount}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'stats-panel');
      b.textContent = modeName(mode);
      const activo = mode.scoring === statsMode.scoring && mode.drawCount === statsMode.drawCount;
      b.setAttribute('aria-selected', String(activo));
      b.tabIndex = activo ? 0 : -1;      // el tabulador entra una vez; dentro se navega con flechas
      if (activo) panel.setAttribute('aria-labelledby', b.id);
      b.addEventListener('click', () => { statsMode = mode; renderStats(); });
      b.addEventListener('keydown', (event) => {
        const paso = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[event.key];
        if (paso === undefined) return;
        event.preventDefault();
        const destino = paso === -Infinity ? 0
          : paso === Infinity ? MODES.length - 1
            : (i + paso + MODES.length) % MODES.length;
        statsMode = MODES[destino];
        renderStats();
      });
      return b;
    }));

    const { scoring, drawCount } = statsMode;
    const s = store.getStats(scoring, drawCount);
    const pct = s.played ? Math.round((s.won / s.played) * 100) : 0;
    const media = s.played ? Math.round(s.totalScore / s.played) : 0;
    const campos = [
      ['Partidas', s.played],
      ['Ganadas', s.won],
      ['% victorias', `${pct} %`],
      ['Mejor puntuación', s.bestScore == null ? '—' : formatScore(scoring, s.bestScore)],
      ['Media', s.played ? formatScore(scoring, media) : '—'],
      ['Mejor tiempo', s.bestTimeMs == null ? '—' : formatTime(s.bestTimeMs)],
      ['Menos jugadas', s.fewestMoves ?? '—'],
      ['Racha actual', s.currentStreak],
      ['Mejor racha', s.bestStreak],
    ];
    $('#stats-grid').replaceChildren(...campos.map(([dt, dd]) => {
      const wrap = document.createElement('div');
      const k = document.createElement('dt');
      const v = document.createElement('dd');
      k.textContent = dt;
      v.textContent = String(dd);
      wrap.append(k, v);
      return wrap;
    }));

    const bankRow = $('#bank-row');
    bankRow.hidden = scoring !== 'vegas';
    if (scoring === 'vegas') $('#bank-value').textContent = formatScore('vegas', store.getBank(drawCount));

    const filas = store.getScores({ scoring, drawCount, limit: 25 });
    const tbody = $('#scores-table tbody');
    tbody.replaceChildren(...filas.map((r, i) => {
      const tr = document.createElement('tr');
      if (game.lastResult && r.at === game.lastResult.at) tr.className = 'me';
      const celdas = [
        String(i + 1),
        formatScore(scoring, r.score ?? 0),
        r.won ? 'Ganada' : 'Perdida',
        formatTime(r.timeMs ?? 0),
        String(r.moves ?? 0),
        `#${r.seed ?? '—'}`,
        fecha(r.at),
      ];
      celdas.forEach((texto, col) => {
        const td = document.createElement('td');
        td.textContent = texto;
        if (col === 2) td.className = r.won ? 'win' : 'loss';
        tr.appendChild(td);
      });
      return tr;
    }));
    $('#scores-table').hidden = filas.length === 0;
    $('#scores-empty').hidden = filas.length > 0;

    // Los botones se han vuelto a crear: si el foco estaba en ellos, se repone.
    if (enPestanas) tabs.querySelector('[aria-selected="true"]')?.focus();
  }

  $('#btn-reset-bank').addEventListener('click', () => {
    if (!confirm('¿Poner a cero la banca de Vegas de este modo?')) return;
    store.resetBank(statsMode.drawCount);
    renderStats();
  });

  $('#btn-export').addEventListener('click', () => {
    const datos = JSON.stringify(store.exportAll(), null, 2);
    const url = URL.createObjectURL(new Blob([datos], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `solitario-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onMessage('Datos exportados.');
  });

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const datos = JSON.parse(await file.text());
      if (!confirm('Se sustituirán tus récords y ajustes por los del archivo. ¿Seguimos?')) return;
      store.importAll(datos);
      renderStats();
      onPrefsChanged();
      onMessage('Datos importados.');
    } catch (err) {
      alert(`No se pudo leer el archivo: ${err.message}`);
    }
  });

  $('#btn-wipe').addEventListener('click', () => {
    if (!confirm('Se borran todos los récords, estadísticas y ajustes de este navegador. No hay vuelta atrás.')) return;
    store.resetAll();
    renderStats();
    onPrefsChanged();
    onMessage('Datos borrados.');
  });

  // ---------- ajustes ----------

  function renderSettings() {
    const prefs = game.prefs;
    for (const btn of dlgSettings.querySelectorAll('.seg-btn')) {
      const marcado = String(prefs[btn.dataset.pref]) === btn.dataset.value;
      btn.setAttribute('aria-checked', String(marcado));
      btn.tabIndex = marcado ? 0 : -1;
    }
    for (const input of dlgSettings.querySelectorAll('input[data-pref]')) {
      if (input.type === 'checkbox') input.checked = !!prefs[input.dataset.pref];
      else input.value = prefs[input.dataset.pref] ?? '';
    }
    $('#scoring-hint').textContent = prefs.scoring === 'vegas'
      ? 'Vegas: pagas 52 $ y cobras 5 $ por carta subida. El saldo se acumula partida tras partida.'
      : 'Estándar: puntos por cada carta que colocas, con bonificación si juegas contrarreloj.';
  }

  dlgSettings.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg-btn');
    if (!btn) return;
    const pref = btn.dataset.pref;
    const valor = pref === 'drawCount' ? Number(btn.dataset.value) : btn.dataset.value;
    const cambiaReparto = (pref === 'drawCount' || pref === 'scoring') && game.prefs[pref] !== valor
      && game.status === 'playing' && game.moves > 0;
    if (cambiaReparto && !confirm('Cambiar de modalidad reparte de nuevo y la partida en curso cuenta como perdida. ¿Seguimos?')) {
      return;
    }
    game.setPrefs({ [pref]: valor });
    renderSettings();
    onPrefsChanged();
  });

  dlgSettings.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-pref]');
    if (!input) return;
    const valor = input.type === 'checkbox' ? input.checked : input.value.trim();
    game.setPrefs({ [input.dataset.pref]: valor });
    if (input.dataset.pref === 'timed' && game.status !== 'idle' && game.moves > 0) {
      onMessage('El contrarreloj se aplicará al próximo reparto.');
    }
    renderSettings();
    onPrefsChanged();
  });

  // Flechas dentro de cada grupo de opciones, como manda el patrón de radios.
  dlgSettings.addEventListener('keydown', (event) => {
    const btn = event.target.closest('.seg-btn');
    if (!btn) return;
    const paso = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!paso) return;
    event.preventDefault();
    const grupo = [...btn.parentElement.querySelectorAll('.seg-btn')];
    const destino = grupo[(grupo.indexOf(btn) + paso + grupo.length) % grupo.length];
    destino.click();
    destino.focus();
  });

  $('#btn-seed-go').addEventListener('click', () => {
    const input = $('#seed-input');
    const seed = Number(input.value);
    if (!Number.isInteger(seed) || seed < 1 || seed > 999999) {
      onMessage('Escribe un número de reparto entre 1 y 999999.');
      return;
    }
    if (game.status === 'playing' && game.moves > 0
      && !confirm('La partida en curso contará como perdida. ¿Repartimos igualmente?')) return;
    game.newGame(seed);
    dlgSettings.close();
    onMessage(`Reparto #${seed}${isKnownSolvable(seed) ? ' · tiene solución comprobada' : ''}`);
  });

  $('#seed-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); $('#btn-seed-go').click(); }
  });

  // ---------- final de partida ----------

  function confeti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const caja = $('#confetti');
    const colores = ['#f0c453', '#e06a5c', '#6ee7a8', '#7db8f0', '#ffffff'];
    const piezas = [];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i');
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = colores[i % colores.length];
      p.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
      p.style.animationDelay = `${Math.random() * 0.6}s`;
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      piezas.push(p);
    }
    caja.replaceChildren(...piezas);
    setTimeout(() => caja.replaceChildren(), 4200);
  }

  function showWin() {
    const r = game.lastResult;
    if (!r) return;
    $('#win-score').textContent = formatScore(r.scoring, r.score);
    $('#win-time').textContent = formatTime(r.timeMs);
    $('#win-moves').textContent = String(r.moves);

    const stats = store.getStats(r.scoring, r.drawCount);
    const notas = [];
    if (stats.bestScore === r.score) notas.push('Nueva mejor puntuación');
    if (stats.bestTimeMs === r.timeMs) notas.push('Récord de tiempo');
    if (stats.currentStreak > 1) notas.push(`${stats.currentStreak} victorias seguidas`);
    if (r.scoring === 'vegas') notas.push(`Banca: ${formatScore('vegas', store.getBank(r.drawCount))}`);
    $('#win-note').textContent = notas.join(' · ');

    confeti();
    dlgWin.showModal();
  }

  dlgWin.addEventListener('click', (event) => {
    const accion = event.target.closest('[data-action]')?.dataset.action;
    if (accion === 'new') { dlgWin.close(); game.newGame(); }
    if (accion === 'stats') { dlgWin.close(); api.openStats(); }
  });

  const api = {
    openStats() {
      statsMode = { scoring: game.prefs.scoring, drawCount: game.prefs.drawCount };
      renderStats();
      dlgStats.showModal();
    },
    openSettings() { renderSettings(); onOpenSettings(); dlgSettings.showModal(); },
    openHelp() { dlgHelp.showModal(); },
    showWin,
    renderSettings,
    get anyOpen() { return [dlgWin, dlgStats, dlgSettings, dlgHelp].some((d) => d.open); },
  };
  return api;
}
