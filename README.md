# Solitario

Klondike en el navegador, con puntuación, estadísticas y récords guardados en tu
propio equipo. Sin cuentas, sin servidor, sin dependencias: HTML, CSS y JavaScript
a secas (módulos ES nativos).

## Jugar

```bash
npm run dev      # http://127.0.0.1:5173
```

`scripts/dev.js` es un servidor estático de 40 líneas con la biblioteca estándar
de Node. También vale abrir `index.html` con cualquier otro servidor estático
(con `file://` no funciona: los módulos ES necesitan HTTP).

## Qué trae

- **Klondike completo**: robar de una o de tres, deshacer y rehacer (hasta 400
  jugadas), pistas, subida automática de las cartas que ya no estorban y autocompletado
  cuando la partida está resuelta.
- **Dos sistemas de puntuación**
  - *Estándar* (tipo Microsoft Solitaire): +10 por carta a las pilas de arriba,
    +5 al destapar una carta o traer una del descarte a una columna, −15 al bajar
    una carta, −100 al reciclar el mazo robando de una (−20 a partir de la cuarta
    pasada robando de tres). Opción contrarreloj: −2 puntos cada 10 s y
    bonificación de `700000 / segundos` al ganar.
  - *Vegas*: pagas 52 $ de entrada, cobras 5 $ por carta subida y el saldo se
    acumula entre partidas. Las pasadas al mazo están limitadas (una robando de
    una, tres robando de tres).
- **Récords locales**: partidas, victorias, porcentaje, mejor puntuación, mejor
  tiempo, menos jugadas, racha actual y mejor racha — todo separado por
  modalidad — más una tabla con las 25 mejores partidas. Se pueden exportar e
  importar en JSON y borrar del todo.
- **La partida a medias se guarda sola**: si cierras la pestaña, al volver sigue
  donde estaba (con parte del historial de deshacer).
- **Repartos reproducibles**: cada partida tiene un número. El mismo número
  reparte siempre las mismas cartas, así que se puede competir con alguien por el
  mismo reparto. Con «solo manos con solución» se reparte de una lista de 150
  semillas resueltas por el buscador de `test/engine.test.js`.
- **Picar una carta la mueve sola** a su mejor destino: primero la pila de arriba
  y, si no, la columna que mejor le venga (los huecos vacíos se dejan para el
  final, que hacen falta para los reyes). Para elegir el sitio a mano —dos huecos
  libres, dos columnas donde encaja— se arrastra.
- **Reparto animado**: las 28 cartas del tableau salen del mazo de una en una y
  se destapan al llegar con un volteo, como en la mesa. Dura un segundo y un toque
  se lo salta.
- **Cuántas quedan por robar**: el mazo lleva el número encima, sobre el montón.
- **Pista con la carta señalada**: al pedir consejo, la carta que hay que tocar
  late fuerte y el sitio donde va se marca flojito, para no confundirlos.
- **Sonidos**: los clics de las cartas y los avisos están sintetizados con Web
  Audio, sin un solo fichero de audio ni una petición a la red. Se apagan desde
  Ajustes. El navegador no deja sonar nada hasta que tocas la página, así que el
  reparto de bienvenida es mudo a propósito.
- **Las acciones, abajo**: en un móvil grande, la parte de arriba de la pantalla
  queda lejos del pulgar. Los cinco botones —nueva, repetir, rehacer, pista y
  ajustes— van al fondo, con su rótulo debajo, iconos de trazo propios (no
  emojis, que cada sistema dibuja a su manera) y 82 x 51 px de objetivo, muy por
  encima del mínimo que pide Apple.
- **Un solo panel**: ajustes, récords y ayuda están en el mismo sitio, en tres
  secciones. Antes eran tres diálogos y tres botones distintos. Deshacer y subir
  las cartas que no estorban se quedaron sin botón: lo primero está en el
  teclado y en el cartel de partida muerta, y lo segundo lo hace el botón de
  rematar cuando toca.
- **Sin salida**: cuando ya no queda ninguna jugada se dice en el tablero —el
  aviso se queda fijo— y se abre un cartel que lo explica y ofrece la salida:
  deshacer, repetir el mismo reparto o repartir de nuevo. Si aún cabe bajar una
  carta de las pilas de arriba, se dice también.
- **Botón de rematar**: en cuanto la partida ya no tiene decisiones (todo boca
  arriba y sin mazo) aparece un botón que sube el resto en cascada, una carta
  cada 81 ms. Se puede detener a media cascada.
- Atajos de teclado, tema claro/oscuro, y funciona con el dedo en el móvil: sin
  zoom por accidente (ni pellizco ni doble toque) y dejándole su hueco a la
  muesca del iPhone. Las animaciones van a velocidad lineal, sin acelerones.

## Aplicación instalable (PWA)

Se instala en el móvil o en el escritorio y funciona **sin conexión**: el service
worker precarga los 20 ficheros que necesita la aplicación, así que después del
primer arranque no hace falta internet para nada. Tampoco lo hacía antes: el
juego nunca ha hablado con ningún servidor.

- **Instalar**: Ajustes → *Instalar en el dispositivo*. En iPhone o iPad no hay
  botón (Safari no lo permite), así que se explica el camino: Compartir →
  «Añadir a pantalla de inicio».
- **Versión**: Ajustes enseña la que está corriendo, `v1.4.0`.
- **Actualizar**: Ajustes → *Buscar actualización*. Y si aparece una versión
  nueva mientras juegas, sale un aviso arriba con un botón para saltar a ella.

