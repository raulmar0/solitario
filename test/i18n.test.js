// Guardián de la traducción. La interfaz habla cinco idiomas y todos salen del
// mismo catálogo de claves: en cuanto uno se descuelga —una clave que falta, un
// {marcador} que se pierde, una frase que se quedó en español— la aplicación se
// rompe en silencio, mostrando la clave cruda o un hueco sin rellenar. Estas
// pruebas cierran esa puerta antes de que el fallo llegue a la pantalla.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import es from '../src/locales/es.js';
import en from '../src/locales/en.js';
import fr from '../src/locales/fr.js';
import pt from '../src/locales/pt.js';
import ko from '../src/locales/ko.js';
import {
  IDIOMAS, resolverIdioma, fijarIdioma, idioma, t, traducirDom,
  alCambiarIdioma, fecha, nombreCarta, nombrePila, clavesQueFaltan,
} from '../src/i18n.js';
import { SUITS, RANKS } from '../src/cards.js';
import { RAZON } from '../src/advisor.js';

const DICCIONARIOS = { es, en, fr, pt, ko };
const CODIGOS = Object.keys(DICCIONARIOS);
const OTROS = CODIGOS.filter((c) => c !== 'es');   // los que se comparan contra la referencia
const CLAVES_ES = Object.keys(es);

// `fijarIdioma` escribe en <html lang>, así que el módulo necesita un documento.
// Uno mínimo basta: aquí no se monta la aplicación, solo se traduce.
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = dom.window.document;
const { document } = dom.window;

/** Ejecuta el cuerpo con un idioma activo y deja el módulo como estaba. */
function conIdioma(code, fn) {
  const previo = idioma();
  fijarIdioma(code);
  try { return fn(); } finally { fijarIdioma(previo); }
}

/** Todo el texto visible de una entrada, sea cadena suelta o plural. */
function textoDe(entrada) {
  if (typeof entrada === 'string') return entrada;
  if (entrada && typeof entrada === 'object') return Object.values(entrada).join(' ');
  return '';
}

/** Los {marcadores} de una entrada, sin repetir y ordenados para poder comparar. */
function marcadoresDe(entrada) {
  return [...new Set(textoDe(entrada).match(/\{\w+\}/g) ?? [])].sort();
}

/** Las etiquetas de marcado y cuántas veces sale cada una. */
function marcadoDe(entrada) {
  const cuenta = {};
  for (const etiqueta of textoDe(entrada).match(/<\/?[a-z]+>/g) ?? []) {
    cuenta[etiqueta] = (cuenta[etiqueta] ?? 0) + 1;
  }
  return cuenta;
}

/** 'cadena' o 'plural': el tipo tiene que coincidir o `t` devolvería otra cosa. */
function tipoDe(entrada) {
  if (typeof entrada === 'string') return 'cadena';
  if (entrada && typeof entrada === 'object' && ('one' in entrada || 'other' in entrada)) return 'plural';
  return `desconocido (${typeof entrada})`;
}

// ---------------------------------------------------------------- paridad

test('los cinco diccionarios tienen exactamente las mismas claves y en el mismo orden', () => {
  for (const code of OTROS) {
    const claves = Object.keys(DICCIONARIOS[code]);
    const faltan = CLAVES_ES.filter((k) => !Object.hasOwn(DICCIONARIOS[code], k));
    const sobran = claves.filter((k) => !Object.hasOwn(es, k));
    assert.deepEqual(faltan, [], `a src/locales/${code}.js le faltan claves que sí están en es.js: ${faltan.join(', ')}`);
    assert.deepEqual(sobran, [], `src/locales/${code}.js tiene claves que no existen en es.js: ${sobran.join(', ')}`);
    // El orden importa tanto como el contenido: los cinco ficheros se leen en
    // paralelo cuando hay que retocar un texto y descolgarse hace perder tiempo.
    const primeraDiferencia = claves.findIndex((k, i) => k !== CLAVES_ES[i]);
    assert.equal(
      primeraDiferencia, -1,
      `src/locales/${code}.js tiene las claves en otro orden: en la posición ${primeraDiferencia} `
      + `hay «${claves[primeraDiferencia]}» y en es.js «${CLAVES_ES[primeraDiferencia]}»`,
    );
  }
});

