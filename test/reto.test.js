// El reto diario: la fecha manda sobre el reparto y el calendario se dibuja
// solo con cuentas de días. Módulo puro, así que se prueba sin navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAS_ATRAS, claveDia, distanciaDias, esClaveValida, esFuturo, esJugable,
  fechaDeClave, mejorResultado, rejillaDelMes, semillaDelDia,
} from '../src/reto.js';
import { SOLVABLE_SEEDS } from '../src/solvable-seeds.js';

test('la clave del día es la fecha local, no la UTC', () => {
  // A las 23:30 de un 31 de diciembre, en UTC ya es el día siguiente. El reto va
  // por el calendario del jugador: quien juega al lado tiene el mismo, que es de
  // lo que se trata.
  assert.equal(claveDia(new Date(2026, 11, 31, 23, 30)), '2026-12-31');
  assert.equal(claveDia(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
  assert.equal(claveDia(new Date(2026, 7, 9)), '2026-08-09', 'un dígito se rellena con cero');
  assert.equal(claveDia(new Date('no es una fecha')), null);
});

test('una clave válida es una fecha que existe de verdad', () => {
  assert.equal(esClaveValida('2026-08-29'), true);
  assert.equal(esClaveValida('2024-02-29'), true, 'año bisiesto');
  assert.equal(esClaveValida('2026-02-29'), false, 'ese día no existe');
  assert.equal(esClaveValida('2026-13-01'), false);
  assert.equal(esClaveValida('2026-8-9'), false, 'sin rellenar no vale: el orden alfabético dejaría de ser el cronológico');
  assert.equal(esClaveValida(''), false);
  assert.equal(esClaveValida(null), false);
  assert.equal(esClaveValida(20260829), false);
});

test('la semilla sale del día y solo del día', () => {
  assert.equal(semillaDelDia('2026-08-29'), semillaDelDia('2026-08-29'), 'la misma fecha, el mismo reparto');
  assert.notEqual(semillaDelDia('2026-08-29'), semillaDelDia('2026-08-30'));
  assert.equal(semillaDelDia('no vale'), null);

  // Dentro del rango de repartos que acepta el juego (el campo de Ajustes y el
  // parámetro ?seed= piden entre 1 y 999999).
  for (const clave of ['2020-01-01', '2026-08-29', '2030-12-31', '2024-02-29']) {
    const n = semillaDelDia(clave);
    assert.ok(Number.isInteger(n) && n >= 1 && n <= 999999, `${clave} -> ${n}`);
  }
});

test('en un año no se repite ningún reparto, y todos son solucionables', () => {
  // La semilla sale de una lista finita de repartos resueltos: el reto es
  // resoluble todos los días, se juegue robando de una o de tres. Y la lista es
  // más larga que la ventana jugable, así que dentro del último año no hay dos
  // fechas con el mismo reparto.
  const semillas = new Set();
  const d = new Date(2026, 0, 1);
  for (let i = 0; i < 366; i++) {
    const clave = claveDia(d);
    const n = semillaDelDia(clave);
    assert.ok(SOLVABLE_SEEDS.includes(n), `el ${clave} cae en ${n}, sin solución comprobada`);
    assert.equal(semillas.has(n), false, `el reparto ${n} se repite el ${clave}`);
    semillas.add(n);
    d.setDate(d.getDate() + 1);
  }
});

test('la lista de repartos resueltos no se repite y cubre de sobra la ventana jugable', () => {
  assert.equal(new Set(SOLVABLE_SEEDS).size, SOLVABLE_SEEDS.length, 'hay semillas duplicadas');
  assert.ok(SOLVABLE_SEEDS.length > DIAS_ATRAS, 'más corta que el año que se puede jugar');
});

test('del futuro no se reparte, y del pasado solo hasta donde llega la ventana', () => {
  const hoy = '2026-08-29';
  assert.equal(esFuturo('2026-08-30', hoy), true);
  assert.equal(esFuturo('2026-08-29', hoy), false, 'hoy no es el futuro');
  assert.equal(esJugable('2026-08-29', hoy), true);
  assert.equal(esJugable('2026-08-30', hoy), false);
  assert.equal(esJugable('2025-08-29', hoy), true, 'justo un año atrás entra');
  assert.equal(esJugable('2025-08-28', hoy), false, 'un día más allá, no');
  assert.equal(distanciaDias('2025-08-29', hoy), DIAS_ATRAS);
  assert.equal(distanciaDias('nada', hoy), null);
});

test('la distancia en días cuenta días naturales, también con cambio de hora', () => {
  assert.equal(distanciaDias('2026-08-01', '2026-08-02'), 1);
  assert.equal(distanciaDias('2026-08-02', '2026-08-01'), -1);
  // En España el reloj cambia la madrugada del último domingo de marzo: ese día
  // tiene 23 horas y una resta a pelo daría 0,958 días.
  assert.equal(distanciaDias('2026-03-28', '2026-03-30'), 2);
  assert.equal(distanciaDias('2026-01-01', '2027-01-01'), 365);
});

test('la rejilla del mes empieza el día que toca y cuadra en semanas enteras', () => {
  // Agosto de 2026 empieza en sábado y tiene 31 días.
  const conLunes = rejillaDelMes(2026, 7, 1);
  assert.ok(conLunes.every((semana) => semana.length === 7), 'todas las filas de siete');
  assert.deepEqual(conLunes[0].slice(0, 5), [null, null, null, null, null], 'hasta el sábado no empieza');
  assert.equal(conLunes[0][5], '2026-08-01');
  const dias = conLunes.flat().filter(Boolean);
  assert.equal(dias.length, 31);
  assert.equal(dias[0], '2026-08-01');
  assert.equal(dias.at(-1), '2026-08-31');

  const conDomingo = rejillaDelMes(2026, 7, 0);
  assert.equal(conDomingo[0][6], '2026-08-01', 'empezando en domingo, el sábado es la última columna');

  // Febrero de un bisiesto que empieza en jueves: cuatro semanas justas.
  assert.equal(rejillaDelMes(2024, 1, 1).flat().filter(Boolean).length, 29);
});

test('la fecha de una clave es la de ese día a las cero horas, en local', () => {
  const f = fechaDeClave('2026-08-29');
  assert.equal(f.getFullYear(), 2026);
  assert.equal(f.getMonth(), 7);
  assert.equal(f.getDate(), 29);
  assert.equal(f.getHours(), 0);
  assert.equal(fechaDeClave('2026-02-30'), null);
});

test('el mejor intento no compara puntuaciones de modalidades distintas', () => {
  // En Vegas la puntuación son dólares y ronda la decena; en estándar son
  // centenares. Comparándolas a pelo, cualquier partida estándar tapaba la de
  // Vegas y el calendario acababa enseñando la de otra modalidad.
  const vegas = { won: true, score: 30, scoring: 'vegas', drawCount: 1 };
  const estandar = { won: true, score: 550, scoring: 'standard', drawCount: 1 };
  assert.equal(mejorResultado(vegas, estandar), estandar, 'la última manda si no son comparables');
  assert.equal(mejorResultado(estandar, vegas), vegas);

  // Dentro de la misma modalidad sí se comparan, como siempre.
  const flojo = { won: true, score: 10, scoring: 'vegas', drawCount: 1 };
  assert.equal(mejorResultado(vegas, flojo), vegas, 'y el peor intento no pisa al mejor');
  // Y el robo de una y el de tres tampoco son la misma competición.
  const detres = { won: true, score: 5, scoring: 'vegas', drawCount: 3 };
  assert.equal(mejorResultado(vegas, detres), detres);

  // Tampoco se comparan puntuaciones con pistas penalizadas frente a sin penalizar.
  const conPistas = { won: true, score: 500, scoring: 'standard', drawCount: 1, penalizeHints: true };
  const sinPistas = { won: true, score: 600, scoring: 'standard', drawCount: 1, penalizeHints: false };
  assert.equal(mejorResultado(sinPistas, conPistas), conPistas, 'jugar con penalización de pistas es otra modalidad');
  assert.equal(mejorResultado(conPistas, sinPistas), sinPistas);

  // Ganar sigue mandando sobre todo lo demás, sea cual sea la modalidad.
  assert.equal(mejorResultado(vegas, { won: false, score: 9999, scoring: 'standard', drawCount: 1 }), vegas);
});

test('de un día se guarda el mejor intento, no el último', () => {
  const perdida = { won: false, score: 900 };
  const ganada = { won: true, score: 300 };
  const ganadaMejor = { won: true, score: 800 };

  assert.equal(mejorResultado(null, perdida), perdida, 'el primero se queda tal cual');
  assert.equal(mejorResultado(perdida, null), perdida);
  assert.equal(mejorResultado(null, null), null);
  assert.equal(mejorResultado(perdida, ganada), ganada, 'ganar manda sobre puntuar');
  assert.equal(mejorResultado(ganada, perdida), ganada);
  assert.equal(mejorResultado(ganada, ganadaMejor), ganadaMejor, 'entre dos ganadas, la de más puntos');
  assert.equal(mejorResultado(ganadaMejor, ganada), ganadaMejor);
  assert.equal(mejorResultado({ won: false, score: 10 }, { won: false, score: 20 }).score, 20);
});