El worker **no se cuela solo**: al instalarse se queda esperando y solo toma el
control cuando el jugador lo pide. Cambiar la aplicación debajo de los pies a
media partida sería peor que esperar.

### Sacar una versión nueva

```bash
npm run version -- 1.2.0      # sube package.json, src/version.js y sw.js
npm test                      # hay pruebas que fallan si algo se descuelga
git commit -am "…" && git push
```

`sw.js` lleva la versión, una huella del contenido y la lista de ficheros a
precargar en tres bloques marcados que escribe `scripts/version.js`. El nombre
de la caché es `solitario-v<versión>-<huella>`, y eso resuelve dos cosas: la
versión nueva nunca escribe encima de la caja que está sirviendo la anterior, y
si alguien toca código sin subir la versión la huella cambia igual, así que los
que ya la tienen instalada no se quedan atrapados en lo viejo.

Los iconos se generan con `npm run icons` (`scripts/iconos.py`, PNG escritos a
mano con zlib: no hacen falta ni ImageMagick ni Pillow).

## Dónde se guarda todo

En `localStorage`, bajo el prefijo `solitario.v1.`:

| Clave | Contenido |
|---|---|
| `solitario.v1.prefs` | ajustes (modalidad, tema, nombre…) |
| `solitario.v1.stats` | estadísticas por modalidad |
| `solitario.v1.scores` | las 25 mejores partidas |
| `solitario.v1.save` | la partida en curso |
| `solitario.v1.vegasBank` | saldo acumulado de Vegas |

No sale nada del navegador. Si `localStorage` está bloqueado (modo privado,
cuota llena), el juego sigue funcionando en memoria y solo se pierde el historial
al cerrar.

## Estructura

```
src/cards.js           baraja, aleatoriedad reproducible (mulberry32)
src/engine.js          reglas del Klondike, funciones puras
src/scoring.js         los dos sistemas de puntuación
src/storage.js         localStorage con reserva en memoria
src/game.js            partida: motor + puntos + reloj + guardado + deshacer
src/ui.js              tablero: dibujo y gestos
src/panels.js          diálogos (récords, ajustes, ayuda, victoria)
src/main.js            arranque, cabecera y teclado
src/pwa.js             service worker, actualización e instalación
src/version.js         la versión, generada desde package.json
src/solvable-seeds.js  150 repartos con solución comprobada
sw.js                  service worker: precarga y caché
manifest.webmanifest   nombre, iconos, colores y modo de la aplicación
icons/                 iconos generados por scripts/iconos.py
```

El motor no sabe nada del DOM y la interfaz no sabe nada de las reglas: por eso
todo lo de `src/` menos `ui.js` se puede probar en Node sin navegador.

## Pruebas

```bash
npm test
```

199 pruebas con el runner de Node: reglas (incluido un buscador en profundidad que
gana repartos de verdad y comprueba que la victoria se detecta), puntuación,
persistencia, control de partida, una prueba de integración con jsdom que monta la
página entera y simula arrastrar cartas, una regresión por cada fallo que
encontró la revisión del código, comprobaciones de contraste (WCAG AA) de los dos
temas, y el service worker ejecutado dentro de un entorno fingido para comprobar
la precarga, el borrado de cachés viejas y el funcionamiento sin conexión.

`jsdom` es la única dependencia y solo para las pruebas: lo que se despliega no
lleva ni una línea de código ajeno.

## Desplegar

Es un sitio estático. El `Dockerfile` sirve los ficheros con nginx.

```bash
docker build -t solitario . && docker run --rm -p 8080:80 solitario
```

En Dokploy (ver `../CLAUDE.md`): sube el repo a GitHub, crea la aplicación en el
proyecto que quieras, conéctale el repo y despliega. Al no haber build, tarda
poco y no compite por la RAM de la máquina.

### GitHub Pages

Vale tal cual: no hay build, todas las rutas son relativas (funciona igual en la
raíz que en `usuario.github.io/solitario/`) y el juego no habla con ningún
servidor. El `.nojekyll` que hay en la raíz evita que Pages intente pasarle
Jekyll por encima.

```bash
gh auth login
gh repo create solitario --public --source=. --push
gh api -X POST repos/:owner/solitario/pages \
  -f 'source[branch]=main' -f 'source[path]=/'
```

O, sin API: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.
Queda en `https://<usuario>.github.io/solitario/` en un par de minutos.

Dos cosas a tener en cuenta:

- Pages **necesita que el repositorio sea público** (con repo privado hace falta
  GitHub Pro o Team).
- Pages no deja poner cabeceras HTTP, así que la misma política de seguridad que
  sirve nginx va también en un `<meta http-equiv="Content-Security-Policy">` del
  `index.html`. Lo único que se pierde por el camino es `frame-ancestors`, que en
  `meta` se ignora.

Los récords se guardan por origen: los de `github.io` y los del servidor propio
son dos historiales distintos. El botón **Exportar datos** sirve para pasarlos de
uno a otro.

## Atajos

| Tecla | Acción |
|---|---|
| Espacio | robar del mazo |
| 1…7 | subir la carta de esa columna |
| 0 | subir la carta del descarte |
| Ctrl+Z / Ctrl+Y | deshacer / rehacer |
| H | pista |
| A | subir automáticamente |
| N / R | partida nueva / repetir reparto |
| , / P / ? | el panel: ajustes / récords / ayuda |
| Esc | cancelar el arrastre |