test('cada clave lleva los mismos {marcadores} en los cinco idiomas', () => {
  for (const clave of CLAVES_ES) {
    const esperados = marcadoresDe(es[clave]);
    for (const code of OTROS) {
      const entrada = DICCIONARIOS[code][clave];
      if (entrada === undefined) continue;      // ya lo denuncia la prueba de paridad
      assert.deepEqual(
        marcadoresDe(entrada), esperados,
        `«${clave}» en ${code}.js no interpola lo mismo que en es.js: `
        + `es tiene [${esperados}] y ${code} tiene [${marcadoresDe(entrada)}]`,
      );
    }
  }
});

test('cada clave conserva su tipo: cadena suelta o plural {one, other}', () => {
  for (const clave of CLAVES_ES) {
    const esperado = tipoDe(es[clave]);
    for (const code of OTROS) {
      const entrada = DICCIONARIOS[code][clave];
      if (entrada === undefined) continue;
      assert.equal(
        tipoDe(entrada), esperado,
        `«${clave}» es ${esperado} en es.js pero ${tipoDe(entrada)} en ${code}.js: `
        + 'un plural sin sus dos formas se traduce mal en cuanto el contador cambia',
      );
      // Un plural al que le falte una forma se cae al de la otra y suena raro.
      if (esperado === 'plural') {
        for (const forma of ['one', 'other']) {
          assert.equal(typeof entrada[forma], 'string', `«${clave}» en ${code}.js no tiene la forma «${forma}»`);
        }
      }
    }
  }
});

test('ninguna clave pierde su marcado <strong> o <em> al traducirse', () => {
  for (const clave of CLAVES_ES) {
    const esperado = marcadoDe(es[clave]);
    for (const code of OTROS) {
      const entrada = DICCIONARIOS[code][clave];
      if (entrada === undefined) continue;
      assert.deepEqual(
        marcadoDe(entrada), esperado,
        `«${clave}» en ${code}.js no lleva el mismo marcado que en es.js: `
        + `es ${JSON.stringify(esperado)} y ${code} ${JSON.stringify(marcadoDe(entrada))}. `
        + 'Estas claves se pintan con data-i18n-html y el énfasis es parte del texto',
      );
    }
  }
});

test('los cinco idiomas del selector son justo los cinco diccionarios que hay', () => {
  assert.deepEqual(IDIOMAS.map((i) => i.code), CODIGOS);
  for (const { code, name } of IDIOMAS) {
    // El nombre se muestra en su propio idioma: nunca se traduce ni se deja vacío.
    assert.ok(name && name.trim().length, `el idioma ${code} no tiene nombre para el selector`);
  }
});

// -------------------------------------------------------------- detección

test('resolverIdioma se queda con el primer idioma del navegador que sepamos hablar', () => {
  assert.equal(resolverIdioma('auto', ['fr-CA', 'en']), 'fr', 'la región se ignora: fr-CA es francés');
  assert.equal(resolverIdioma('auto', ['en-GB', 'es']), 'en');
  assert.equal(resolverIdioma('auto', ['zz', 'pt-BR', 'en']), 'pt', 'se salta los que no conocemos');
  assert.equal(resolverIdioma('auto', ['FR']), 'fr', 'las etiquetas pueden venir en mayúsculas');
});

test('resolverIdioma cae al español cuando no reconoce ningún idioma del navegador', () => {
  assert.equal(resolverIdioma('auto', ['de']), 'es');
  assert.equal(resolverIdioma('auto', []), 'es');
  assert.equal(resolverIdioma('auto', null), 'es', 'un navegador sin lista no debe reventar');
});

test('un código explícito manda sobre el navegador y uno inventado vuelve a la detección', () => {
  for (const code of CODIGOS) {
    assert.equal(resolverIdioma(code, ['de']), code, `la preferencia «${code}» tiene que respetarse`);
  }
  // Una preferencia guardada que ya no exista (o basura de un import) no puede
  // dejar la aplicación muda: se trata igual que 'auto'.
  assert.equal(resolverIdioma('de', ['ko', 'en']), 'ko');
  assert.equal(resolverIdioma(null, ['ko']), 'ko');
  assert.equal(resolverIdioma(42, ['en']), 'en');
  assert.equal(resolverIdioma(undefined, ['fr']), 'fr');
  assert.equal(resolverIdioma({}, ['de']), 'es');
});

