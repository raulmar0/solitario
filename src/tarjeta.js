// La tarjeta que se comparte: la puntuación dibujada sobre un lienzo.
//
// No es una captura de pantalla del diálogo —fotografiar el DOM pediría traerse
// una biblioteca, y aquí no hay ni build ni dependencias— sino el mismo cartel
// de victoria repintado en un PNG cuadrado: mismos colores, mismos datos y el
// enlace al juego debajo. Así el mensaje se entiende solo, sin que quien lo
// reciba tenga que pinchar en nada.
//
// Módulo de dibujo y nada más: no sabe de partidas ni de idiomas. Recibe las
// cadenas ya traducidas en `datos` y las coloca.

/** El lienzo: cuadrado, que es lo que mejor se ve en cualquier conversación. */
export const TARJETA = { ancho: 1080, alto: 1080 };

// La tarjeta va siempre en oscuro, tenga el juego el tema que tenga: se mira
// dentro de un chat, y el verde de tapete es lo que la hace reconocible de un
// vistazo. Los colores son los mismos que los del tema oscuro de la hoja.
const COLOR = {
  tapeteAlto: '#14663f',
  tapeteBajo: '#0b3f28',
  panel: '#10261d',
  casilla: '#16342a',
  linea: 'rgba(255, 255, 255, .14)',
  tinta: '#f2f7f4',
  tintaSuave: 'rgba(242, 247, 244, .72)',
  acento: '#f0c453',
  acentoTinta: '#2a2000',
};

const FAMILIA = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
const fuente = (peso, tamano) => `${peso} ${tamano}px ${FAMILIA}`;
const PALOS = ['♠', '♥', '♦', '♣'];

const MARCO = 56;            // el tapete que asoma alrededor del cartel
const SANGRIA = 64;          // el aire entre el borde del cartel y su contenido
const CASILLA = { ancho: 250, alto: 182, hueco: 26, radio: 22 };

/** Un rectángulo redondeado, con recambio para los navegadores sin `roundRect`. */
function caja(ctx, x, y, ancho, alto, radio) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, ancho, alto, radio); return; }
  ctx.moveTo(x + radio, y);
  ctx.arcTo(x + ancho, y, x + ancho, y + alto, radio);
  ctx.arcTo(x + ancho, y + alto, x, y + alto, radio);
  ctx.arcTo(x, y + alto, x, y, radio);
  ctx.arcTo(x, y, x + ancho, y, radio);
  ctx.closePath();
}

function escribir(ctx, texto, x, y, { font, color, align = 'center', baseline = 'alphabetic' }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(String(texto), x, y);
}

/**
 * Como `escribir`, pero encogiendo la letra hasta que quepa. Lo piden los
 * valores de las casillas: una puntuación de Vegas o un tiempo con horas no
 * ocupan lo mismo que «4227», y el que se pase se saldría de su caja.
 */
function escribirAjustado(ctx, texto, x, y, { peso, tamano, color, minimo = 24, ancho }) {
  let punto = tamano;
  ctx.font = fuente(peso, punto);
  while (punto > minimo && ctx.measureText(String(texto)).width > ancho) {
    punto -= 2;
    ctx.font = fuente(peso, punto);
  }
  escribir(ctx, texto, x, y, { font: fuente(peso, punto), color, baseline: 'middle' });
}

/** Parte el texto en las líneas que quepan; lo que sobra se queda fuera. */
function lineas(ctx, texto, ancho, maximo = 2) {
  const palabras = String(texto).split(/\s+/).filter(Boolean);
  const salida = [];
  let linea = '';
  for (const palabra of palabras) {
    const prueba = linea ? `${linea} ${palabra}` : palabra;
    if (linea && ctx.measureText(prueba).width > ancho) {
      salida.push(linea);
      linea = palabra;
      if (salida.length === maximo) return salida;
    } else {
      linea = prueba;
    }
  }
  if (linea) salida.push(linea);
  return salida;
}

/** La chapa dorada del reto: se lee antes que nada, que para eso está. */
function chapa(ctx, texto, centro, y, alto = 72) {
  const font = fuente(700, 32);
  ctx.font = font;
  const ancho = ctx.measureText(texto).width + 80;
  caja(ctx, centro - ancho / 2, y, ancho, alto, alto / 2);
  ctx.fillStyle = COLOR.acento;
  ctx.fill();
  escribir(ctx, texto, centro, y + alto / 2 + 2, { font, color: COLOR.acentoTinta, baseline: 'middle' });
  return y + alto;
}

/** Los cuatro palos, uno a uno para poder separarlos a mano. */
function palos(ctx, centro, y, tamano, color) {
  const font = fuente(400, tamano);
  ctx.font = font;
  const hueco = tamano * 0.5;
  const anchos = PALOS.map((p) => ctx.measureText(p).width);
  const total = anchos.reduce((a, b) => a + b, 0) + hueco * (PALOS.length - 1);
  let x = centro - total / 2;
  for (const [i, palo] of PALOS.entries()) {
    escribir(ctx, palo, x, y, { font, color, align: 'left', baseline: 'top' });
    x += anchos[i] + hueco;
  }
}

