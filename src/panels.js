// Diálogos: récords, ajustes, ayuda y final de partida.
// Ni una cadena literal: todo lo que se lee aquí sale de `t()`, porque el idioma
// puede cambiar con el panel abierto y hay que saber repintarlo (`retraducir`).

import { formatTime } from './game.js';
import { formatScore } from './scoring.js';
import { isKnownSolvable } from './solvable-seeds.js';
import {
  t, fecha, fechaCorta, fechaLarga, nombreMes, diasDeLaSemana, primerDiaSemana,
  fijarIdioma, resolverIdioma,
} from './i18n.js';
import {
  claveDia, esFuturo, esJugable, fechaDeClave, rejillaDelMes, semillaDelDia,
} from './reto.js';

const $ = (sel, root = document) => root.querySelector(sel);
const MODES = [
  { scoring: 'standard', drawCount: 1 },
  { scoring: 'standard', drawCount: 3 },
  { scoring: 'vegas', drawCount: 1 },
  { scoring: 'vegas', drawCount: 3 },
];
const modeName = ({ scoring, drawCount }) => t('modo.nombre', {
  puntuacion: t(`modo.${scoring}`),
  robo: t(`modo.robo.${drawCount}`),
});

const AVISO_MS = 5000;          // lo que dura un aviso dentro del diálogo
const SVG_NS = 'http://www.w3.org/2000/svg';
// El viewBox lo fija el HTML; el margen deja sitio al punto de la última partida,
// que si no se comería el borde redondeado de la caja.
const SPARK = { ancho: 300, alto: 64, margen: 8, radio: 3, maximo: 20, minimo: 3 };