test('sin lista explícita la detección mira el navegador de verdad', () => {
  // `navigator` es de solo lectura pero configurable: se sustituye y se repone.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const fingir = (nav) => Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  try {
    fingir({ languages: ['pt-BR', 'en'] });
    assert.equal(resolverIdioma('auto'), 'pt');
    // Safari viejo no trae `languages`; queda `language` a secas.
    fingir({ language: 'ko-KR' });
    assert.equal(resolverIdioma('auto'), 'ko');
    fingir({ languages: [], language: '' });
    assert.equal(resolverIdioma('auto'), 'es');
    fingir(undefined);
    assert.equal(resolverIdioma('auto'), 'es', 'en node no hay navegador y el módulo tiene que seguir cargando');
  } finally {
    Object.defineProperty(globalThis, 'navigator', original);
  }
});

// --------------------------------------------------------------- fallback

test('una clave que solo existe en español se sirve en español aunque el idioma sea otro', () => {
  // No hay ninguna clave descolgada de verdad —la primera prueba lo garantiza—,
  // así que se fabrica una en caliente para ejercitar el camino de respaldo:
  // es lo que pasará el día que alguien añada un texto y solo traduzca es.js.
  const clave = 'prueba.solo.en.espanol';
  es[clave] = 'recién añadida, sin traducir';
  try {
    for (const code of OTROS) {
      conIdioma(code, () => {
        assert.equal(t(clave), 'recién añadida, sin traducir', `en ${code} la clave nueva debería caer al español`);
      });
    }
  } finally {
    delete es[clave];
  }
});

test('una clave que no existe en ningún idioma se devuelve tal cual y queda apuntada', () => {
  const clave = 'clave.inventada.que.no.existe';
  assert.equal(t(clave), clave, 'ver la clave en pantalla es la señal de que falta traducirla');
  assert.ok(
    clavesQueFaltan().includes(clave),
    'clavesQueFaltan() es lo que delata una clave inventada; si no la apunta, el fallo pasa desapercibido',
  );
  assert.equal(t(''), '', 'una clave vacía no ensucia el registro de faltantes');
  assert.equal(t(null), '');
  assert.ok(!clavesQueFaltan().includes(''), 'la clave vacía no debe contarse como texto sin traducir');
});

// ---------------------------------------------------------- interpolación

test('los {marcadores} se sustituyen y el que se queda sin valor se ve en pantalla', () => {
  conIdioma('es', () => {
    assert.equal(t('app.version', { version: '1.5.0' }), 'v1.5.0');
    assert.equal(t('pila.tableau', { n: 3 }), 'columna 3');
    // Dejar el hueco a la vista es deliberado: un texto con {version} suelto
    // canta a la primera y se arregla; uno vacío pasa inadvertido.
    assert.equal(t('app.version'), 'v{version}');
    assert.equal(t('msg.datos.error', {}), 'No se pudo leer el archivo: {error}');
    assert.equal(t('msg.reparto.copiado', { n: 12 }), 'Enlace del reparto #12 copiado.');
  });
});

test('{n} se rellena con params.count cuando no se pasa n a mano', () => {
  conIdioma('es', () => {
    // Los plurales llevan el contador en `count`; escribir además `n` en cada
    // llamada sería repetirse, así que uno cubre al otro.
    assert.equal(t('hud.fundaciones.valor', { count: 13 }), '13/52');
    assert.equal(t('hud.fundaciones.valor', { n: 7 }), '7/52');
    assert.equal(t('hud.fundaciones.valor', { n: 7, count: 13 }), '7/52', 'un n explícito manda sobre count');
    assert.equal(t('hud.fundaciones.valor', { count: 0 }), '0/52', 'cero es un contador válido, no un hueco');
  });
});

test('el plural elige one con uno y other con cero, dos o sin contador', () => {
  conIdioma('es', () => {
    assert.equal(t('msg.autosubir', { count: 1 }), '1 carta arriba.');
    assert.equal(t('msg.autosubir', { count: 0 }), '0 cartas arriba.');
    assert.equal(t('msg.autosubir', { count: 2 }), '2 cartas arriba.');
    // Sin contador no hay nada que decidir: se sirve la forma general.
    assert.equal(t('msg.autosubir'), '{n} cartas arriba.');
  });
  conIdioma('en', () => {
    assert.equal(t('dlg.victoria.nota.racha', { count: 1 }), '1 win in a row');
    assert.equal(t('dlg.victoria.nota.racha', { count: 5 }), '5 wins in a row');
  });
  conIdioma('ko', () => {
    // El coreano no distingue número: las dos formas dicen lo mismo a propósito.
    assert.equal(t('msg.autosubir', { count: 1 }), t('msg.autosubir', { count: 9 }).replace('9', '1'));
  });
});

