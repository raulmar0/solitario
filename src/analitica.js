// Visitas y uso, con Simple Analytics. No hay clave: el dominio de la página es
// lo que asocia la visita con el panel. No se manda el nombre del jugador ni lo
// que hay en la partida guardada; sí cómo se juega, para poder verlo después.
//
// En local no se carga el script. Si se cargara, cada prueba y cada `npm run dev`
// contarían como una visita. Los eventos se encolan igual: cuando el script
// llega, vacía esa cola.

const SCRIPT = 'https://scripts.simpleanalyticscdn.com/latest.js';
const MARCA = Symbol.for('solitario.analitica');

const CLAVES_PROHIBIDAS = new Set([
  'player', 'playername', 'nombre', 'email', 'correo', 'mail',
]);

/** localhost, 127.0.0.1 y un hostname vacío (file://, pruebas) no se miden. */
export function esLocal(hostname = '') {
  const h = String(hostname).trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === '' || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

/** El script real solo en un navegador de verdad, fuera de local. */
export function debeMedir({ hostname = '', userAgent = '', webdriver = false } = {}) {
  if (webdriver) return false;
  if (/jsdom/i.test(userAgent)) return false;
  return !esLocal(hostname);
}

/**
 * Simple Analytics solo guarda texto, números finitos, booleanos y fechas.
 * El nombre y un correo no salen ni aunque alguien los pase por aquí.
 */
export function limpiarMetadatos(crudo) {
  const limpio = {};
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return limpio;
  for (const [clave, valor] of Object.entries(crudo)) {
    if (CLAVES_PROHIBIDAS.has(clave.toLowerCase())) continue;
    const listo = metadato(valor);
    if (listo !== undefined) limpio[clave] = listo;
  }
  return limpio;
}

function metadato(valor) {
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : undefined;
  if (typeof valor === 'string') {
    const texto = valor.trim().slice(0, 1000);
    if (!texto) return undefined;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) return undefined;
    return texto;
  }
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor;
  return undefined;
}

/** La misma cola que documenta Simple Analytics, por si el script aún no ha llegado. */
function asegurarCola() {
  const w = globalThis;
  if (typeof w.sa_event === 'function') return;
  w.sa_event = function sa_event() {
    const args = [].slice.call(arguments);
    if (w.sa_event.q) w.sa_event.q.push(args);
    else w.sa_event.q = [args];
  };
}

/**
 * Un evento. Nunca lanza: medir una jugada no puede deshacerla.
 * Los metadatos se fotografían ahora; el colector de la visita no los pisa
 * porque usa otras claves (las de los ajustes, no las de la mano).
 */
export function evento(nombre, meta) {
  try {
    asegurarCola();
    const limpio = limpiarMetadatos(meta);
    if (Object.keys(limpio).length) globalThis.sa_event(nombre, limpio);
    else globalThis.sa_event(nombre);
  } catch { /* el adorno nunca manda */ }
}

let motivoPendiente = null;

/** La próxima mano se anotará con este motivo. Se consume al repartir. */
export function motivo(valor) {
  motivoPendiente = valor == null || valor === '' ? null : String(valor);
}

export function tomarMotivo(defecto = 'otra') {
  const valor = motivoPendiente || defecto;
  motivoPendiente = null;
  return valor;
}

/** Lo que se puede decir de la mano que está puesta, sin el nombre. */
export function eventoPartida(nombre, game, extra = {}) {
  const modo = game?.mode ?? {};
  evento(nombre, {
    semilla: game?.seed ?? undefined,
    reto: !!game?.dia,
    dia: game?.dia || undefined,
    robo: modo.drawCount,
    puntuacion: modo.scoring,
    contrarreloj: !!modo.timed,
    penalizar_pistas: !!modo.penalizeHints,
    manos: game?.prefs?.dealBias,
    jugadas: game?.moves,
    pistas: game?.hints,
    deshacer: game?.undos,
    segundos: Math.floor((game?.elapsedMs ?? 0) / 1000),
    puntos: game?.score,
    fundaciones: game?.foundationCount,
    partida: game?.status,
    ...extra,
  });
}

/**
 * A partir de aquí, cada reparto, cada deshacer y cada atasco salen solos.
 * Hay que llamarlo cuando la mano de arranque ya está puesta: si no, el primer
 * reparto se contaría dos veces.
 */
