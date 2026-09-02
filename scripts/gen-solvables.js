// Genera repartos con solución comprobada para el reto diario.
//
// Recorre un rango de semillas y, para cada una, busca una solución en modalidad
// estándar (pasadas ilimitadas) robando de UNA y de TRES. Solo la que sale en las
// dos entra en la lista: así el reto del día es resoluble se juegue como se juegue.
//
// El buscador es el mismo del test (DFS con heurística), con un presupuesto de
// nodos por semilla. Si agota el presupuesto la da por imposible: nunca se cuela
// una sin solución (encontrar una es una prueba), pero alguna con solución difícil
// se descarta, y eso solo obliga a mirar más semillas.
//
// Uso:  node scripts/gen-solvables.js [inicio] [fin] [presupuesto]
//   - inicio:      primera semilla a probar (por defecto 1)
//   - fin:         primera semilla que ya NO se prueba (por defecto inicio + 100000)
//   - presupuesto: nodos por semilla y modalidad (por defecto 40000)
//
// Imprime las semillas solucionables del rango por la salida estándar, una por
// línea. No escribe ficheros: para repartir el trabajo entre varios procesos se
// lanza con rangos que no se pisan y se juntan los resultados.

import * as engine from '../src/engine.js';
import { PILE } from '../src/engine.js';

const INICIO = Number(process.argv[2] ?? 1);
const FIN = Number(process.argv[3] ?? INICIO + 100000);
const PRESUPUESTO = Number(process.argv[4] ?? 40000);

const stateKey = (s) => JSON.stringify([
  s.stock.map((c) => c.id),
  s.waste.map((c) => c.id),
  s.foundations.map((p) => p.length),
  s.tableau.map((p) => p.map((c) => (c.faceUp ? '+' : '-') + c.id)),
]);

function orderedMoves(s) {
  const moves = engine.cardMoves(s, { includeFoundationToTableau: false });
  const rank = (m) => {
    if (m.to.pile === PILE.FOUNDATION) {
      const src = m.from.pile === PILE.WASTE ? s.waste : s.tableau[m.from.index];
      return engine.isSafeToFoundation(s, engine.top(src)) ? 0 : 1;
    }
    if (m.from.pile === PILE.TABLEAU) {
      const src = s.tableau[m.from.index];
      const under = src[src.length - m.count - 1];
      if (under && !under.faceUp) return 2;
      if (m.count === src.length && s.tableau[m.to.index].length === 0) return 99; // bucle
      return 5;
    }
    if (m.from.pile === PILE.WASTE) return 3;
    return 7;
  };
  const out = moves.filter((m) => rank(m) < 99).sort((a, b) => rank(a) - rank(b));
  if (engine.isLegal(s, { type: 'draw' })) out.push({ type: 'draw' });
  if (engine.isLegal(s, { type: 'recycle' })) out.push({ type: 'recycle' });
  return out;
}

function solvable(seed, drawCount) {
  const seen = new Set();
  let nodes = 0;
  const dfs = (s) => {
    if (engine.isWon(s)) return true;
    if (++nodes > PRESUPUESTO) return false;
    const key = stateKey(s);
    if (seen.has(key)) return false;
    seen.add(key);
    for (const move of orderedMoves(s)) {
      const res = engine.applyMove(s, move);
      if (!res) continue;
      if (dfs(res.state)) return true;
      if (nodes > PRESUPUESTO) return false;
    }
    return false;
  };
  return { won: dfs(engine.newGame({ seed, drawCount })), nodes };
}

const t0 = Date.now();
let halladas = 0;
let probadas = 0;

for (let seed = INICIO; seed < FIN; seed++) {
  probadas += 1;
  if (!solvable(seed, 1).won) continue;
  if (!solvable(seed, 3).won) continue;
  halladas += 1;
  console.log(seed);
  process.stderr.write(`\r${probadas}/${FIN - INICIO} probadas, ${halladas} halladas, ${Math.round((Date.now() - t0) / 1000)}s`);
}

process.stderr.write('\n');