// ------------------------------------------------------------- traducirDom

/** Fragmento pequeño con un caso de cada atributo, montado en cada prueba. */
function fragmento() {
  const caja = document.createElement('div');
  caja.innerHTML = `
    <h2 data-i18n="dlg.titulo.ajustes"></h2>
    <p id="con-marcado" data-i18n-html="help.regla.orden"></p>
    <button id="boton" data-i18n-title="tool.pista" data-i18n-aria-label="tool.pista"></button>
    <input id="campo" data-i18n-placeholder="settings.nombre.placeholder">
    <span id="con-params" data-i18n="hud.fundaciones.valor" data-i18n-params='{"n":13}'></span>
    <span id="con-plural" data-i18n="msg.autosubir" data-i18n-params='{"count":1}'></span>
    <span id="params-rotos" data-i18n="app.version" data-i18n-params="{esto no es json"></span>
  `;
  return caja;
}

test('traducirDom rellena texto, html, title, aria-label y placeholder del subárbol', () => {
  conIdioma('es', () => {
    const caja = fragmento();
    traducirDom(caja);
    assert.equal(caja.querySelector('h2').textContent, 'Ajustes');
    // data-i18n-html es el único que puede meter etiquetas, y por eso solo se
    // usa con los textos que llevan énfasis en el diccionario.
    assert.match(caja.querySelector('#con-marcado').innerHTML, /<strong>/);
    assert.equal(caja.querySelector('#boton').getAttribute('title'), 'Pista (H)');
    assert.equal(caja.querySelector('#boton').getAttribute('aria-label'), 'Pista (H)');
    assert.equal(caja.querySelector('#campo').getAttribute('placeholder'), 'Anónimo');
  });
});

test('traducirDom lee data-i18n-params y aguanta un JSON roto sin dejar el nodo a medias', () => {
  conIdioma('es', () => {
    const caja = fragmento();
    traducirDom(caja);
    assert.equal(caja.querySelector('#con-params').textContent, '13/52');
    assert.equal(caja.querySelector('#con-plural').textContent, '1 carta arriba.', 'count también viaja en los params del HTML');
    // Con los parámetros rotos se traduce igual: se ve el hueco, no la clave.
    assert.equal(caja.querySelector('#params-rotos').textContent, 'v{version}');
  });
});

test('traducirDom traduce también el nodo raíz que se le pasa, no solo sus hijos', () => {
  conIdioma('es', () => {
    const suelto = document.createElement('span');
    suelto.setAttribute('data-i18n', 'tool.nueva.corto');
    traducirDom(suelto);
    assert.equal(suelto.textContent, 'Nueva');
  });
});

test('traducirDom es idempotente y vuelve a pasar entero al cambiar de idioma', () => {
  const caja = fragmento();
  conIdioma('es', () => {
    traducirDom(caja);
    const primera = caja.innerHTML;
    traducirDom(caja);
    assert.equal(caja.innerHTML, primera, 'repetir la pasada no debe duplicar ni ensuciar nada');
  });
  // El cambio de idioma repinta sobre lo ya traducido: el segundo idioma tiene
  // que borrar del todo al primero, no mezclarse con él.
  conIdioma('en', () => {
    traducirDom(caja);
    assert.equal(caja.querySelector('h2').textContent, 'Settings');
    assert.equal(caja.querySelector('#boton').getAttribute('title'), 'Hint (H)');
    assert.equal(caja.querySelector('#campo').getAttribute('placeholder'), 'Anonymous');
    assert.equal(caja.querySelector('#con-plural').textContent, '1 card up.');
  });
});

test('traducirDom no revienta si le llega algo que no es un nodo', () => {
  assert.doesNotThrow(() => traducirDom(null));
  assert.doesNotThrow(() => traducirDom(42));
});

// --------------------------------------------------- fijarIdioma y avisos

