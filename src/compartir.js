// Compartir la victoria: una imagen con la puntuación y el enlace al juego.
//
// Lo que se manda son dos cosas que viajan juntas: la tarjeta en PNG —que se ve
// sin pinchar, dentro de la conversación— y un texto con el enlace —que sí se
// pincha y abre el mismo reparto—. Si la partida era el reto del día, las dos
// van con la fecha por delante: quien lo reciba juega hoy esas mismas cartas y
// puede comparar, que es de lo que va el reto.
//
// El camino bueno es `navigator.share` con fichero (móviles y Safari). Donde no
// lo haya se comparte solo el texto, y donde tampoco, se descarga la imagen y se
// copia el texto para que el jugador lo pegue él. Nunca se queda sin nada: en el
// peor caso se le devuelve el enlace para que lo copie a mano.

import { idioma, t, fechaCorta, fechaLarga } from './i18n.js';
import { formatScore } from './scoring.js';
import { formatTime } from './game.js';
import { fechaDeClave } from './reto.js';
import { tarjetaPng } from './tarjeta.js';

/** El enlace que se comparte: la mano exacta, y el reto si lo era. */
export function enlaceDePartida(resultado, loc = globalThis.location) {
  const base = `${loc?.origin ?? ''}${loc?.pathname ?? ''}`;
  const params = [];
  if (resultado?.seed != null) params.push(`seed=${resultado.seed}`);
  if (resultado?.dia) params.push(`reto=${resultado.dia}`);
  return params.length ? `${base}?${params.join('&')}` : base;
}

/**
 * El enlace tal y como se pinta en la tarjeta: sin protocolo ni parámetros, que
 * ahí solo hace de firma. El que de verdad se abre va en el texto del mensaje.
 */
function enlaceALaVista(loc = globalThis.location) {
  const base = `${loc?.host ?? ''}${loc?.pathname ?? ''}`;
  return base.replace(/index\.html$/, '').replace(/\/$/, '');
}

/** «viernes, 11 de…» → «Viernes, 11 de…»: en la tarjeta la fecha abre línea. */
const conMayuscula = (texto) => (texto ? texto[0].toLocaleUpperCase(idioma()) + texto.slice(1) : texto);

export function nombreDeFichero(resultado) {
  return resultado?.dia
    ? `solitario-reto-${resultado.dia}.png`
    : `solitario-${resultado?.seed ?? 'partida'}.png`;
}

/** El mensaje que acompaña a la imagen. Con reto, la fecha manda. */
export function textoDeVictoria(resultado, enlace) {
  const puntos = formatScore(resultado.scoring, resultado.score);
  const tiempo = formatTime(resultado.timeMs);
  return resultado.dia
    ? t('compartir.texto.reto', {
      fecha: fechaCorta(fechaDeClave(resultado.dia)), puntos, tiempo, url: enlace,
    })
    : t('compartir.texto', { puntos, tiempo, jugadas: resultado.moves, url: enlace });
}

/** Lo que hay que pintar en la tarjeta, ya traducido. */
export function datosDeTarjeta(resultado, { modo = '', notas = '', loc = globalThis.location } = {}) {
  return {
    titulo: t('dlg.victoria.titulo'),
    reto: resultado.dia ? t('compartir.tarjeta.reto') : null,
    fecha: resultado.dia ? conMayuscula(fechaLarga(fechaDeClave(resultado.dia))) : null,
    modo,
    stats: [
      { etiqueta: t('dlg.victoria.puntuacion'), valor: formatScore(resultado.scoring, resultado.score) },
      { etiqueta: t('dlg.victoria.tiempo'), valor: formatTime(resultado.timeMs) },
      { etiqueta: t('dlg.victoria.jugadas'), valor: String(resultado.moves) },
    ],
    notas,
    marca: t('app.titulo'),
    enlace: enlaceALaVista(loc),
  };
}

