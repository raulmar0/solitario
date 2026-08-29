// Traducción de la interfaz. Los cinco diccionarios se importan estáticamente
// porque la aplicación tiene que arrancar y cambiar de idioma sin conexión.
// Módulo autónomo: no sabe nada del juego más allá de los palos de la baraja.

import { SUITS } from './cards.js';
import es from './locales/es.js';
import en from './locales/en.js';
import fr from './locales/fr.js';
import pt from './locales/pt.js';
import ko from './locales/ko.js';

/** Los cinco idiomas, en el orden en que se muestran. */
export const IDIOMAS = [
  { code: 'es', name: 'Español' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
  { code: 'ko', name: '한국어' },
];

const DICCIONARIOS = { es, en, fr, pt, ko };
const CODIGOS = IDIOMAS.map((i) => i.code);
const REFERENCIA = 'es';        // si falta una clave en otro idioma, se cae aquí
const VACIO = '—';              // mismo guion largo que `hud.vacio`

let activo = REFERENCIA;
const suscriptores = new Set();
const faltantes = new Set();

// El idioma del sistema se lee así de rebuscado para poder ejecutar el módulo
// en node, donde `navigator` puede no existir.
function idiomasDelSistema() {
  const nav = globalThis.navigator;
  if (!nav) return [];
  if (Array.isArray(nav.languages) && nav.languages.length) return nav.languages;
  return nav.language ? [nav.language] : [];
}

/** 'auto' o un código; devuelve siempre uno de los cinco. */
export function resolverIdioma(pref, idiomasDelNavegador = idiomasDelSistema()) {
  if (typeof pref === 'string' && CODIGOS.includes(pref)) return pref;
  // Cualquier otra cosa ('auto', 'de', null, 42) se resuelve mirando el navegador.
  for (const etiqueta of idiomasDelNavegador ?? []) {
    if (typeof etiqueta !== 'string') continue;
    const base = etiqueta.toLowerCase().split('-')[0];
    if (CODIGOS.includes(base)) return base;
  }
  return REFERENCIA;
}

/** Fija el idioma vivo y pone <html lang>. Avisa a los suscriptores. */
export function fijarIdioma(code) {
  activo = CODIGOS.includes(code) ? code : resolverIdioma(code);
  // En node no hay documento y las pruebas unitarias tienen que poder llamar aquí.
  const doc = globalThis.document;
  if (doc?.documentElement) doc.documentElement.lang = activo;
  // Copia de la lista: un suscriptor puede darse de baja mientras se le avisa.
  for (const fn of [...suscriptores]) fn(activo);
}

export function idioma() {
  return activo;
}

function entradaDe(dicc, key) {
  return dicc && Object.hasOwn(dicc, key) ? dicc[key] : undefined;
}

// Plural sencillo: solo `one` y `other`, que es lo que piden los cinco idiomas.
function forma(entrada, params) {
  if (typeof entrada === 'string') return entrada;
  if (!entrada || typeof entrada !== 'object') return undefined;
  if (params.count === undefined) return entrada.other ?? entrada.one;
  return params.count === 1 ? (entrada.one ?? entrada.other) : (entrada.other ?? entrada.one);
}

function interpolar(plantilla, params) {
  if (!plantilla.includes('{')) return plantilla;
  return plantilla.replace(/\{(\w+)\}/g, (literal, llave) => {
    const valor = params[llave];
    // El contador se escribe siempre `{n}` en los textos; se acepta solo `count`.
    if (valor === undefined) {
      if (llave === 'n' && params.count !== undefined) return String(params.count);
      return literal;      // sin valor se deja tal cual: se ve el hueco y se arregla
    }
    return String(valor);
  });
}

/** Traduce. `params` interpola {llaves}; plural con `params.count`. */
export function t(key, params = {}) {
  if (typeof key !== 'string' || !key) return '';
  const entrada = entradaDe(DICCIONARIOS[activo], key) ?? entradaDe(DICCIONARIOS[REFERENCIA], key);
  const plantilla = forma(entrada, params);
  if (typeof plantilla !== 'string') {
    faltantes.add(key);
    return key;
  }
  return interpolar(plantilla, params);
}

const ATRIBUTOS = [
  ['data-i18n', 'texto'],
  ['data-i18n-html', 'html'],
  ['data-i18n-title', 'title'],
  ['data-i18n-aria-label', 'aria-label'],
  ['data-i18n-placeholder', 'placeholder'],
];
const SELECTOR = ATRIBUTOS.map(([attr]) => `[${attr}]`).join(',');

function parametrosDe(el) {
  const crudo = el.dataset?.i18nParams;
  if (!crudo) return {};
  try {
    const valor = JSON.parse(crudo);
    return valor && typeof valor === 'object' ? valor : {};
  } catch {
    return {};                 // un JSON roto no debe dejar el nodo sin traducir
  }
}

function traducirNodo(el) {
  const params = parametrosDe(el);
  for (const [attr, destino] of ATRIBUTOS) {
    const key = el.getAttribute(attr);
    if (key === null) continue;
    const valor = t(key, params);
    // Se compara antes de escribir: esto corre entero en cada cambio de idioma.
    if (destino === 'texto') {
      if (el.textContent !== valor) el.textContent = valor;
    } else if (destino === 'html') {
      if (el.innerHTML !== valor) el.innerHTML = valor;
    } else if (el.getAttribute(destino) !== valor) {
      el.setAttribute(destino, valor);
    }
  }
}

/** Aplica data-i18n* a todo el subárbol. Idempotente: se puede repetir. */
export function traducirDom(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  if (root.matches?.(SELECTOR)) traducirNodo(root);
  for (const el of root.querySelectorAll(SELECTOR)) traducirNodo(el);
}

/** Se llama cada vez que cambia el idioma. Devuelve la baja. */
export function alCambiarIdioma(fn) {
  if (typeof fn !== 'function') return () => {};
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}

/** Fecha corta localizada a partir de un ISO. '—' si no vale. */
export function fecha(iso) {
  if (iso === null || iso === undefined || iso === '') return VACIO;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return VACIO;
  return d.toLocaleDateString(activo, { day: '2-digit', month: 'short', year: '2-digit' });
}

/** Un valor cualquiera llevado a Date, o null si no hay fecha que valga. */
function comoFecha(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** «29 ago»: para el chip de la cabecera, donde no cabe más. */
export function fechaCorta(valor) {
  const d = comoFecha(valor);
  return d ? d.toLocaleDateString(activo, { day: 'numeric', month: 'short' }) : VACIO;
}

/** «sábado, 29 de agosto de 2026»: la del calendario, que se lee entera. */
export function fechaLarga(valor) {
  const d = comoFecha(valor);
  return d ? d.toLocaleDateString(activo, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : VACIO;
}

/** «agosto de 2026»: el título del mes en el calendario. */
export function nombreMes(valor) {
  const d = comoFecha(valor);
  return d ? d.toLocaleDateString(activo, { month: 'long', year: 'numeric' }) : VACIO;
}

/**
 * Con qué día empieza la semana en este idioma. En español, francés y portugués
 * es el lunes; en inglés y coreano, el domingo. Un calendario que empieza el día
 * que no toca se lee mal aunque los números estén bien.
 */
export function primerDiaSemana() {
  return activo === 'en' || activo === 'ko' ? 0 : 1;
}

/**
 * Las siete cabeceras del calendario, empezando por `primerDiaSemana()`. Se
 * sacan de una semana cualquiera —la del 4 de enero de 2021, que fue lunes— y
 * las nombra el propio navegador en el idioma activo.
 */
export function diasDeLaSemana(estilo = 'short') {
  const lunes = new Date(2021, 0, 4);
  const primero = primerDiaSemana();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + ((i + primero - 1 + 7) % 7));
    return d.toLocaleDateString(activo, { weekday: estilo });
  });
}

