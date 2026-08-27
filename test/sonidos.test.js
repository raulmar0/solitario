// El sonido es un adorno: puede no sonar, pero no puede romper nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearSonidos } from '../src/sonidos.js';

/** Un AudioContext de mentira que apunta lo que le piden. */
function contextoFalso({ state = 'running' } = {}) {
  const nodos = [];
  const parametro = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const nodo = (tipo) => {
    nodos.push(tipo);
    return {
      tipo,
      frequency: parametro(),
      Q: parametro(),
      gain: parametro(),
      connect: (destino) => destino,
      start() {},
      stop() {},
    };
  };
  return {
    nodos,
    state,
    reanudado: 0,
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    resume() { this.reanudado += 1; },
    createOscillator: () => nodo('oscilador'),
    createGain: () => nodo('ganancia'),
    createBiquadFilter: () => nodo('filtro'),
    createBufferSource: () => nodo('fuente'),
    createBuffer: (canales, largo) => ({ getChannelData: () => new Float32Array(largo) }),
  };
}

function montar(opciones = {}) {
  const ctx = contextoFalso(opciones);
  let creados = 0;
  const sonidos = crearSonidos({
    activo: opciones.activo ?? (() => true),
    crearContexto: () => { creados += 1; return ctx; },
  });
  return { sonidos, ctx, contextos: () => creados };
}

test('cada jugada suena distinta', () => {
  const { sonidos, ctx } = montar();
  sonidos.colocar();
  assert.ok(ctx.nodos.includes('fuente'), 'la carta que cae lleva su pellizco de ruido');
  assert.ok(ctx.nodos.includes('oscilador'), 'y su golpe grave');

  const antes = ctx.nodos.length;
  sonidos.fundacion();
  assert.ok(ctx.nodos.length > antes, 'subir una carta también suena');
});

test('ganar suena a varias notas', () => {
  const { sonidos, ctx } = montar();
  sonidos.ganar();
  assert.equal(ctx.nodos.filter((n) => n === 'oscilador').length, 4, 'un arpegio de cuatro');
});

test('con el sonido apagado no se toca ni el contexto', () => {
  const { sonidos, ctx, contextos } = montar({ activo: () => false });
  for (const nombre of ['robar', 'colocar', 'fundacion', 'voltear', 'nada', 'deshacer', 'atasco', 'ganar', 'barajar']) {
    sonidos[nombre]();
  }
  assert.equal(contextos(), 0, 'ni se crea');
  assert.equal(ctx.nodos.length, 0);
});

test('el contexto se crea una sola vez, por muchos sonidos que se pidan', () => {
  const { sonidos, contextos } = montar();
  sonidos.robar();
  sonidos.colocar();
  sonidos.voltear();
  assert.equal(contextos(), 1);
});

test('un contexto dormido se despierta: los navegadores lo dejan así hasta que tocas', () => {
  const { sonidos, ctx } = montar({ state: 'suspended' });
  sonidos.robar();
  assert.ok(ctx.reanudado > 0);
});

test('sin Web Audio en el navegador, el juego sigue como si nada', () => {
  const mudo = crearSonidos({ crearContexto: () => null });
  for (const nombre of ['robar', 'colocar', 'fundacion', 'voltear', 'nada', 'deshacer', 'atasco', 'ganar', 'barajar']) {
    assert.doesNotThrow(() => mudo[nombre](), nombre);
  }
});

test('si crear el contexto revienta, tampoco pasa nada', () => {
  const roto = crearSonidos({ crearContexto: () => { throw new Error('sin audio'); } });
  assert.doesNotThrow(() => roto.colocar());
  assert.doesNotThrow(() => roto.ganar(), 'y lo vuelve a intentar sin acumular el fallo');
});