/**
 * Pinta la tarjeta entera. `datos`:
 *
 *   { titulo, reto, fecha, modo, stats: [{ etiqueta, valor }], notas, marca, enlace }
 *
 * `reto` es la etiqueta del reto del día —«Reto del día»— o nada si la partida
 * era una suelta. Cuando viene, la tarjeta se vuelve dorada: chapa arriba, fecha
 * debajo, borde y palos del color del acento. Es el énfasis que pide el reto:
 * quien lo reciba tiene que ver que es la mano de hoy, la misma que le tocaría
 * a él, y no una partida cualquiera.
 */
export function pintarTarjeta(ctx, datos, medidas = TARJETA) {
  const { ancho, alto } = medidas;
  const esReto = !!datos.reto;
  const realce = esReto ? COLOR.acento : COLOR.tinta;
  const centro = ancho / 2;
  const util = ancho - 2 * (MARCO + SANGRIA);

  const tapete = ctx.createLinearGradient(0, 0, 0, alto);
  tapete.addColorStop(0, COLOR.tapeteAlto);
  tapete.addColorStop(1, COLOR.tapeteBajo);
  ctx.fillStyle = tapete;
  ctx.fillRect(0, 0, ancho, alto);

  caja(ctx, MARCO, MARCO, ancho - 2 * MARCO, alto - 2 * MARCO, 48);
  ctx.fillStyle = COLOR.panel;
  ctx.fill();
  ctx.lineWidth = esReto ? 5 : 2;
  ctx.strokeStyle = esReto ? COLOR.acento : COLOR.linea;
  ctx.stroke();

  let y = esReto ? 128 : 220;

  if (esReto) {
    y = chapa(ctx, datos.reto, centro, y) + 22;
    if (datos.fecha) {
      escribir(ctx, datos.fecha, centro, y + 34, { font: fuente(600, 34), color: COLOR.acento });
      y += 74;
    }
  }

  palos(ctx, centro, y, 64, realce);
  y += 92;

  escribir(ctx, datos.titulo, centro, y + 66, { font: fuente(700, 74), color: COLOR.tinta });
  y += 92;

  if (datos.modo) {
    escribir(ctx, datos.modo, centro, y + 28, { font: fuente(500, 28), color: COLOR.tintaSuave });
    y += 58;
  }

  const stats = datos.stats ?? [];
  if (stats.length) {
    const total = stats.length * CASILLA.ancho + (stats.length - 1) * CASILLA.hueco;
    let x = centro - total / 2;
    for (const { etiqueta, valor } of stats) {
      caja(ctx, x, y, CASILLA.ancho, CASILLA.alto, CASILLA.radio);
      ctx.fillStyle = COLOR.casilla;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLOR.linea;
      ctx.stroke();
      escribir(ctx, etiqueta, x + CASILLA.ancho / 2, y + 56, {
        font: fuente(600, 24), color: COLOR.tintaSuave, baseline: 'middle',
      });
      escribirAjustado(ctx, valor, x + CASILLA.ancho / 2, y + 124, {
        peso: 700, tamano: 58, color: COLOR.tinta, ancho: CASILLA.ancho - 32,
      });
      x += CASILLA.ancho + CASILLA.hueco;
    }
    y += CASILLA.alto + 30;
  }

  if (datos.notas) {
    ctx.font = fuente(700, 36);
    for (const linea of lineas(ctx, datos.notas, util)) {
      escribir(ctx, linea, centro, y + 34, { font: fuente(700, 36), color: COLOR.acento });
      y += 48;
    }
  }

  // El pie va anclado abajo, no detrás de las notas: el enlace tiene que caer
  // siempre en el mismo sitio, tenga la partida una medalla o cuatro.
  const pie = alto - MARCO - 140;
  ctx.strokeStyle = COLOR.linea;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARCO + SANGRIA, pie);
  ctx.lineTo(ancho - MARCO - SANGRIA, pie);
  ctx.stroke();
  if (datos.marca) {
    escribir(ctx, datos.marca, centro, pie + 56, { font: fuente(700, 36), color: COLOR.tinta });
  }
  if (datos.enlace) {
    escribir(ctx, datos.enlace, centro, pie + 102, { font: fuente(500, 30), color: COLOR.tintaSuave });
  }
}

/**
 * La tarjeta hecha PNG. Devuelve null —sin reventar— allí donde no haya lienzo
 * de verdad: en las pruebas con jsdom y en cualquier navegador que no sepa
 * convertirlo a imagen. Quien llama se queda entonces con el texto y el enlace,
 * que es lo mínimo que hay que poder compartir.
 */
export function tarjetaPng(datos, doc = globalThis.document) {
  const canvas = doc?.createElement?.('canvas');
  if (!canvas) return Promise.resolve(null);
  canvas.width = TARJETA.ancho;
  canvas.height = TARJETA.alto;
  let ctx = null;
  try { ctx = canvas.getContext?.('2d'); } catch { ctx = null; }
  if (!ctx || !canvas.toBlob) return Promise.resolve(null);
  try {
    pintarTarjeta(ctx, datos);
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolver) => {
    canvas.toBlob((blob) => resolver(blob ?? null), 'image/png');
  });
}
