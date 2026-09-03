// Aplicación instalable: registro del service worker, actualización y alta en
// el dispositivo. Las funciones de ciclo de vida reciben el worker y el registro
// como parámetros para poder probarlas en Node sin navegador.

export const ESPERA_ACTIVACION_MS = 20_000;   // instalar precarga todo: en una red lenta tarda
export const GRACIA_UPDATEFOUND_MS = 500;
const ESTADOS_LISTOS = ['installed', 'activated', 'redundant'];

/** No es lo mismo «estás al día» que «no he podido preguntar». */
export const SIN_RED = 'sin-red';

/**
 * Espera a que el worker llegue a uno de esos estados. Devuelve el estado
 * alcanzado, o null si se acabó el tiempo. Nunca lanza.
 */
export function esperarEstado(worker, estados = ESTADOS_LISTOS, timeoutMs = ESPERA_ACTIVACION_MS) {
  return new Promise((resolve) => {
    if (estados.includes(worker.state)) { resolve(worker.state); return; }
    const terminar = (valor) => {
      clearTimeout(reloj);
      worker.removeEventListener('statechange', alCambiar);
      resolve(valor);
    };
    const alCambiar = () => { if (estados.includes(worker.state)) terminar(worker.state); };
    const reloj = setTimeout(() => terminar(null), timeoutMs);
    worker.addEventListener('statechange', alCambiar);
  });
}

/**
 * Pregunta al servidor si hay una versión nueva y devuelve su worker, o null si
 * ya estamos en la última (o si la consulta falló, por ejemplo sin conexión).
 */
export async function buscarWorkerNuevo(reg, graciaMs = GRACIA_UPDATEFOUND_MS) {
  // Puede que el navegador ya la estuviera instalando por su cuenta.
  const enCurso = reg.installing ?? reg.waiting;
  if (enCurso) return enCurso;

  try {
    await reg.update();
  } catch {
    return SIN_RED;      // sin conexión: no se puede afirmar que estemos al día
  }

  const encontrado = reg.installing ?? reg.waiting;
  if (encontrado) return encontrado;

  // Algunos navegadores resuelven update() antes de rellenar `installing`: se le
  // da un respiro a `updatefound` antes de dar por buena la versión actual.
  return new Promise((resolve) => {
    const reloj = setTimeout(() => {
      reg.removeEventListener('updatefound', alEncontrar);
      resolve(reg.installing ?? reg.waiting ?? null);
    }, graciaMs);
    const alEncontrar = () => {
      clearTimeout(reloj);
      reg.removeEventListener('updatefound', alEncontrar);
      resolve(reg.installing ?? reg.waiting ?? null);
    };
    reg.addEventListener('updatefound', alEncontrar);
  });
}

// --- lo que ya necesita navegador ---

export const haySoporte = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

export function esStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || window.navigator.standalone === true;
}

export function esIos() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
}

/**
 * Registra el worker y avisa cuando queda uno esperando (versión nueva lista).
 * No recarga por su cuenta: eso solo pasa si el jugador pulsa actualizar.
 */
export function registrarServiceWorker({ onVersionNueva = () => {} } = {}) {
  if (!haySoporte()) return { soportado: false, actualizar: async () => 'nosoportado', buscar: async () => 'nosoportado' };

  let registro = null;
  let recargaPedida = false;

  const avisarSiEspera = (reg) => { if (reg.waiting && navigator.serviceWorker.controller) onVersionNueva(reg.waiting); };

  const listo = navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { updateViaCache: 'none' })
    .then((reg) => {
      registro = reg;
      reg.addEventListener('updatefound', () => {
        const entrante = reg.installing;
        if (!entrante) return;
        entrante.addEventListener('statechange', () => {
          // Sin controlador es la primera instalación: no hay nada que avisar.
          if (entrante.state === 'installed' && navigator.serviceWorker.controller) onVersionNueva(entrante);
        });
      });
      avisarSiEspera(reg);
      // Una pestaña que ya estaba abierta no siempre provoca una comprobación
      // del navegador al publicarse una versión. Preguntamos una vez al arrancar
      // sin activar nada: el worker nuevo seguirá esperando al jugador.
      if (navigator.serviceWorker.controller) void reg.update().catch(() => {});
      return reg;
    })
    .catch(() => null);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!recargaPedida) return;      // clients.claim() de la primera visita: no se recarga
    recargaPedida = false;
    window.location.reload();
  });

  /** Manda al worker en espera tomar el control y recarga cuando lo haga. */
  const aplicar = async (worker) => {
    recargaPedida = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
    const estado = await esperarEstado(worker, ['activated', 'redundant'], ESPERA_ACTIVACION_MS);
    if (estado === 'redundant') { recargaPedida = false; return 'error'; }
    if (estado === null) return 'instalando';   // sigue en marcha; al activarse recarga sola
    setTimeout(() => { if (recargaPedida) window.location.reload(); }, 400);  // por si no llega controllerchange
    return 'actualizando';
  };

  return {
    soportado: true,
    get registro() { return registro; },

    /** Busca versión nueva y, si la hay, salta a ella. */
    async actualizar() {
      const reg = registro ?? await listo;
      if (!reg) return 'error';
      if (reg.waiting) return aplicar(reg.waiting);

      // Primera visita: el worker se está instalando por primera vez y no hay
      // nada a lo que saltar. Recargar aquí solo confundiría.
      if (!navigator.serviceWorker.controller) return 'primera-vez';

      const nuevo = await buscarWorkerNuevo(reg);
      if (nuevo === SIN_RED) return 'error';
      if (!nuevo) return 'aldia';

      const estado = await esperarEstado(nuevo, ['installed', 'activated', 'redundant']);
      if (estado === 'redundant') return 'error';
      if (estado === null) return 'instalando';
      if (estado === 'activated') { window.location.reload(); return 'actualizando'; }
      return aplicar(nuevo);
    },
  };
}

/**
 * Gestiona el alta en el dispositivo. Chrome y Edge avisan con
 * `beforeinstallprompt`; iOS no tiene nada de eso y hay que explicarlo a mano.
 */
export function crearInstalador({ onCambio = () => {} } = {}) {
  let peticion = null;

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();          // el aviso se enseña donde queremos, no donde decida el navegador
      peticion = event;
      onCambio();
    });
    window.addEventListener('appinstalled', () => { peticion = null; onCambio(); });
  }

  return {
    get puede() { return peticion !== null; },
    get pistaIos() { return esIos() && !esStandalone(); },
    async instalar() {
      if (!peticion) return 'no-disponible';
      // La petición del navegador es de un solo uso: reutilizarla lanza
      // InvalidStateError y dejaría un botón que no hace nada.
      const evento = peticion;
      peticion = null;
      try {
        await evento.prompt();
        const { outcome } = await evento.userChoice;
        return outcome;                // 'accepted' | 'dismissed'
      } catch {
        return 'error';
      } finally {
        onCambio();
      }
    },
  };
}