export function createPanels({ game, store, onMessage, onPrefsChanged, onOpenSettings = () => {} }) {
  const dlgWin = $('#dlg-win');
  const dlgStuck = $('#dlg-stuck');
  const dlgSettings = $('#dlg-settings');
  let statsMode = null;

  for (const dlg of [dlgWin, dlgStuck, dlgSettings]) {
    dlg.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) dlg.close();
      else if (event.target === dlg) dlg.close();   // clic en el fondo
    });
  }

  // ---------- avisos dentro del diálogo ----------

  // Mientras el panel está abierto tapa el banner del tablero, así que lo que
  // pasa dentro se cuenta dentro. Se guarda la clave, no el texto ya traducido:
  // si cambia el idioma con el aviso en pantalla, hay que poder repintarlo.
  let avisoTimer = null;
  let avisoVivo = null;

  function pintarAviso() {
    const caja = $('#dlg-status');
    if (!caja) return;
    caja.textContent = avisoVivo ? t(avisoVivo.clave, avisoVivo.params) : '';
    caja.className = avisoVivo?.tipo ? `dlg-status ${avisoVivo.tipo}` : 'dlg-status';
  }

  /** `tipo` ∈ ''|'warn'|'err'. Sin clave, borra el aviso que hubiera. */
  function avisoPanel(clave, params = {}, tipo = '') {
    clearTimeout(avisoTimer);            // un aviso viejo no puede apagar el nuevo
    avisoVivo = clave ? { clave, params, tipo } : null;
    pintarAviso();
    if (clave) avisoTimer = setTimeout(() => avisoPanel(null), AVISO_MS);
  }

  // El error del reparto se queda a la vista hasta que se corrige (el aviso de
  // arriba se va solo), de ahí que su clave se guarde aparte.
  let claveErrorReparto = null;

  function pintarErrorReparto(clave = claveErrorReparto) {
    claveErrorReparto = clave;
    const caja = $('#seed-error');
    const input = $('#seed-input');
    caja.textContent = clave ? t(clave) : '';
    caja.hidden = !clave;
    if (clave) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  // Al cerrar se limpia: lo que se dijo entonces no viene a cuento la próxima vez.
  dlgSettings.addEventListener('close', () => {
    avisoPanel(null);
    pintarErrorReparto(null);
  });

  // ---------- las tres secciones ----------

  const SECCIONES = ['reto', 'ajustes', 'records', 'ayuda'];
  let seccion = 'ajustes';

  function mostrarSeccion(cual, { foco = false } = {}) {
    seccion = SECCIONES.includes(cual) ? cual : 'ajustes';
    for (const id of SECCIONES) {
      const pestana = $(`#tab-${id}`);
      const panel = $(`#panel-${id}`);
      const activa = id === seccion;
      pestana.setAttribute('aria-selected', String(activa));
      pestana.tabIndex = activa ? 0 : -1;   // el tabulador entra una vez; dentro, flechas
      panel.hidden = !activa;
      if (activa) $('#panel-titulo').textContent = t(`dlg.titulo.${id}`);
    }
    if (seccion === 'records') renderStats();
    if (seccion === 'ajustes') renderSettings();
    // Entrar al reto centra el calendario, se llegue por donde se llegue: por la
    // pestaña también. Volver a la sección y encontrarse en el mes de la última
    // vez, con un día de hace tres semanas elegido, no lo espera nadie.
    if (seccion === 'reto') { centrarReto(); renderReto(); }
    if (foco) $(`#tab-${seccion}`).focus();
  }

  $('#panel-tabs').addEventListener('click', (event) => {
    const pestana = event.target.closest('[role="tab"]');
    if (pestana) mostrarSeccion(pestana.id.replace('tab-', ''));
  });

  $('#panel-tabs').addEventListener('keydown', (event) => {
    const paso = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[event.key];
    if (paso === undefined || !event.target.closest('[role="tab"]')) return;
    event.preventDefault();
    const i = SECCIONES.indexOf(seccion);
    const destino = paso === -Infinity ? 0
      : paso === Infinity ? SECCIONES.length - 1
        : (i + paso + SECCIONES.length) % SECCIONES.length;
    mostrarSeccion(SECCIONES[destino], { foco: true });
  });

  /** Abre el panel por la sección que se pida. */
  function abrir(cual) {
    if (cual === 'records') statsMode = { scoring: game.prefs.scoring, drawCount: game.prefs.drawCount };
    mostrarSeccion(cual);
    onOpenSettings();
    if (!dlgSettings.open) dlgSettings.showModal();
  }

  // ---------- récords ----------

  // `getScores` ordena por puntuación, que para una evolución no dice nada: aquí
  // manda cuándo se jugó. Las filas viejas sin fecha se van al principio.
  const cuando = (fila) => {
    const ms = Date.parse(fila?.at ?? '');
    return Number.isNaN(ms) ? 0 : ms;
  };
  const redondea = (n) => Math.round(n * 10) / 10;

  /** La línea de puntuaciones de las últimas partidas de la modalidad. */
  function renderSpark(scoring, drawCount) {
    const caja = $('#spark-wrap');
    const svg = $('#stats-spark');
    const filas = store.getScores({ scoring, drawCount }).sort((a, b) => cuando(a) - cuando(b)).slice(-SPARK.maximo);
    if (filas.length < SPARK.minimo) {
      // Con dos partidas la línea sería un palo entre dos puntos: no dice nada.
      caja.hidden = true;
      svg.replaceChildren();
      svg.removeAttribute('aria-label');
      $('#spark-note').textContent = '';
      return;
    }

    const valores = filas.map((r) => r.score ?? 0);
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const util = SPARK.alto - SPARK.margen * 2;
    const paso = (SPARK.ancho - SPARK.margen * 2) / (filas.length - 1);
    const puntos = valores.map((v, i) => [
      SPARK.margen + paso * i,
      // Todas iguales: la línea se va al centro en vez de dividir por cero.
      max === min ? SPARK.alto / 2 : SPARK.alto - SPARK.margen - ((v - min) / (max - min)) * util,
    ]);

    const linea = document.createElementNS(SVG_NS, 'polyline');
    linea.setAttribute('points', puntos.map(([x, y]) => `${redondea(x)},${redondea(y)}`).join(' '));
    // El punto de la última partida no es un <circle>: el viewBox se estira a lo
    // ancho del panel y saldría ovalado. Es un trazo de longitud cero con la
    // punta redonda, que el CSS pinta con `non-scaling-stroke` y por eso sale
    // redondo mida lo que mida el panel.
    const [ux, uy] = puntos.at(-1);
    const ultima = document.createElementNS(SVG_NS, 'path');
    ultima.setAttribute('class', 'punto');
    ultima.setAttribute('d', `M${redondea(ux)} ${redondea(uy)}l0 0`);

    svg.replaceChildren(linea, ultima);
    // Dentro del SVG no va texto: lo que tenga que leerse lo dice el aria-label.
    svg.setAttribute('aria-label', t('stats.evolucion.aria', { n: filas.length }));
    $('#spark-note').textContent = t('stats.evolucion.nota', { count: filas.length });
    caja.hidden = false;
  }

  function renderStats() {
    statsMode = statsMode ?? { scoring: game.prefs.scoring, drawCount: game.prefs.drawCount };
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
    const vacio = t('hud.vacio');
    const s = store.getStats(scoring, drawCount);
    const pct = s.played ? Math.round((s.won / s.played) * 100) : 0;
    const media = s.played ? Math.round(s.totalScore / s.played) : 0;
    const campos = [
      ['stats.partidas', String(s.played)],
      ['stats.ganadas', String(s.won)],
      ['stats.porcentaje', t('stats.porcentaje.valor', { n: pct })],
      ['stats.mejor.puntuacion', s.bestScore == null ? vacio : formatScore(scoring, s.bestScore)],
      ['stats.media', s.played ? formatScore(scoring, media) : vacio],
      ['stats.mejor.tiempo', s.bestTimeMs == null ? vacio : formatTime(s.bestTimeMs)],
      ['stats.menos.jugadas', s.fewestMoves == null ? vacio : String(s.fewestMoves)],
      ['stats.racha', String(s.currentStreak)],
      ['stats.mejor.racha', String(s.bestStreak)],
    ];
    $('#stats-grid').replaceChildren(...campos.map(([clave, dd]) => {
      const wrap = document.createElement('div');
      const k = document.createElement('dt');
      const v = document.createElement('dd');
      k.textContent = t(clave);
      v.textContent = dd;
      wrap.append(k, v);
      return wrap;
    }));

    renderSpark(scoring, drawCount);

    const bankRow = $('#bank-row');
    bankRow.hidden = scoring !== 'vegas';
    if (scoring === 'vegas') $('#bank-value').textContent = formatScore('vegas', store.getBank(drawCount));

    const filas = store.getScores({ scoring, drawCount, limit: 25 });
    const tbody = $('#scores-table tbody');
    tbody.replaceChildren(...filas.map((r, i) => {
      const tr = document.createElement('tr');
      if (game.lastResult && r.at === game.lastResult.at) tr.className = 'me';
      // Las cabeceras las traduce el HTML por data-i18n; estas celdas, nosotros.
      const celdas = [
        String(i + 1),
        formatScore(scoring, r.score ?? 0),
        t(r.won ? 'stats.ganada' : 'stats.perdida'),
        formatTime(r.timeMs ?? 0),
        String(r.moves ?? 0),
        r.seed == null ? vacio : t('hud.reparto.numero', { n: r.seed }),
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
    if (!confirm(t('confirm.banca'))) return;
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
    avisoPanel('msg.datos.exportados');
  });

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const datos = JSON.parse(await file.text());
      if (!confirm(t('confirm.importar'))) return;
      store.importAll(datos);
      recargarPrefs();
      renderStats();
      onPrefsChanged();
      avisoPanel('msg.datos.importados');
    } catch (err) {
      alert(t('msg.datos.error', { error: err.message }));
    }
  });

  $('#btn-wipe').addEventListener('click', () => {
    if (!confirm(t('confirm.borrar'))) return;
    store.resetAll();
    recargarPrefs();
    renderStats();
    onPrefsChanged();
    avisoPanel('msg.datos.borrados');
  });

  // ---------- ajustes ----------

  /**
   * Importar y borrar escriben las preferencias en disco, pero `game` guarda su
   * propia copia en memoria: sin releerla, el idioma (y el tema, y la modalidad)
   * del archivo importado se quedaban guardados sin llegar a aplicarse, y el
   * selector seguía enseñando el idioma anterior.
   */
  function recargarPrefs() {
    game.setPrefs({});                 // relee del almacén y avisa a la interfaz
    fijarIdioma(resolverIdioma(game.prefs.lang));
    renderSettings();
  }

  function renderSettings() {
    const prefs = game.prefs;
    for (const btn of dlgSettings.querySelectorAll('.seg-btn')) {
      const marcado = String(prefs[btn.dataset.pref]) === btn.dataset.value;
      btn.setAttribute('aria-checked', String(marcado));
      btn.tabIndex = marcado ? 0 : -1;
    }
    // El selector de idioma entra por aquí igual que las casillas y el nombre.
    for (const control of dlgSettings.querySelectorAll('input[data-pref], select[data-pref]')) {
      if (control.type === 'checkbox') control.checked = !!prefs[control.dataset.pref];
      else control.value = prefs[control.dataset.pref] ?? '';
    }
    $('#scoring-hint').textContent = t(prefs.scoring === 'vegas'
      ? 'settings.puntuacion.nota.vegas'
      : 'settings.puntuacion.nota.standard');
  }

  dlgSettings.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg-btn');
    if (!btn) return;
    const pref = btn.dataset.pref;
    const valor = pref === 'drawCount' ? Number(btn.dataset.value) : btn.dataset.value;
    const cambiaReparto = (pref === 'drawCount' || pref === 'scoring') && game.prefs[pref] !== valor
      && game.status === 'playing' && game.moves > 0;
    if (cambiaReparto && !confirm(t('confirm.modalidad'))) return;
    game.setPrefs({ [pref]: valor });
    renderSettings();
    onPrefsChanged();
  });

  dlgSettings.addEventListener('change', (event) => {
    const control = event.target.closest('input[data-pref], select[data-pref]');
    if (!control) return;
    const pref = control.dataset.pref;
    const valor = control.type === 'checkbox' ? control.checked : control.value.trim();
    game.setPrefs({ [pref]: valor });
    if (pref === 'timed' && game.status !== 'idle' && game.moves > 0) {
      avisoPanel('msg.contrarreloj', {}, 'warn');
    }
    // El idioma se cambia en caliente: recargar costaría la partida a medias, y
    // quien acaba de elegirlo quiere verlo ya, sin cerrar el panel.
    if (pref === 'lang') fijarIdioma(resolverIdioma(valor));
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
      // Dos sitios a propósito: junto al campo para quien mira, y en la región
      // viva del diálogo para quien escucha.
      pintarErrorReparto('msg.reparto.invalido');
      avisoPanel('msg.reparto.invalido', {}, 'err');
      input.focus();
      return;
    }
    pintarErrorReparto(null);
    avisoPanel(null);        // el error ya está corregido: quien escucha no debe seguir oyéndolo
    if (game.status === 'playing' && game.moves > 0 && !confirm(t('confirm.reparto'))) return;
    game.newGame(seed);
    dlgSettings.close();
    // El panel ya está cerrado: esto se cuenta fuera, en el banner del tablero.
    onMessage(isKnownSolvable(seed) ? 'msg.reparto.nuevo.comprobado' : 'msg.reparto.nuevo', { n: seed });
  });

  $('#seed-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); $('#btn-seed-go').click(); }
  });

  // ---------- reto diario ----------

  // Qué mes se está viendo y qué día está elegido. El día elegido manda: el mes
  // solo dice por dónde va el calendario cuando el jugador pasa páginas.
  let mesVisto = null;            // { anio, mes }
  let diaElegido = null;          // 'AAAA-MM-DD'

  const mismoMes = (clave) => mesVisto
    && Number(clave.slice(0, 4)) === mesVisto.anio && Number(clave.slice(5, 7)) - 1 === mesVisto.mes;

  /** Elige un día y lleva el calendario a su mes. */
  function irADia(clave) {
    diaElegido = clave;
    mesVisto = { anio: Number(clave.slice(0, 4)), mes: Number(clave.slice(5, 7)) - 1 };
  }

  /** El calendario se abre por el día que se está jugando y, si no, por hoy. */
  function centrarReto() {
    irADia(game.dia && esJugable(game.dia) ? game.dia : claveDia());
  }

  /** El último día jugable de ese mes, o null si el mes entero está fuera. */
  function ultimoJugableDe(anio, mes) {
    return rejillaDelMes(anio, mes, primerDiaSemana())
      .flat().filter((c) => c && esJugable(c)).at(-1) ?? null;
  }

  function pasarMes(paso, boton) {
    const d = new Date(mesVisto.anio, mesVisto.mes + paso, 1);
    mesVisto = { anio: d.getFullYear(), mes: d.getMonth() };
    // Si el día elegido se queda en otro mes, se elige el último jugable del que
    // se está viendo: así el botón de jugar nunca apunta a un mes invisible.
    if (!mismoMes(diaElegido)) diaElegido = ultimoJugableDe(mesVisto.anio, mesVisto.mes) ?? diaElegido;
    renderReto();
    // El botón que se acaba de pulsar puede haberse quedado desactivado al
    // llegar al tope, y entonces el navegador tira el foco al body: se recoge y
    // se le da al día elegido, que es donde el jugador estaba mirando.
    if (boton?.disabled) $('#cal .cal-dia.elegido')?.focus();
  }

  /**
   * Cómo quedó ese día: lo que se enseña bajo el calendario y en cada casilla.
   * La libreta entera se pasa por parámetro: pintar un mes son treinta y una
   * casillas, y leerla del almacén en cada una son treinta y un JSON.parse.
   */
  function resumenDeDia(clave, retos = store.getRetos()) {
    const r = retos[clave];
    // Ojo: `esJugable` también es falso para los días de hace más de un año, y
    // esos no están por llegar: están sin jugar y ya fuera de la ventana.
    if (!r) return t(esFuturo(clave) ? 'reto.futuro' : 'reto.sin.jugar');
    return t(r.won ? 'reto.hecho.ganada' : 'reto.hecho.perdida', {
      puntos: formatScore(r.scoring ?? 'standard', r.score ?? 0),
      tiempo: formatTime(r.timeMs ?? 0),
      jugadas: r.moves ?? 0,
    });
  }

  function renderReto() {
    if (!mesVisto) irADia(claveDia());
    const hoy = claveDia();
    const retos = store.getRetos();
    $('#cal-titulo').textContent = nombreMes(new Date(mesVisto.anio, mesVisto.mes, 1));

    const cal = $('#cal');
    const enCalendario = cal.contains(document.activeElement);
    // Una rejilla de fechas de verdad: `role="grid"` con sus filas y sus
    // casillas. Las filas van con `display: contents` para no romper la rejilla
    // de CSS —los días siguen siendo hijos de la cuadrícula— y sin ellas el
    // lector de pantalla canta treinta y un botones sueltos sin saber en qué
    // columna cae cada uno.
    const fila = (celdas) => {
      const div = document.createElement('div');
      div.className = 'cal-fila';
      div.setAttribute('role', 'row');
      div.append(...celdas);
      return div;
    };
    const filas = [fila(diasDeLaSemana('narrow').map((nombre) => {
      const th = document.createElement('span');
      th.className = 'cal-cab';
      th.setAttribute('role', 'columnheader');
      th.textContent = nombre;
      return th;
    }))];

    for (const semana of rejillaDelMes(mesVisto.anio, mesVisto.mes, primerDiaSemana())) {
      filas.push(fila(semana.map((clave) => {
        if (!clave) {
          const hueco = document.createElement('span');
          hueco.className = 'cal-hueco';
          hueco.setAttribute('role', 'gridcell');
          return hueco;
        }
        const r = retos[clave];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cal-dia';
        b.dataset.dia = clave;
        b.textContent = String(Number(clave.slice(8)));
        b.disabled = !esJugable(clave, hoy);
        if (clave === hoy) { b.classList.add('hoy'); b.setAttribute('aria-current', 'date'); }
        if (clave === diaElegido) b.classList.add('elegido');
        if (r) b.classList.add(r.won ? 'ganado' : 'jugado');
        b.setAttribute('role', 'gridcell');
        b.setAttribute('aria-selected', String(clave === diaElegido));
        // El tabulador entra una vez, al día elegido; dentro se anda con flechas.
        // Treinta y un tabuladores para cruzar un mes no los da nadie.
        b.tabIndex = clave === diaElegido ? 0 : -1;
        b.setAttribute('aria-label', `${fechaLarga(fechaDeClave(clave))} · ${resumenDeDia(clave, retos)}`);
        return b;
      })));
    }
    cal.replaceChildren(...filas);
    if (enCalendario) cal.querySelector('.cal-dia.elegido')?.focus();

    // Del futuro no hay nada que ver, y hacia atrás la ventana se acaba al año:
    // pasar páginas en blanco solo hace perder el sitio.
    const primeroDelMes = (paso) => claveDia(new Date(mesVisto.anio, mesVisto.mes + paso, 1));
    const ultimoDelMes = (paso) => claveDia(new Date(mesVisto.anio, mesVisto.mes + paso + 1, 0));
    $('#cal-next').disabled = esFuturo(primeroDelMes(1), hoy);
    $('#cal-prev').disabled = !esJugable(ultimoDelMes(-1), hoy);

    const jugable = esJugable(diaElegido, hoy);
    $('#reto-detalle').textContent = `${fechaLarga(fechaDeClave(diaElegido))} · ${resumenDeDia(diaElegido, retos)}`;
    const jugar = $('#btn-reto-jugar');
    jugar.disabled = !jugable;
    jugar.textContent = t(diaElegido === hoy ? 'reto.jugar.hoy' : 'reto.jugar');
    $('#btn-reto-hoy').disabled = diaElegido === hoy && mismoMes(hoy);
  }

  /** Reparte el reto de ese día. La semilla sale de la fecha y de nada más. */
  function jugarReto(clave) {
    if (!esJugable(clave)) return;
    if (game.status === 'playing' && game.moves > 0 && !confirm(t('confirm.reparto'))) return;
    game.newGame(semillaDelDia(clave), { dia: clave });
    dlgSettings.close();
    onMessage('msg.reto.nuevo', { fecha: fechaCorta(fechaDeClave(clave)) });
  }

  $('#cal').addEventListener('click', (event) => {
    const dia = event.target.closest('.cal-dia')?.dataset.dia;
    if (!dia) return;
    // El primer toque elige el día y cuenta cómo fue; el segundo, sobre el que ya
    // está elegido, reparte. Con una partida a medias por delante, repartir al
    // primer toque sería un disgusto.
    //
    // Va así y no por `dblclick` porque ese evento no llegaba nunca: elegir el
    // día repinta el calendario entero y el navegador se queda sin el botón del
    // primer clic, así que no llega a emparejarlos. Con Enter tampoco existe el
    // doble clic, y de esta forma el teclado juega igual que el dedo.
    if (dia === diaElegido) { jugarReto(dia); return; }
    diaElegido = dia;
    renderReto();
  });

  // Flechas por el calendario, como en cualquier rejilla de fechas: de día en
  // día, de semana en semana con las verticales y de mes en mes con av/re pág.
  $('#cal').addEventListener('keydown', (event) => {
    if (!event.target.closest('.cal-dia')) return;
    const dias = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    const meses = { PageUp: -1, PageDown: 1 }[event.key];
    if (dias === undefined && meses === undefined) return;
    event.preventDefault();
    const desde = fechaDeClave(diaElegido);
    if (!desde) return;
    let destino;
    if (meses !== undefined) {
      // `setMonth` arrastra el día, y del 31 de enero a febrero se desborda al 3
      // de marzo: se pone el día 1 antes de cambiar de mes y luego se recorta al
      // día que toque, o al último si el mes de destino es más corto.
      const dia = desde.getDate();
      desde.setDate(1);
      desde.setMonth(desde.getMonth() + meses);
      const ultimo = new Date(desde.getFullYear(), desde.getMonth() + 1, 0).getDate();
      desde.setDate(Math.min(dia, ultimo));
      destino = claveDia(desde);
      // Si ese día del mes aún no ha llegado, se cae al último jugable del mes.
      if (!esJugable(destino)) destino = ultimoJugableDe(desde.getFullYear(), desde.getMonth());
    } else {
      desde.setDate(desde.getDate() + dias);
      destino = claveDia(desde);
    }
    // Del futuro y de más allá del año no hay nada que ver: la flecha no sale.
    if (!esJugable(destino)) return;
    irADia(destino);
    renderReto();
    $(`#cal .cal-dia[data-dia="${destino}"]`)?.focus();
  });

  $('#cal-prev').addEventListener('click', (event) => pasarMes(-1, event.currentTarget));
  $('#cal-next').addEventListener('click', (event) => pasarMes(1, event.currentTarget));
  $('#btn-reto-jugar').addEventListener('click', () => jugarReto(diaElegido));
  $('#btn-reto-hoy').addEventListener('click', () => { irADia(claveDia()); renderReto(); });

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
      // Cada papelito cae por su lado y da sus vueltas: setenta iguales serían
      // una persiana bajando, no una celebración.
      p.style.setProperty('--deriva', `${redondea(Math.random() * 36 - 18)}vw`);
      p.style.setProperty('--giro', `${Math.round(360 + Math.random() * 720)}deg`);
      piezas.push(p);
    }
    caja.replaceChildren(...piezas);
    setTimeout(() => caja.replaceChildren(), 4200);
  }

  /** Las medallas de la victoria; se repintan solas si cambia el idioma. */
  function pintarNotasVictoria() {
    const r = game.lastResult;
    if (!r) return;
    const stats = store.getStats(r.scoring, r.drawCount);
    const notas = [];
    if (stats.bestScore === r.score) notas.push(t('dlg.victoria.nota.puntuacion'));
    if (stats.bestTimeMs === r.timeMs) notas.push(t('dlg.victoria.nota.tiempo'));
    if (stats.currentStreak > 1) notas.push(t('dlg.victoria.nota.racha', { count: stats.currentStreak }));
    if (r.dia) notas.push(t('dlg.victoria.nota.reto', { fecha: fechaCorta(fechaDeClave(r.dia)) }));
    if (r.scoring === 'vegas') {
      notas.push(t('dlg.victoria.nota.banca', { valor: formatScore('vegas', store.getBank(r.drawCount)) }));
    }
    $('#win-note').textContent = notas.join(t('app.union'));
  }

  function showWin() {
    const r = game.lastResult;
    if (!r) return;
    $('#win-score').textContent = formatScore(r.scoring, r.score);
    $('#win-time').textContent = formatTime(r.timeMs);
    $('#win-moves').textContent = String(r.moves);
    pintarNotasVictoria();

    confeti();
    dlgWin.showModal();
  }

  dlgWin.addEventListener('click', (event) => {
    const accion = event.target.closest('[data-action]')?.dataset.action;
    if (accion === 'new') { dlgWin.close(); game.newGame(); }
    if (accion === 'stats') { dlgWin.close(); api.openStats(); }
  });

  // ---------- partida sin salida ----------

  // Atascado solo mira las jugadas útiles: puede quedar el recurso de bajar una
  // carta de las pilas de arriba, y entonces no está todo perdido.
  function pintarNotaBloqueo() {
    $('#stuck-note').textContent = t(game.hasAnyMove ? 'msg.bloqueo.rescate' : 'msg.bloqueo.sinsalida');
  }

  /**
   * La partida se ha quedado sin jugadas. Se dice claro y se ofrece la salida:
   * deshacer, repetir el mismo reparto o repartir de nuevo.
   */
  function showStuck() {
    if (game.status !== 'stuck' || api.anyOpen) return;
    pintarNotaBloqueo();
    $('#dlg-stuck [data-action="undo"]').disabled = !game.canUndo;
    dlgStuck.showModal();
  }

  dlgStuck.addEventListener('click', (event) => {
    const accion = event.target.closest('[data-action]')?.dataset.action;
    if (!accion) return;
    dlgStuck.close();
    if (accion === 'undo') game.undo();
    if (accion === 'restart') game.restart();
    if (accion === 'new') game.newGame();
  });

  /**
   * Cambio de idioma en caliente: lo estático lo repinta `traducirDom`, pero
   * todo lo que hemos escrito nosotros por JS hay que rehacerlo. Sin cerrar el
   * diálogo, sin cambiar de sección y devolviendo el foco donde estaba.
   */
  function retraducir() {
    $('#panel-titulo').textContent = t(`dlg.titulo.${seccion}`);
    renderSettings();
    if (statsMode) renderStats();       // si aún no se han visto, no hay nada pintado
    // El calendario se escribe entero desde JS —nombres de mes, de día y de
    // fecha—, así que hay que rehacerlo: `traducirDom` no lo alcanza.
    if (mesVisto) renderReto();
    if (dlgWin.open) pintarNotasVictoria();
    if (dlgStuck.open) pintarNotaBloqueo();
    pintarAviso();
    pintarErrorReparto();
  }

  const api = {
    openStats() { abrir('records'); },
    openSettings() { abrir('ajustes'); },
    openHelp() { abrir('ayuda'); },
    openReto() { abrir('reto'); },
    showWin,
    showStuck,
    renderSettings,
    retraducir,
    /** Avisar dentro del panel; `main.js` la usa para actualizar e instalar. */
    avisoPanel,
    /** Qué sección se está viendo; las pruebas y el teclado lo usan. */
    get section() { return seccion; },
    get anyOpen() { return [dlgWin, dlgStuck, dlgSettings].some((d) => d.open); },
  };
  return api;
}
