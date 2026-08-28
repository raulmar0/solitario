// Persistencia local (localStorage). Todo bajo el prefijo `solitario.v1.`.
// El backend se inyecta para poder probarlo sin navegador.

const PREFIX = 'solitario.v1.';
export const KEYS = {
  prefs: `${PREFIX}prefs`,
  stats: `${PREFIX}stats`,
  scores: `${PREFIX}scores`,
  save: `${PREFIX}save`,
  bank: `${PREFIX}vegasBank`,
};

export const MAX_SCORES = 25;   // por modalidad

const byScore = (a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.timeMs ?? 0) - (b.timeMs ?? 0);

export const DEFAULT_PREFS = {
  drawCount: 1,
  scoring: 'standard',
  timed: true,
  animations: true,
  sound: true,
  autoSafe: false,      // subir automáticamente las cartas que no estorban
  solvableOnly: false,  // repartir solo manos con solución comprobada
  theme: 'auto',
  playerName: '',
  lang: 'auto',         // 'auto' mira el idioma del navegador
  fourColor: false,     // baraja de cuatro colores: un palo, un color
  haptics: true,        // el pequeño golpe al colocar y al negar (Android)
};

export const IDIOMAS_VALIDOS = ['es', 'en', 'fr', 'pt', 'ko'];

const EMPTY_STATS = () => ({
  played: 0,
  won: 0,
  bestScore: null,
  bestTimeMs: null,
  fewestMoves: null,
  currentStreak: 0,
  bestStreak: 0,
  totalScore: 0,
  lastPlayedAt: null,
});

/** Almacén en memoria: sirve de reserva si localStorage no está disponible. */
export function memoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function safeBackend(backend) {
  if (!backend) return memoryBackend();
  try {
    const probe = `${PREFIX}__probe__`;
    backend.setItem(probe, '1');
    backend.removeItem(probe);
    return backend;
  } catch {
    // Modo privado de Safari, cookies bloqueadas, cuota llena...
    return memoryBackend();
  }
}

export function modeKey(scoring, drawCount) {
  return `${scoring}-${drawCount}`;
}