test('fijarIdioma escribe <html lang>, avisa a los suscriptores y la baja los calla', () => {
  const previo = idioma();
  const vistos = [];
  const baja = alCambiarIdioma((code) => vistos.push(code));
  try {
    fijarIdioma('fr');
    assert.equal(idioma(), 'fr');
    // El atributo lang es lo que usan el lector de pantalla y la separación
    // silábica del navegador: si no se actualiza, la traducción se queda a medias.
    assert.equal(document.documentElement.lang, 'fr');
    fijarIdioma('ko');
    assert.equal(document.documentElement.lang, 'ko');
    assert.deepEqual(vistos, ['fr', 'ko']);

    baja();
    fijarIdioma('en');
    assert.deepEqual(vistos, ['fr', 'ko'], 'tras darse de baja no debe recibir más avisos');
    assert.equal(document.documentElement.lang, 'en');
  } finally {
    baja();
    fijarIdioma(previo);
  }
});

test('fijarIdioma con un código imposible deja siempre uno de los cinco idiomas', () => {
  const previo = idioma();
  try {
    for (const basura of ['de', '', null, 42, {}]) {
      fijarIdioma(basura);
      assert.ok(
        CODIGOS.includes(idioma()),
        `fijarIdioma(${JSON.stringify(basura)}) dejó el idioma en «${idioma()}», que no es ninguno de los cinco`,
      );
      assert.equal(document.documentElement.lang, idioma(), 'el <html lang> tiene que seguir al idioma activo');
    }
  } finally {
    fijarIdioma(previo);
  }
});

test('alCambiarIdioma acepta que le pasen cualquier cosa y devuelve una baja que no falla', () => {
  const baja = alCambiarIdioma('esto no es una función');
  assert.equal(typeof baja, 'function');
  assert.doesNotThrow(() => baja());
});

// ------------------------------------------------- nombres de carta y pila

test('nombreCarta suena natural en los cinco idiomas y no deja marcadores sueltos', () => {
  const esperado = {
    es: ['9 de picas', 'as de corazones', 'reina de diamantes', 'rey de tréboles'],
    en: ['nine of spades', 'ace of hearts', 'queen of diamonds', 'king of clubs'],
    fr: ['le neuf de pique', 'l’as de cœur', 'la dame de carreau', 'le roi de trèfle'],
    pt: ['9 de espadas', 'ás de copas', 'dama de ouros', 'rei de paus'],
    // En coreano el palo va delante, que es como se dice de verdad.
    ko: ['스페이드 9', '하트 에이스', '다이아몬드 퀸', '클로버 킹'],
  };
  const cartas = [{ rank: 9, suit: 'S' }, { rank: 1, suit: 'H' }, { rank: 12, suit: 'D' }, { rank: 13, suit: 'C' }];
  for (const code of CODIGOS) {
    conIdioma(code, () => {
      assert.deepEqual(cartas.map(nombreCarta), esperado[code], `los nombres de carta en ${code} no son los esperados`);
    });
  }
});

test('ninguna carta de la baraja se queda con un hueco sin rellenar en ningún idioma', () => {
  for (const code of CODIGOS) {
    conIdioma(code, () => {
      for (const rank of RANKS) {
        for (const suit of SUITS) {
          const nombre = nombreCarta({ rank, suit });
          assert.doesNotMatch(nombre, /[{}]/, `«${nombre}» (${rank}${suit}) deja un marcador sin sustituir en ${code}`);
          assert.notEqual(nombre, '—', `la carta ${rank}${suit} no tiene nombre en ${code}`);
          // Si faltara el rango o el palo, `t` devolvería la clave con puntos.
          assert.doesNotMatch(nombre, /carta\.(rango|palo)\./, `falta una clave de carta en ${code}: ${nombre}`);
        }
      }
    });
  }
});

test('nombreCarta devuelve el guion cuando no hay carta que nombrar', () => {
  conIdioma('es', () => {
    assert.equal(nombreCarta(null), '—');
    assert.equal(nombreCarta({}), '—');
    assert.equal(nombreCarta({ rank: 5 }), '—', 'sin palo no hay nombre posible');
  });
});

