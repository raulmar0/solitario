// Compartir la victoria: el enlace, el texto, la tarjeta y los caminos que
// quedan cuando el navegador no sabe compartir ficheros. Lo que no puede pasar
// es que el jugador pulse «Compartir» y no se lleve nada.
import test from 'node:test';
import assert from 'node:assert/strict';

import { fijarIdioma, t } from '../src/i18n.js';
import {
  compartirVictoria, datosDeTarjeta, enlaceDePartida, nombreDeFichero, textoDeVictoria,
} from '../src/compartir.js';
import { pintarTarjeta, TARJETA } from '../src/tarjeta.js';

fijarIdioma('es');

const LOC = { origin: 'https://ejemplo.test', pathname: '/solitario/', host: 'ejemplo.test' };

const partida = (extra = {}) => ({
  scoring: 'standard',
  drawCount: 1,
  score: 4227,
  timeMs: 192000,
  moves: 126,
  seed: 391,
  dia: null,
  ...extra,
});

/** Un lienzo de mentira que apunta lo que se le pide pintar. */
function lienzoFalso() {
  const textos = [];
  const rellenos = [];
  const trazos = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '', lineWidth: 0,
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {},
    roundRect() {},
    fill() { rellenos.push(ctx.fillStyle); },
    stroke() { trazos.push({ color: ctx.strokeStyle, grosor: ctx.lineWidth }); },
    measureText: (texto) => ({ width: String(texto).length * 18 }),
    fillText(texto) { textos.push({ texto: String(texto), color: ctx.fillStyle }); },
  };
  return { ctx, textos, rellenos, trazos };
}

// ------------------------------------------------------------------ el enlace

test('el enlace comparte la mano exacta, y el reto va marcado como reto', () => {
  assert.equal(enlaceDePartida(partida(), LOC), 'https://ejemplo.test/solitario/?seed=391');
  assert.equal(
    enlaceDePartida(partida({ dia: '2026-09-11' }), LOC),
    'https://ejemplo.test/solitario/?seed=391&reto=2026-09-11',
    'con el día puesto, quien abra el enlace juega el reto y le cuenta en su calendario',
  );
});

test('el fichero se llama por lo que lleva dentro', () => {
  assert.equal(nombreDeFichero(partida()), 'solitario-391.png');
  assert.equal(nombreDeFichero(partida({ dia: '2026-09-11' })), 'solitario-reto-2026-09-11.png');
});

test('el texto del mensaje lleva siempre la puntuación, el tiempo y el enlace', () => {
  const enlace = enlaceDePartida(partida(), LOC);
  const texto = textoDeVictoria(partida(), enlace);
  assert.match(texto, /4227/);
  assert.match(texto, /03:12/);
  assert.ok(texto.includes(enlace), 'sin enlace el mensaje no sirve de invitación');
});

test('si la partida era el reto del día, el mensaje lo dice y con su fecha', () => {
  const r = partida({ dia: '2026-09-11' });
  const texto = textoDeVictoria(r, enlaceDePartida(r, LOC));
  assert.notEqual(texto, textoDeVictoria(partida(), 'x'), 'el reto no se anuncia como una partida suelta');
  assert.match(texto, /sept/, 'la fecha del reto va en el mensaje');
  assert.match(texto, /reto/i);
});

// ----------------------------------------------------------------- la tarjeta

test('la tarjeta lleva el marcador entero y la firma del juego', () => {
  const { ctx, textos } = lienzoFalso();
  pintarTarjeta(ctx, datosDeTarjeta(partida(), { modo: 'Estándar · 1 carta', notas: 'Récord de tiempo', loc: LOC }), TARJETA);
  const dichos = textos.map((x) => x.texto);
  assert.ok(dichos.includes(t('dlg.victoria.titulo')));
  assert.ok(dichos.includes('4227') && dichos.includes('03:12') && dichos.includes('126'));
  assert.ok(dichos.includes('Récord de tiempo'), 'las medallas también se comparten');
  assert.ok(dichos.includes(t('app.titulo')));
  assert.ok(dichos.includes('ejemplo.test/solitario'), 'el pie firma con la dirección del juego');
});