export function observarPartida(game) {
  let deal = game.dealId;
  let undos = game.undos;
  let atascada = game.status === 'stuck';
  return game.subscribe(() => {
    try {
      if (game.dealId !== deal) {
        deal = game.dealId;
        undos = game.undos;
        atascada = false;
        eventoPartida('partida_nueva', game, { motivo: tomarMotivo() });
      } else if (game.undos > undos) {
        undos = game.undos;
        evento('deshacer', {
          n: game.undos,
          jugadas: game.moves,
          semilla: game.seed ?? undefined,
        });
      } else {
        undos = game.undos;
      }
      if (game.status === 'stuck' && !atascada) {
        atascada = true;
        evento('partida_atascada', {
          jugadas: game.moves,
          pistas: game.hints,
          rescate: !!game.hasAnyMove,
          semilla: game.seed ?? undefined,
          reto: !!game.dia,
        });
      } else if (game.status !== 'stuck') {
        atascada = false;
      }
    } catch { /* medir no mueve cartas */ }
  });
}

/** Un ajuste. El nombre no viaja: solo si está vacío o no. */
export function ajuste(clave, valor) {
  if (clave === 'playerName') {
    evento('ajuste', { clave: 'nombre', vacio: String(valor ?? '').trim() === '' });
    return;
  }
  evento('ajuste', { clave, valor });
}

let leerContexto = () => ({});

/**
 * Lo que acompaña a cada visita y a cada evento: idioma, ajustes, pantalla.
 * Se lee al enviar, no al cargar, así que un cambio de tema llega a lo que
 * se mande después. El script lo busca en `window` por el nombre que se le da
 * en `data-metadata-collector`.
 */
export function definirContexto(leer) {
  leerContexto = typeof leer === 'function' ? leer : () => ({});
  globalThis.saMetadata = (datos) => {
    try {
      return limpiarMetadatos(leerContexto(datos));
    } catch {
      return {};
    }
  };
}

let alSalirFn = null;

/** Foto de la partida al cerrar la pestaña. Se llama en el `pagehide`. */
export function alSalir(fn) {
  alSalirFn = typeof fn === 'function' ? fn : null;
}

/**
 * Carga el script y escucha lo que el propio HTML no anota: enlaces que se van
 * del sitio, la red y el cierre de la pestaña.
 *
 * No se usa `auto-events.js`. Ese script escribe un `onclick` en cada enlace, y
 * la política de seguridad no permite manejadores en línea. El clic se escucha
 * desde aquí, que es un módulo nuestro.
 */
export function montar({
  document: doc = globalThis.document,
  destino = globalThis,
  hostname = globalThis.location?.hostname ?? '',
  userAgent = globalThis.navigator?.userAgent ?? '',
  webdriver = globalThis.navigator?.webdriver === true,
} = {}) {
  activarOyentes(doc, destino);
  if (!debeMedir({ hostname, userAgent, webdriver })) return;
  if (!doc?.head?.append || !doc.createElement) return;
  if (doc.querySelector?.('script[src*="simpleanalyticscdn.com/latest"]')) return;

  asegurarCola();
  const script = doc.createElement('script');
  script.async = true;
  script.src = SCRIPT;
  // Con Do Not Track activo el script, por defecto, no apunta la visita.
  script.dataset.collectDnt = 'true';
  // `seed` y `reto` son la mano compartida, no un identificador de la persona.
  // Los utm ya se recogen solos; un clic de anuncio (gclid, fbclid) no.
  script.dataset.allowParams = 'seed,reto';
  script.dataset.metadataCollector = 'saMetadata';
  doc.head.append(script);
}

function activarOyentes(doc, destino) {
  const marca = destino ?? doc;
  if (!marca || marca[MARCA]) return;
  try { marca[MARCA] = true; } catch { return; }

  doc?.addEventListener?.('click', alClicEnlace, true);
  destino?.addEventListener?.('pagehide', () => {
    let extra = {};
    try { extra = alSalirFn?.() ?? {}; } catch { extra = {}; }
    evento('salida', extra);
  });
  destino?.addEventListener?.('offline', () => evento('sin_conexion'));
  destino?.addEventListener?.('online', () => evento('con_conexion'));
}

const EXTENSIONES = /^(pdf|csv|docx|xlsx|zip|doc|xls|json|png|txt)$/;

function alClicEnlace(event) {
  try {
    const nodo = event.target?.closest ? event.target : event.target?.parentElement;
    const enlace = nodo?.closest?.('a[href]');
    if (!enlace) return;
    const href = enlace.getAttribute('href') || '';
    if (/^mailto:/i.test(href)) {
      evento('enlace_correo');
      return;
    }
    const url = new URL(enlace.href, globalThis.location?.href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin === globalThis.location?.origin) {
      const ext = url.pathname.split('.').pop()?.toLowerCase() ?? '';
      if (EXTENSIONES.test(ext)) evento('descarga', { extension: ext });
      return;
    }
    evento('enlace_saliente', {
      dominio: url.hostname,
      ruta: url.pathname.slice(0, 300),
    });
  } catch { /* un enlace raro no puede romper el clic */ }
}