test('nombrePila dice columna, fundación, descarte y mazo en cada idioma', () => {
  const esperado = {
    es: ['columna 3', 'pila de picas', 'descarte', 'mazo'],
    en: ['column 3', 'the spades foundation', 'the waste', 'the stock'],
    ko: ['3번 열', '스페이드 파운데이션', '버린 더미', '덱'],
  };
  const refs = [
    { pile: 'tableau', index: 2 },      // el índice es cero y el rótulo empieza en uno
    { pile: 'foundation', index: 0 },   // las fundaciones van en el orden de SUITS
    { pile: 'waste' },
    { pile: 'stock' },
  ];
  for (const [code, textos] of Object.entries(esperado)) {
    conIdioma(code, () => {
      assert.deepEqual(refs.map((r) => nombrePila(r)), textos, `los nombres de pila en ${code} no son los esperados`);
    });
  }
});

test('nombrePila nombra las cuatro fundaciones sin dejar marcadores en ningún idioma', () => {
  // El estado manda sobre el índice: la fundación se nombra por la carta que
  // tiene arriba, que es lo que ve el jugador.
  const state = { foundations: [[{ rank: 1, suit: 'H' }], [], [], []] };
  for (const code of CODIGOS) {
    conIdioma(code, () => {
      assert.match(nombrePila({ pile: 'foundation', index: 0 }, state), new RegExp(t('carta.palo.H')));
      for (let i = 0; i < SUITS.length; i += 1) {
        const nombre = nombrePila({ pile: 'foundation', index: i });
        assert.doesNotMatch(nombre, /[{}]/, `«${nombre}» deja un marcador sin sustituir en ${code}`);
      }
      for (let i = 0; i < 7; i += 1) {
        assert.doesNotMatch(nombrePila({ pile: 'tableau', index: i }), /[{}]/, `la columna ${i} deja un hueco en ${code}`);
      }
    });
  }
});

test('nombrePila devuelve el guion ante una referencia que no reconoce', () => {
  conIdioma('es', () => {
    assert.equal(nombrePila(null), '—');
    assert.equal(nombrePila({ pile: 'inventada' }), '—');
  });
});

// -------------------------------------------------------------------fecha

test('fecha devuelve el guion con cualquier basura y una fecha corta con un ISO válido', () => {
  conIdioma('es', () => {
    for (const basura of [null, undefined, '', 'mañana', 'no-es-una-fecha', {}, NaN]) {
      assert.equal(fecha(basura), '—', `fecha(${JSON.stringify(basura)}) debería ser el guion`);
    }
    // Se construye en hora local para que la prueba no dependa de la zona horaria.
    const corta = fecha(new Date(2024, 2, 15));
    assert.notEqual(corta, '—');
    assert.match(corta, /15/, 'la fecha corta lleva el día');
    assert.match(corta, /24/, 'y el año en dos cifras');
    assert.ok(corta.length <= 20, `«${corta}» no parece una fecha corta`);
    assert.notEqual(fecha('2024-03-15T10:00:00Z'), '—', 'el formato que se guarda en los récords es un ISO');
  });
});

test('fecha se escribe en el idioma activo', () => {
  const marzo = new Date(2024, 2, 15);
  const textos = CODIGOS.map((code) => conIdioma(code, () => fecha(marzo)));
  for (const [i, texto] of textos.entries()) {
    assert.notEqual(texto, '—', `la fecha no se pudo formatear en ${CODIGOS[i]}`);
  }
  // Cinco idiomas y cinco alfabetos distintos: si salieran todas iguales, el
  // formateador estaría ignorando el idioma activo.
  assert.ok(new Set(textos).size > 1, `todas las fechas salen igual (${textos.join(' / ')})`);
});

// ------------------------------------------- ni una cadena española suelta