test('la tarjeta del reto del día se anuncia como tal, en dorado y con la fecha', () => {
  const r = partida({ dia: '2026-09-11' });
  const { ctx, textos, trazos } = lienzoFalso();
  pintarTarjeta(ctx, datosDeTarjeta(r, { loc: LOC }), TARJETA);
  const dichos = textos.map((x) => x.texto);
  assert.ok(dichos.includes(t('compartir.tarjeta.reto')), 'la chapa del reto va en la tarjeta');
  assert.ok(dichos.some((x) => /11 de septiembre de 2026/.test(x)), 'y la fecha entera debajo');
  assert.ok(trazos.some((x) => x.color === '#f0c453'), 'el borde se vuelve dorado');

  // Y una partida suelta no se disfraza de reto.
  const suelta = lienzoFalso();
  pintarTarjeta(suelta.ctx, datosDeTarjeta(partida(), { loc: LOC }), TARJETA);
  assert.equal(suelta.textos.some((x) => x.texto === t('compartir.tarjeta.reto')), false);
  assert.equal(suelta.trazos.some((x) => x.color === '#f0c453'), false);
});

// -------------------------------------------------- los caminos de compartir

const blobFalso = { size: 10, type: 'image/png' };
const tarjetaLista = () => ({ blob: blobFalso, promesa: Promise.resolve(blobFalso) });

test('donde se pueden compartir ficheros, se manda la imagen con el texto', async () => {
  const compartido = [];
  const navegador = {
    canShare: ({ files }) => files?.length === 1,
    share: (datos) => { compartido.push(datos); return Promise.resolve(); },
  };
  const { estado } = await compartirVictoria({
    resultado: partida(), tarjeta: tarjetaLista(), navegador, doc: null, loc: LOC,
  });
  assert.equal(estado, 'compartido');
  assert.equal(compartido[0].files.length, 1);
  assert.equal(compartido[0].files[0].type, 'image/png');
  assert.match(compartido[0].text, /ejemplo\.test/);
});

test('cerrar la hoja de compartir no es un fallo y no deja aviso', async () => {
  const navegador = {
    canShare: () => true,
    share: () => Promise.reject(Object.assign(new Error('no'), { name: 'AbortError' })),
  };
  const { estado } = await compartirVictoria({
    resultado: partida(), tarjeta: tarjetaLista(), navegador, doc: null, loc: LOC,
  });
  assert.equal(estado, 'cancelado');
});

test('sin ficheros pero con compartir, va el texto solo', async () => {
  const compartido = [];
  const navegador = {
    canShare: () => false,
    share: (datos) => { compartido.push(datos); return Promise.resolve(); },
  };
  const { estado } = await compartirVictoria({
    resultado: partida(), tarjeta: tarjetaLista(), navegador, doc: null, loc: LOC,
  });
  assert.equal(estado, 'compartido');
  assert.equal(compartido[0].files, undefined);
  assert.match(compartido[0].text, /4227/);
});

test('sin compartir nativo, la imagen se descarga y el texto se copia', async () => {
  const copiado = [];
  const pinchados = [];
  const doc = {
    body: { append() {} },
    createElement: () => ({
      set href(v) { this._href = v; },
      download: '',
      click() { pinchados.push(this.download); },
      remove() {},
    }),
  };
  const urlPrevia = globalThis.URL.createObjectURL;
  const revokePrevia = globalThis.URL.revokeObjectURL;
  globalThis.URL.createObjectURL = () => 'blob:falso';
  globalThis.URL.revokeObjectURL = () => {};
  try {
    const { estado } = await compartirVictoria({
      resultado: partida({ dia: '2026-09-11' }),
      tarjeta: tarjetaLista(),
      navegador: { clipboard: { writeText: (x) => { copiado.push(x); return Promise.resolve(); } } },
      doc,
      loc: LOC,
    });
    assert.equal(estado, 'descargada');
    assert.deepEqual(pinchados, ['solitario-reto-2026-09-11.png']);
    assert.match(copiado[0], /reto=2026-09-11/);
  } finally {
    globalThis.URL.createObjectURL = urlPrevia;
    globalThis.URL.revokeObjectURL = revokePrevia;
  }
});

test('si no se puede ni copiar ni descargar, se devuelve el enlace para copiarlo a mano', async () => {
  const { estado, enlace } = await compartirVictoria({
    resultado: partida(), tarjeta: { blob: null, promesa: Promise.resolve(null) },
    navegador: {}, doc: null, loc: LOC,
  });
  assert.equal(estado, 'enlace');
  assert.equal(enlace, 'https://ejemplo.test/solitario/?seed=391');
});