/**
 * Empieza a dibujar la tarjeta y devuelve un cajón donde aparecerá.
 *
 * Se llama al abrir la ventana de victoria, no al pulsar «Compartir», y la razón
 * es Safari: `navigator.share()` solo funciona mientras dura el gesto del
 * jugador, y esperar a que el lienzo se convierta en PNG lo gasta. Con la
 * imagen ya hecha, el botón comparte en el mismo instante en que se toca.
 */
export function prepararTarjeta(datos, doc = globalThis.document) {
  const cajon = { blob: null, promesa: null };
  cajon.promesa = tarjetaPng(datos, doc)
    .then((blob) => { cajon.blob = blob; return blob; })
    .catch(() => null);
  return cajon;
}

/** Cancelar no es fallar: quien cierra la hoja de compartir no quiere avisos. */
const cancelado = (error) => error?.name === 'AbortError';

function ficheroDeTarjeta(blob, resultado) {
  if (!blob || typeof File !== 'function') return null;
  try {
    return new File([blob], nombreDeFichero(resultado), { type: 'image/png' });
  } catch {
    return null;
  }
}

function descargar(blob, nombre, doc) {
  const url = blob && globalThis.URL?.createObjectURL?.(blob);
  if (!url || !doc?.createElement) return false;
  const enlace = doc.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  (doc.body ?? doc.documentElement)?.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => globalThis.URL.revokeObjectURL(url), 1000);
  return true;
}

async function copiar(texto, navegador) {
  if (!navegador?.clipboard?.writeText) return false;
  try {
    await navegador.clipboard.writeText(texto);
    return true;
  } catch {
    // El portapapeles se niega si el permiso está denegado o la página perdió el
    // foco. No es el fin: el enlace se le acaba enseñando al jugador.
    return false;
  }
}

async function planB({ titulo, texto, enlace, tarjeta, resultado, navegador, doc }) {
  if (navegador?.share) {
    try {
      await navegador.share({ title: titulo, text: texto });
      return { estado: 'compartido', enlace };
    } catch (error) {
      if (cancelado(error)) return { estado: 'cancelado', enlace };
    }
  }
  const blob = tarjeta?.blob ?? await (tarjeta?.promesa ?? Promise.resolve(null));
  const guardada = descargar(blob, nombreDeFichero(resultado), doc);
  const copiada = await copiar(texto, navegador);
  if (guardada) return { estado: copiada ? 'descargada' : 'imagen', enlace };
  return { estado: copiada ? 'copiado' : 'enlace', enlace };
}

/**
 * Comparte la última victoria. Devuelve `{ estado, enlace }`, y el estado dice
 * qué hay que contarle al jugador:
 *
 *   compartido · lo recogió el sistema, no hay nada que decir
 *   cancelado  · cerró la hoja de compartir, tampoco
 *   descargada · imagen guardada y texto copiado: solo queda adjuntarla
 *   imagen     · imagen guardada, el texto no se pudo copiar
 *   copiado    · sin imagen, pero el texto con el enlace está en el portapapeles
 *   enlace     · no se pudo nada: se le enseña la URL para que la copie a mano
 *
 * No es `async` a propósito: el `share()` del camino bueno tiene que salir en el
 * mismo turno que el clic (ver `prepararTarjeta`).
 */
export function compartirVictoria({
  resultado,
  tarjeta = null,
  navegador = globalThis.navigator,
  doc = globalThis.document,
  loc = globalThis.location,
} = {}) {
  if (!resultado) return Promise.resolve({ estado: 'error', enlace: '' });
  const enlace = enlaceDePartida(resultado, loc);
  const texto = textoDeVictoria(resultado, enlace);
  const titulo = t('app.titulo');
  const comun = { titulo, texto, enlace, tarjeta, resultado, navegador, doc };
  const fichero = ficheroDeTarjeta(tarjeta?.blob, resultado);

  if (fichero && navegador?.share && navegador.canShare?.({ files: [fichero] })) {
    return Promise.resolve(navegador.share({ title: titulo, text: texto, files: [fichero] }))
      .then(() => ({ estado: 'compartido', enlace }))
      .catch((error) => (cancelado(error) ? { estado: 'cancelado', enlace } : planB(comun)));
  }
  return planB(comun);
}