export function createStore(backend) {
  const store = safeBackend(backend);

  const read = (key, fallback) => {
    try {
      const raw = store.getItem(key);
      if (raw == null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;        // dato corrupto: se ignora en vez de romper la partida
    }
  };

  const write = (key, value) => {
    try {
      store.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;           // cuota llena: seguimos jugando sin persistir
    }
  };

  const api = {
    getPrefs() {
      const saved = read(KEYS.prefs, {});
      const prefs = { ...DEFAULT_PREFS, ...(saved && typeof saved === 'object' ? saved : {}) };
      if (prefs.drawCount !== 1 && prefs.drawCount !== 3) prefs.drawCount = DEFAULT_PREFS.drawCount;
      if (prefs.scoring !== 'standard' && prefs.scoring !== 'vegas') prefs.scoring = DEFAULT_PREFS.scoring;
      if (!['auto', 'light', 'dark'].includes(prefs.theme)) prefs.theme = DEFAULT_PREFS.theme;
      if (typeof prefs.playerName !== 'string') prefs.playerName = '';
      // Un idioma que no conocemos vuelve a la detección automática: peor que
      // acertar es plantarle a alguien media interfaz en un idioma vacío.
      if (prefs.lang !== 'auto' && !IDIOMAS_VALIDOS.includes(prefs.lang)) prefs.lang = 'auto';
      prefs.fourColor = !!prefs.fourColor;
      prefs.haptics = prefs.haptics !== false;
      return prefs;
    },
    setPrefs(patch) {
      const next = { ...api.getPrefs(), ...patch };
      write(KEYS.prefs, next);
      return next;
    },

    getAllStats() {
      const all = read(KEYS.stats, {});
      return all && typeof all === 'object' ? all : {};
    },
    getStats(scoring, drawCount) {
      const all = api.getAllStats();
      return { ...EMPTY_STATS(), ...(all[modeKey(scoring, drawCount)] || {}) };
    },

    getScores(filter = {}) {
      const list = read(KEYS.scores, []);
      const rows = Array.isArray(list) ? list.filter((r) => r && typeof r === 'object') : [];
      const filtered = rows.filter((r) => {
        if (filter.scoring && r.scoring !== filter.scoring) return false;
        if (filter.drawCount && r.drawCount !== filter.drawCount) return false;
        if (filter.wonOnly && !r.won) return false;
        return true;
      });
      filtered.sort(byScore);
      return filter.limit ? filtered.slice(0, filter.limit) : filtered;
    },

    /**
     * Cierra una partida: actualiza estadísticas, tabla de récords y banca de Vegas.
     * result = { scoring, drawCount, score, won, timeMs, moves, seed, at }
     */
    recordGame(result) {
      const { scoring, drawCount, score, won } = result;
      const key = modeKey(scoring, drawCount);
      const all = api.getAllStats();
      const s = { ...EMPTY_STATS(), ...(all[key] || {}) };

      s.played += 1;
      s.totalScore += score;
      s.lastPlayedAt = result.at ?? null;
      if (won) {
        s.won += 1;
        s.currentStreak += 1;
        s.bestStreak = Math.max(s.bestStreak, s.currentStreak);
        if (s.bestTimeMs == null || result.timeMs < s.bestTimeMs) s.bestTimeMs = result.timeMs;
        if (s.fewestMoves == null || result.moves < s.fewestMoves) s.fewestMoves = result.moves;
      } else {
        s.currentStreak = 0;
      }
      if (s.bestScore == null || score > s.bestScore) s.bestScore = score;

      all[key] = s;
      write(KEYS.stats, all);

      const rows = read(KEYS.scores, []);
      const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object');
      list.push({ ...result });
      // El recorte es por modalidad: si no, un modo con muchas partidas vaciaría la tabla de los demás.
      const grupos = new Map();
      for (const row of list) {
        const clave = modeKey(row.scoring, row.drawCount);
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(row);
      }
      const recortado = [];
      for (const filas of grupos.values()) {
        filas.sort(byScore);
        recortado.push(...filas.slice(0, MAX_SCORES));
      }
      recortado.sort(byScore);
      write(KEYS.scores, recortado);

      if (scoring === 'vegas') api.addToBank(drawCount, score);
      return s;
    },

    getBank(drawCount) {
      const bank = read(KEYS.bank, {});
      const value = bank && typeof bank === 'object' ? bank[String(drawCount)] : 0;
      return Number.isFinite(value) ? value : 0;
    },
    addToBank(drawCount, amount) {
      const bank = read(KEYS.bank, {});
      const next = bank && typeof bank === 'object' ? { ...bank } : {};
      next[String(drawCount)] = api.getBank(drawCount) + amount;
      write(KEYS.bank, next);
      return next[String(drawCount)];
    },
    resetBank(drawCount) {
      const bank = read(KEYS.bank, {});
      const next = bank && typeof bank === 'object' ? { ...bank } : {};
      delete next[String(drawCount)];
      write(KEYS.bank, next);
    },

    saveGame(snapshot) { return write(KEYS.save, snapshot); },
    loadGame() { return read(KEYS.save, null); },
    clearGame() { try { store.removeItem(KEYS.save); } catch { /* da igual */ } },

    exportAll() {
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        prefs: api.getPrefs(),
        stats: api.getAllStats(),
        scores: read(KEYS.scores, []),
        bank: read(KEYS.bank, {}),
      };
    },
    importAll(data) {
      if (!data || typeof data !== 'object') throw new Error('Copia de seguridad no válida');
      if (data.prefs) write(KEYS.prefs, { ...DEFAULT_PREFS, ...data.prefs });
      if (data.stats) write(KEYS.stats, data.stats);
      if (Array.isArray(data.scores)) write(KEYS.scores, data.scores.slice(0, MAX_SCORES * 4));
      if (data.bank) write(KEYS.bank, data.bank);
      return true;
    },
    resetAll() {
      for (const key of Object.values(KEYS)) {
        try { store.removeItem(key); } catch { /* da igual */ }
      }
    },
  };

  return api;
}
