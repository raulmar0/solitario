// Sincroniza la versión y la lista de ficheros a precargar a partir de
// package.json. Única fuente de verdad: el campo "version".
//
//   npm run version            → escribe src/version.js y sw.js
//   npm run version -- 1.2.0   → además sube la versión en package.json
//
// Hay una prueba (test/pwa.test.js) que falla si alguno se descuelga.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => readFileSync(join(RAIZ, p), 'utf8');

/** Lo que la aplicación necesita para funcionar sin conexión. */
export function ficherosDelApp(raiz = RAIZ) {
  const listar = (carpeta, filtro) => readdirSync(join(raiz, carpeta))
    .filter(filtro)
    .sort()
    .map((f) => `${carpeta}/${f}`);

  return [
    './',
    'index.html',
    'styles.css',
    'manifest.webmanifest',
    ...listar('icons', (f) => /\.(svg|png)$/.test(f)),
    ...listar('src', (f) => f.endsWith('.js')),
  ];
}

/** Huella del contenido de la aplicación: ocho caracteres bastan y se leen bien. */
export function huella(raiz = RAIZ, ficheros = ficherosDelApp(raiz)) {
  const hash = createHash('sha256');
  for (const ruta of ficheros) {
    if (ruta === './') continue;
    hash.update(ruta);
    hash.update(readFileSync(join(raiz, ruta)));
  }
  return hash.digest('hex').slice(0, 8);
}

export function reescribir(texto, marca, contenido) {
  const patron = new RegExp(`(/\\* === generado: ${marca} === \\*/\\n)[\\s\\S]*?(/\\* === fin generado === \\*/)`);
  if (!patron.test(texto)) throw new Error(`no encuentro el bloque generado «${marca}»`);
  return texto.replace(patron, `$1${contenido}$2`);
}

function principal() {
  const pkgRuta = join(RAIZ, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgRuta, 'utf8'));

  const nueva = process.argv[2];
  if (nueva) {
    if (!/^\d+\.\d+\.\d+$/.test(nueva)) throw new Error(`versión inválida: ${nueva}`);
    pkg.version = nueva;
    writeFileSync(pkgRuta, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  const version = pkg.version;

  writeFileSync(join(RAIZ, 'src/version.js'),
    `// Lo escribe \`npm run version\` a partir de package.json. No editar a mano.\nexport const VERSION = '${version}';\n`);

  const ficheros = ficherosDelApp();
  const marca = huella(RAIZ, ficheros);      // se calcula con src/version.js ya escrito
  let sw = leer('sw.js');
  sw = reescribir(sw, 'versión', `const VERSION = '${version}';\n`);
  sw = reescribir(sw, 'huella', `const BUILD = '${marca}';\n`);
  sw = reescribir(sw, 'ficheros',
    `const FICHEROS = [\n${ficheros.map((f) => `  '${f}',`).join('\n')}\n];\n`);
  writeFileSync(join(RAIZ, 'sw.js'), sw);

  console.log(`versión ${version} · huella ${marca} · ${ficheros.length} ficheros a precargar`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) principal();