// Vocabulario del original español que no debería sobrevivir a la traducción.
// Va en dos bloques: palabras del juego, que son las que se olvidan al copiar un
// texto de es.js, y palabras de función, que son la red de seguridad —una frase
// española entera cae por «una», «más», «ya» o «también» aunque no hable de
// cartas—. Se buscan como palabra completa: «carta» no puede saltar dentro de
// «cartão», ni «los» dentro del «levá-los» portugués.
const PALABRAS_DEL_JUEGO = [
  'partida', 'partidas', 'reparto', 'repartos', 'carta', 'cartas',
  'pista', 'pistas', 'mazo', 'mazos', 'descarte', 'descartes',
  'puntuación', 'puntuaciones', 'récord', 'récords',
  'jugada', 'jugadas', 'columna', 'columnas', 'baraja', 'tablero',
  'fundaciones', 'ninguna', 'ninguno', 'ningún', 'navegador', 'ajustes',
  'atajo', 'atajos', 'pila', 'pilas', 'puntos', 'juego', 'tiempo',
  'nueva', 'nuevo', 'nuevas', 'nuevos', 'deshacer', 'reciclar',
  'jota', 'picas', 'corazones', 'tréboles', 'ganaste',
  'racha', 'banca', 'mejor', 'mejores', 'victoria', 'victorias',
  'datos', 'arriba', 'pantalla', 'aplicaciones', 'así', 'ahí', 'único', 'única',
];
const PALABRAS_DE_FUNCION = [
  'el', 'la', 'los', 'las', 'un', 'una', 'del', 'al', 'con', 'y',
  'su', 'sus', 'tus', 'ese', 'esa', 'más', 'sin', 'ya', 'pero', 'hay',
  'muy', 'aquí', 'también', 'después', 'cuando', 'donde', 'porque',
  'cómo', 'qué', 'mismo', 'misma', 'otra', 'otro', 'solo', 'cero',
];

// Coincidencias legítimas, una por una. No es una lista para ir engordando: cada
// palabra que se añada aquí abre un agujero por el que puede colarse un olvido.
//
// pt — el portugués comparte muchísimo léxico con el español y todas estas son
//   portugués correcto y están hoy en pt.js a propósito: «partida» (el juego),
//   «carta»/«cartas», «descarte», «navegador», «ajustes», «reciclar», «banca»,
//   «porque» y «único»/«única» («a única coisa»). «pista» no se usa hoy (pt.js
//   dice «dica») pero es palabra portuguesa y no debe dar la alarma si mañana
//   alguien la prefiere. Las demás sí delatarían un descuido: el portugués dice
//   «jogada», «coluna», «baralho», «monte», «pontos», «tempo» o «melhor».
// fr — «la», «un» e «y» son artículos y pronombre franceses («il y a»), y «con»
//   existe en francés aunque aquí no se use.
// en — «sin» y «hay» son palabras inglesas corrientes.
const EXCEPCIONES = {
  pt: ['partida', 'partidas', 'carta', 'cartas', 'descarte', 'descartes',
    'pista', 'pistas', 'navegador', 'ajustes', 'reciclar', 'banca',
    'porque', 'único', 'única'],
  fr: ['la', 'un', 'y', 'con'],
  en: ['sin', 'hay'],
};

test('ningún idioma se deja una palabra del original español sin traducir', () => {
  for (const code of OTROS) {
    const sospechosas = [...PALABRAS_DEL_JUEGO, ...PALABRAS_DE_FUNCION]
      .filter((p) => !(EXCEPCIONES[code] ?? []).includes(p));
    // Los bordes se escriben a mano: `\b` no sirve porque para JavaScript la
    // tilde es frontera de palabra y «puntuación» daría positivos falsos. El
    // guion entra en el borde por los clíticos portugueses («apagá-los»).
    const patrones = sospechosas.map((p) => [p, new RegExp(`(?<![\\p{L}-])${p}(?![\\p{L}-])`, 'iu')]);
    for (const [clave, entrada] of Object.entries(DICCIONARIOS[code])) {
      // Los {marcadores} llevan nombre español a propósito ({carta}, {origen}):
      // son parte del contrato del diccionario, no texto que lea nadie.
      const texto = textoDe(entrada).replace(/\{\w+\}/g, ' ');
      for (const [palabra, patron] of patrones) {
        assert.ok(
          !patron.test(texto),
          `«${clave}» en src/locales/${code}.js sigue en español: aparece «${palabra}» en «${textoDe(entrada)}»`,
        );
      }
    }
  }
});

test('la eñe no aparece fuera del diccionario español', () => {
  // Ninguno de los otros cuatro idiomas usa esa letra, así que una sola eñe ya
  // es una frase copiada de es.js sin traducir.
  for (const code of OTROS) {
    for (const [clave, entrada] of Object.entries(DICCIONARIOS[code])) {
      assert.doesNotMatch(
        textoDe(entrada), /ñ/i,
        `«${clave}» en src/locales/${code}.js lleva una eñe: eso solo pasa si el texto se quedó en español`,
      );
    }
  }
});

