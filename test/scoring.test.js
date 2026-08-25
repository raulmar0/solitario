import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvents, initialScore, timePenalty, winBonus, formatScore, getMode } from '../src/scoring.js';

const ctx1 = { drawCount: 1 };
const ctx3 = { drawCount: 3 };

test('estándar: puntos por cada tipo de jugada', () => {
  const s = (events, ctx = ctx1) => applyEvents('standard', 100, events, ctx);
  assert.equal(s([{ type: 'move', from: 'waste', to: 'foundation' }]), 110);
  assert.equal(s([{ type: 'move', from: 'tableau', to: 'foundation' }]), 110);
  assert.equal(s([{ type: 'move', from: 'waste', to: 'tableau' }]), 105);
  assert.equal(s([{ type: 'move', from: 'tableau', to: 'tableau' }]), 100, 'mover dentro del tableau no puntúa');
  assert.equal(s([{ type: 'move', from: 'foundation', to: 'tableau' }]), 85);
  assert.equal(s([{ type: 'flip' }]), 105);
  assert.equal(s([{ type: 'draw', count: 1 }]), 100, 'robar no puntúa');
});

test('estándar: penalización por reciclar según la forma de robar', () => {
  assert.equal(applyEvents('standard', 300, [{ type: 'recycle', recycles: 1 }], ctx1), 200);
  assert.equal(applyEvents('standard', 300, [{ type: 'recycle', recycles: 1 }], ctx3), 300, 'robando de 3 las tres primeras pasadas son gratis');
  assert.equal(applyEvents('standard', 300, [{ type: 'recycle', recycles: 2 }], ctx3), 300);
  assert.equal(applyEvents('standard', 300, [{ type: 'recycle', recycles: 3 }], ctx3), 280);
  assert.equal(applyEvents('standard', 300, [{ type: 'recycle', recycles: 9 }], ctx3), 280);
});

test('estándar: la puntuación nunca baja de cero', () => {
  assert.equal(applyEvents('standard', 10, [{ type: 'recycle', recycles: 1 }], ctx1), 0);
  assert.equal(applyEvents('standard', 0, [{ type: 'move', from: 'foundation', to: 'tableau' }], ctx1), 0);
  assert.equal(initialScore('standard'), 0);
});

test('estándar: varios eventos se acumulan en orden', () => {
  const events = [
    { type: 'move', from: 'tableau', to: 'foundation' },
    { type: 'flip' },
    { type: 'move', from: 'waste', to: 'tableau' },
  ];
  assert.equal(applyEvents('standard', 0, events, ctx1), 20);
});

test('estándar cronometrado: -2 puntos por cada 10 s cumplidos', () => {
  assert.equal(timePenalty('standard', 0), 0);
  assert.equal(timePenalty('standard', 9), 0);
  assert.equal(timePenalty('standard', 10), -2);
  assert.equal(timePenalty('standard', 59), -10);
  assert.equal(timePenalty('standard', 600), -120);
});

test('estándar: bonificación por ganar rápido', () => {
  assert.equal(winBonus('standard', 29), 0, 'menos de 30 s no bonifica');
  assert.equal(winBonus('standard', 30), Math.floor(700000 / 30));
  assert.equal(winBonus('standard', 100), 7000);
  assert.ok(winBonus('standard', 60) > winBonus('standard', 120), 'cuanto más rápido, más bonificación');
});

test('Vegas: 52 $ de entrada y 5 $ por carta subida', () => {
  assert.equal(initialScore('vegas'), -52);
  assert.equal(applyEvents('vegas', -52, [{ type: 'move', from: 'waste', to: 'foundation' }]), -47);
  assert.equal(applyEvents('vegas', -52, [{ type: 'move', from: 'tableau', to: 'foundation' }]), -47);
  assert.equal(applyEvents('vegas', 0, [{ type: 'move', from: 'foundation', to: 'tableau' }]), -5);
  assert.equal(applyEvents('vegas', 0, [{ type: 'flip' }]), 0, 'destapar no paga');
  assert.equal(applyEvents('vegas', 0, [{ type: 'recycle', recycles: 1 }]), 0, 'reciclar no penaliza, se limitan las pasadas');
});

test('Vegas: puede quedarse en negativo y no tiene tiempo ni bonificación', () => {
  assert.equal(applyEvents('vegas', -52, [{ type: 'move', from: 'foundation', to: 'tableau' }]), -57);
  assert.equal(timePenalty('vegas', 600), 0);
  assert.equal(winBonus('vegas', 60), 0);
});

test('Vegas: partida perfecta deja +208 $', () => {
  const events = Array.from({ length: 52 }, () => ({ type: 'move', from: 'tableau', to: 'foundation' }));
  assert.equal(applyEvents('vegas', initialScore('vegas'), events), 208);
});

test('formatScore', () => {
  assert.equal(formatScore('standard', 1234), '1234');
  assert.equal(formatScore('vegas', 30), '+30 $');
  assert.equal(formatScore('vegas', -52), '−52 $');
});

test('modo desconocido, error claro', () => {
  assert.throws(() => getMode('poker'), /desconocido/);
});