/** «9 de picas» / «스페이드 9»: el orden lo decide la plantilla `carta.nombre`. */
export function nombreCarta(card) {
  if (!card || card.rank == null || !card.suit) return VACIO;
  return t('carta.nombre', {
    rango: t(`carta.rango.${card.rank}`),
    palo: t(`carta.palo.${card.suit}`),
  });
}

// Las fundaciones van en el orden de SUITS, así que el índice ya dice el palo;
// el estado solo hace falta si alguna vez dejaran de ir emparejadas.
function paloDeFundacion(ref, state) {
  const pila = state?.foundations?.[ref.index];
  return pila?.[pila.length - 1]?.suit ?? ref.suit ?? SUITS[ref.index];
}

/** «columna 3», «pila de picas», «descarte», «mazo». */
export function nombrePila(ref, state) {
  if (!ref) return VACIO;
  switch (ref.pile) {
    case 'tableau': return t('pila.tableau', { n: (ref.index ?? 0) + 1 });
    case 'foundation': {
      const palo = paloDeFundacion(ref, state);
      return t('pila.foundation', { palo: palo ? t(`carta.palo.${palo}`) : VACIO });
    }
    case 'waste': return t('pila.waste');
    case 'stock': return t('pila.stock');
    default: return VACIO;
  }
}

/** Claves pedidas que no existían en ningún diccionario. Para las pruebas. */
export function clavesQueFaltan() {
  return [...faltantes];
}
