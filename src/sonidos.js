// Sonidos del juego, sintetizados con Web Audio: ni ficheros que descargar ni
// red que pedir (la CSP del juego no deja traer audio de fuera, y con razón).
// Cada sonido son un par de osciladores o un pellizco de ruido filtrado con su
// envolvente, que es de sobra para unos clics de cartas.
//
// El contexto se crea tarde y a propósito: los navegadores no dejan sonar nada
// hasta que el usuario toca la página, así que se monta con el primer sonido
// que se pide y se reanuda si el navegador lo tenía dormido.

const VOLUMEN = 0.2;
const RUIDO_S = 0.4;        // segundos de ruido blanco que se guardan y se reutilizan

export function crearSonidos({ activo = () => true, crearContexto } = {}) {
  let ctx = null;
  let ruidoBuf = null;

  const nuevoContexto = crearContexto ?? (() => {
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    return Ctx ? new Ctx() : null;
  });

  /** El contexto, o null si no se puede sonar. Nunca lanza: el sonido es un adorno. */
  function contexto() {
    if (!activo()) return null;
    try {
      if (!ctx) ctx = nuevoContexto() ?? null;
      if (!ctx) return null;
      if (ctx.state === 'suspended') ctx.resume?.();
      return ctx;
    } catch {
      ctx = null;
      return null;
    }
  }

  /** Subida rápida y caída exponencial: sin esto, cada nota da un chasquido. */
  function envolvente(c, vol, dur, t0) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(c.destination);
    return g;
  }

  function tono(freq, { dur = 0.18, tipo = 'sine', vol = VOLUMEN, hasta = null, retraso = 0 } = {}) {
    const c = contexto();
    if (!c) return;
    const t0 = c.currentTime + retraso;
    const osc = c.createOscillator();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, t0);
    if (hasta) osc.frequency.exponentialRampToValueAtTime(hasta, t0 + dur);
    osc.connect(envolvente(c, vol, dur, t0));
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** El sonido de una carta: ruido blanco pasado por un filtro estrecho. */
  function ruido({ dur = 0.08, vol = VOLUMEN, centro = 1400, q = 0.9, retraso = 0 } = {}) {
    const c = contexto();
    if (!c) return;
    if (!ruidoBuf) {
      ruidoBuf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * RUIDO_S)), c.sampleRate);
      const datos = ruidoBuf.getChannelData(0);
      for (let i = 0; i < datos.length; i++) datos[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + retraso;
    const src = c.createBufferSource();
    src.buffer = ruidoBuf;
    const filtro = c.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.frequency.setValueAtTime(centro, t0);
    filtro.Q.setValueAtTime(q, t0);
    src.connect(filtro);
    filtro.connect(envolvente(c, vol, dur, t0));
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  return {
    /** Robar del mazo: la carta que se desliza. */
    robar() { ruido({ dur: 0.075, centro: 2000, vol: 0.15 }); },
    /** Carta que cae en una columna: el golpecito sobre el tapete. */
    colocar() {
      ruido({ dur: 0.06, centro: 1100, vol: 0.17 });
      tono(150, { dur: 0.07, tipo: 'triangle', vol: 0.09 });
    },
    /** Carta que sube a su pila: se premia con dos notas. */
    fundacion() {
      tono(660, { dur: 0.1, vol: 0.13 });
      tono(990, { dur: 0.16, vol: 0.11, retraso: 0.07 });
    },
    /** Una carta que se destapa. */
    voltear() { ruido({ dur: 0.04, centro: 3200, vol: 0.1 }); },
    /** Jugada que no puede ser. */
    nada() { tono(150, { dur: 0.2, tipo: 'triangle', vol: 0.16, hasta: 90 }); },
    /** Deshacer: el sonido de colocar, pero al revés. */
    deshacer() { tono(520, { dur: 0.15, vol: 0.11, hasta: 300 }); },
    /** La partida se ha quedado sin salida. */
    atasco() {
      tono(300, { dur: 0.26, tipo: 'triangle', vol: 0.14 });
      tono(200, { dur: 0.38, tipo: 'triangle', vol: 0.14, retraso: 0.17 });
    },
    /** Victoria: un arpegio, que para eso se ha ganado. */
    ganar() {
      [523, 659, 784, 1047].forEach((f, i) => tono(f, { dur: 0.32, vol: 0.13, retraso: i * 0.12 }));
    },
    /** Barajar: seis pellizcos de ruido seguidos, subiendo de tono. */
    barajar() {
      for (let i = 0; i < 6; i++) {
        ruido({ dur: 0.05, centro: 1300 + i * 220, vol: 0.07, retraso: i * 0.045 });
      }
    },
  };
}