test('el coreano está en hangul y no se le ha colado una frase en alfabeto latino', () => {
  // Los atajos («Ctrl+Z», «Esc»), los rangos y la moneda sí van en latino; lo
  // que no puede haber es una frase entera sin un solo carácter coreano.
  const hangul = /\p{Script=Hangul}/u;
  for (const [clave, entrada] of Object.entries(ko)) {
    const texto = textoDe(entrada).replace(/\{\w+\}/g, ' ');
    // Solo se miran los textos largos: los rótulos cortos son siglas o números.
    const palabras = texto.match(/\p{L}{4,}/gu) ?? [];
    if (palabras.length < 3) continue;
    assert.ok(hangul.test(texto), `«${clave}» en ko.js no tiene ni un carácter en hangul: «${texto}»`);
  }
});

// ------------------------------------- las claves que se usan de verdad

const raiz = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', raiz), 'utf8');
const fuentes = readdirSync(new URL('src/', raiz))
  .filter((f) => f.endsWith('.js'))
  .map((f) => [`src/${f}`, readFileSync(new URL(`src/${f}`, raiz), 'utf8')]);

test('todas las claves que pide index.html existen en el diccionario', () => {
  const usadas = new Map();
  for (const m of html.matchAll(/data-i18n(?:-(?:html|title|aria-label|placeholder))?="([^"]+)"/g)) {
    usadas.set(m[1], (usadas.get(m[1]) ?? 0) + 1);
  }
  assert.ok(usadas.size > 50, 'la interfaz debería estar traducida entera; se han encontrado muy pocas claves');
  for (const clave of usadas.keys()) {
    assert.ok(Object.hasOwn(es, clave), `index.html pide «${clave}» y no existe en src/locales/es.js`);
  }
});

test('todas las claves literales que pide el código de src existen en el diccionario', () => {
  // Solo los literales: `t('...')`, `message('...')` y `avisoPanel('...')`. Las
  // claves montadas con plantilla se comprueban por familias justo debajo.
  const usadas = new Set();
  for (const [fichero, fuente] of fuentes) {
    for (const m of fuente.matchAll(/\b(?:t|message|avisoPanel)\(\s*'([^']+)'/g)) {
      usadas.add(`${fichero}|${m[1]}`);
    }
  }
  assert.ok(usadas.size > 30, 'el código debería pedir bastantes claves; algo va mal en el rastreo');
  for (const par of usadas) {
    const [fichero, clave] = par.split('|');
    assert.ok(Object.hasOwn(es, clave), `${fichero} pide «${clave}» y no existe en src/locales/es.js`);
  }
});

test('las familias de claves que se montan al vuelo están completas', () => {
  // Estas se construyen con plantilla (`carta.rango.${rank}`), así que un
  // olvido no se ve leyendo el código: solo aparece jugando.
  const familias = [
    ...RANKS.map((r) => `carta.rango.${r}`),
    ...SUITS.map((s) => `carta.palo.${s}`),
    ...Object.values(RAZON).map((r) => `pista.${r}`),
    ...['standard', 'vegas'].map((m) => `modo.${m}`),
    ...[1, 3].map((d) => `modo.robo.${d}`),
    ...['ajustes', 'records', 'ayuda'].map((s) => `dlg.titulo.${s}`),
  ];
  for (const clave of familias) {
    assert.ok(Object.hasOwn(es, clave), `falta «${clave}»: se pide con plantilla y sin ella el juego enseñaría la clave cruda`);
  }
});

test('no queda ninguna clave muerta en el diccionario', () => {
  // Al revés que las anteriores: una clave que ya no usa nadie hay que
  // traducirla cinco veces cada vez que se retoca, para nada.
  const familias = [/^carta\.(rango|palo)\./, /^pista\./, /^modo\./, /^dlg\.titulo\./];
  const todo = html + fuentes.map(([, fuente]) => fuente).join('\n');
  const muertas = CLAVES_ES.filter((clave) => (
    !familias.some((re) => re.test(clave))
    && !todo.includes(`'${clave}'`)
    && !todo.includes(`"${clave}"`)
  ));
  assert.deepEqual(muertas, [], `sobran claves que ya no pide nadie: ${muertas.join(', ')}`);
});
