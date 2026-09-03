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

- **Klondike completo**: robar de una o de tres, deshacer (hasta 400 jugadas),
  pistas, subida automática de las cartas que ya no estorban y autocompletado
  cuando la partida está resuelta.
- **Reto diario**: cada día tiene su reparto, y sale de la fecha y de nada más
  (`src/reto.js`). Sin servidor, sin cuentas y sin ponerse de acuerdo: dos
  personas que abran el juego el mismo día reparten las mismas 52 cartas y
  pueden comparar la puntuación. Cada fecha cae en una semilla con solución
  comprobada —robando de una y de tres—, así que el reto es resoluble todos los
  días. El calendario del panel enseña el mes entero con un punto en cada día
  jugado —verde si se ganó—, deja volver a cualquiera del último año y guarda tu
  mejor intento de cada uno. Del futuro no reparte. Se abre con **D** o desde el
  menú, y se puede compartir con `?reto=hoy` o `?reto=AAAA-MM-DD`.
- **Cinco idiomas**: español, inglés, francés, portugués y coreano, con la misma
  cobertura los cinco. Al entrar por primera vez se mira el idioma del navegador;
  desde Ajustes se cambia en caliente, sin recargar y sin perder la partida.
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
  mismo reparto. Con «solo manos con solución» se reparte de una lista de 1070
  semillas resueltas por el buscador de `scripts/gen-solvables.js` (el mismo del
  test `test/engine.test.js`).
- **Picar una carta la mueve sola** a su mejor destino: primero la pila de arriba
  —si sube sin riesgo— y, si no, la columna que mejor le venga (los huecos
  vacíos se dejan para el final, que hacen falta para los reyes). Si lo único que
  se puede hacer con esa carta es subirla arriesgando, sube: negarse y explicar
  por qué dejaba el toque sin hacer nada. Elegir el sitio a mano —dos huecos
  libres, dos columnas donde encaja— se sigue haciendo arrastrando.
- **Reparto animado**: las 28 cartas del tableau salen del mazo de una en una y
  se destapan al llegar con un volteo, como en la mesa. Dura un segundo y un toque
  se lo salta.
- **Cuántas quedan por robar**: el mazo lleva el número encima, sobre el montón.
- **Pista razonada**: `src/advisor.js` simula cada jugada posible y la puntúa —
  destapar antes que subir seguro, subir seguro antes que sacar del descarte,
  robar antes que pasear cartas de un lado a otro— penalizando las fundaciones
  arriesgadas, gastar un hueco sin ganar nada y volver a una posición por la que
  se acaba de pasar. El consejo se explica con palabras («Lleva el 7♥ de la
  columna 2 al 8♠: así destapas la carta que tiene debajo») y señala el sitio: la
  carta que hay que tocar late fuerte, el destino flojito, y si toca robar late
  la carta de encima del mazo. **Una pista es una**: pulsar otra vez enseña la
  misma, que si era la mejor lo sigue siendo. Antes iba pasando por las
  alternativas y el jugador acababa sin saber cuál de las cuatro le convenía.
  **Picar una carta usa exactamente el mismo criterio**, así que la pista y el
  toque nunca llevan la carta a sitios distintos.
- **Sonidos**: los clics de las cartas y los avisos están sintetizados con Web
  Audio, sin un solo fichero de audio ni una petición a la red. Se apagan desde
  Ajustes. El navegador no deja sonar nada hasta que tocas la página, así que el
  reparto de bienvenida es mudo a propósito.
- **Las acciones, abajo**: en un móvil grande, la parte de arriba de la pantalla
  queda lejos del pulgar. Los cinco botones —nueva, repetir, **deshacer**, pista
  y menú— van al fondo, con su rótulo debajo, iconos de trazo propios (no
  emojis, que cada sistema dibuja a su manera) y 82 x 51 px de objetivo, muy por
  encima del mínimo que pide Apple. Rehacer se ha quitado: en un solitario se
  deshace mucho y se rehace casi nunca, y el hueco lo aprovecha mejor deshacer.
- **La cabecera cuenta la partida sin crecer**: un chip con la modalidad del
  reparto («Estándar · 1 carta · crono», o «Reto 29 ago · Estándar · 1 carta»)
  que lleva a Ajustes, y la barra de progreso hacia las 52. Nada de lo que
  aparece y desaparece le cambia el alto: el aviso de reloj parado es una marca
  en la esquina de su caja —y el número se apaga— en vez de una pastilla que
  añadía una fila, y el aviso de versión nueva es una píldora baja que cabe en la
  fila del chip. Con la caja de «Fundaciones» fuera (decía lo mismo que la barra,
  que ahora lleva el número en su `aria-valuetext`), en un móvil de 390 px la
  cabecera pasó de 195 a 114 px, y de 269 a 114 con el aviso de pausa y el de
  actualizar puestos: son 155 px más de tapete. Pulsar el número de reparto copia
  su enlace, con `?seed=` puesto, para retar a alguien a la misma mano.
- **Baraja de cuatro colores** para quien no distinga bien el rojo del negro:
  cada palo con su color, separados también en luminosidad para que se lean en
  escala de grises. Y un pequeño golpe de vibración al colocar y al fallar, en
  los móviles que lo permiten.
- **Un solo panel**: reto, ajustes, récords y ayuda están en el mismo sitio, en
  cuatro secciones. Antes eran tres diálogos y tres botones distintos. Lo que pasa
  dentro se cuenta dentro: la validación del reparto, exportar, importar o borrar
  escriben en el propio diálogo, no en un cartel que queda tapado detrás. Los
  récords enseñan además la evolución de tus últimas veinte partidas.
- **Partida cerrada, dicho con precisión**: un mazo con cartas ya no basta para
  dar una partida por viva. Si ninguna de las que pueden salir cabe en ningún
  sitio —ni ahora ni tras pasear cartas entre columnas—, dar vueltas al montón es
  dar vueltas, y el juego lo dice en vez de dejarte diez minutos robando. Y
  robando de tres se cuenta lo que de verdad llega a lo alto del descarte: sale
  una de cada tres, y reciclar no lo arregla porque la vuelta conserva el orden,
  así que un as enterrado en una posición que nunca sale no salva la partida. El
  aviso se queda fijo en el tablero y se abre un cartel con la salida: deshacer,
  repetir o repartir. Se distinguen además dos cosas: que aún puedas bajar una
  carta de las pilas de arriba, o que no quede nada. Por eso la pista nunca dice
  «no veo ninguna jugada»: si no hay nada sobre la mesa, la pista es robar; y si
  tampoco hay nada que robar, lo que pasa es que la partida está cerrada.
  Cuando algo no se puede hacer se explica por qué: por qué esa carta no entra
  ahí, por qué el mazo no da más de sí, cuántas pasadas te quedan en Vegas.
- **Botón de rematar**: en cuanto la partida ya no tiene decisiones (todo boca
  arriba y sin mazo) aparece un botón que sube el resto en cascada, una carta
  cada 81 ms. Se puede detener a media cascada.
- **Movimiento a la medida**: cada vuelo dura según lo lejos que va (entre 180 y
  324 ms) y entra y sale con una curva, no a golpe seco. Y una carta que va de un
  sitio a otro no se desliza por la mesa: alguien la coge, la lleva por el aire y
  la posa. Se levanta al salir, crece un pelo por el camino —lo que está más
  cerca del ojo se ve más grande—, deja su sombra en la mesa (que es lo que dice
  a qué altura va) y da un golpecito de un píxel al posarse. Las cuatro cosas
  duran exactamente lo que el vuelo, ni más ni menos: antes el levantamiento iba
  por su cuenta y la carta seguía subiendo con la jugada ya hecha. Al destaparse
  también se levanta, como cuando el pulgar despega la carta de la mesa. Y del
  mazo las cartas salen **de una en una y boca abajo**, y se voltean al aterrizar
  en el descarte: robando de tres son tres cartas, no un bloque. Al repartir,
  cada una se destapa cuando llega, no cuando llegaría la que más lejos va. La
  capa de composición se reserva solo mientras una carta vuela o se arrastra, no
  en las 52 a la vez.
  Y hay un único interruptor de movimiento —la preferencia de Ajustes y la del
  sistema (`prefers-reduced-motion`)— que gobierna todo: vuelos, volteos,
  reparto, pistas, pulsos y confeti. Con el movimiento apagado la pista sigue
  entendiéndose, con anillos fijos distintos para el origen y el destino.
- Atajos de teclado, tema claro/oscuro, y funciona con el dedo en el móvil: sin
  zoom por accidente (ni pellizco ni doble toque), con las cartas nunca por
  debajo de los 44 px que pide un objetivo táctil y sin que el tablero llegue a
  hacer scroll. Las cuatro zonas seguras del sistema van por variable
  (`--safe-top` y compañía) y arriba y abajo se apartan con **margen**, no con
  relleno: así esas dos franjas las pinta el tapete y no el velo de las barras,
  que abajo dejaba una banda negra pegada al borde. El `theme-color` se mueve con
  el tema para que el navegador pinte alrededor del mismo verde.

## Aplicación instalable (PWA)

Se instala en el móvil o en el escritorio y funciona **sin conexión**: el service
worker precarga los 30 ficheros que necesita la aplicación, así que después del
primer arranque no hace falta internet para nada. Tampoco lo hacía antes: el
juego nunca ha hablado con ningún servidor.

- **Instalar**: Ajustes → *Instalar en el dispositivo*. En iPhone o iPad no hay
  botón (Safari no lo permite), así que se explica el camino: Compartir →
  «Añadir a pantalla de inicio».
- **Versión**: Ajustes enseña la que está corriendo, `v1.6.3`.
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
mano con zlib: no hacen falta ni ImageMagick ni Pillow). El icono es una mano en
abanico sobre el tapete —dos cartas boca abajo con el azul del reverso del juego
y una boca arriba con su pica—: una pica suelta la tiene media baraja de
aplicaciones, y tres cartas en abanico se leen como «esto es un solitario» ya de
lejos. `icons/icon.svg` dibuja lo mismo a mano, con la misma geometría; si se
cambia una, hay que cambiar la otra.

## Dónde se guarda todo

En `localStorage`, bajo el prefijo `solitario.v1.`:

| Clave | Contenido |
|---|---|
| `solitario.v1.prefs` | ajustes (modalidad, idioma, tema, nombre…) |
| `solitario.v1.stats` | estadísticas por modalidad |
| `solitario.v1.scores` | las 25 mejores partidas |
| `solitario.v1.save` | la partida en curso |
| `solitario.v1.vegasBank` | saldo acumulado de Vegas |
| `solitario.v1.retos` | el mejor intento de cada reto diario |

No sale nada del navegador. Si `localStorage` está bloqueado (modo privado,
cuota llena), el juego sigue funcionando en memoria y solo se pierde el historial
al cerrar.

## Estructura

```
src/cards.js           baraja, aleatoriedad reproducible (mulberry32)
src/engine.js          reglas del Klondike, funciones puras
src/advisor.js         qué jugada conviene y por qué (pista y toque, un solo criterio)
src/reto.js            el reto diario: fecha → semilla solucionable, y las cuentas del calendario
src/scoring.js         los dos sistemas de puntuación
src/storage.js         localStorage con reserva en memoria
src/game.js            partida: motor + puntos + reloj + guardado + deshacer
src/ui.js              tablero: dibujo y gestos
src/panels.js          diálogos (reto y calendario, récords, ajustes, ayuda, victoria)
src/main.js            arranque, cabecera y teclado
src/i18n.js            traducción: detección, plural, interpolación y DOM
src/locales/*.js       los cinco diccionarios (es, en, fr, pt, ko)
src/motion.js          un solo interruptor de movimiento para toda la aplicación
src/pwa.js             service worker, actualización e instalación
src/version.js         la versión, generada desde package.json
src/solvable-seeds.js  1070 repartos con solución comprobada (robar de 1 y de 3)
sw.js                  service worker: precarga y caché
manifest.webmanifest   nombre, iconos, colores y modo de la aplicación
icons/                 iconos generados por scripts/iconos.py
```

El motor no sabe nada del DOM y la interfaz no sabe nada de las reglas: por eso
todo lo de `src/` menos `ui.js` se puede probar en Node sin navegador.

Lo que está decidido y aún no está hecho vive en [`docs/TODO.md`](docs/TODO.md).

## Pruebas

```bash
npm test
```

379 pruebas con el runner de Node: reglas (incluido un buscador en profundidad que
gana repartos de verdad y comprueba que la victoria se detecta), puntuación,
persistencia, control de partida, el recomendador (que ninguna partida entre en
bucle siguiendo sus consejos, que no mire cartas tapadas y que pista y toque no se
contradigan), los cinco diccionarios (mismas claves, mismos marcadores, ni una
cadena en español colada), dos pruebas de integración con jsdom que montan la
página entera y simulan arrastrar cartas, una regresión por cada fallo que
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
| Ctrl+Z, U | deshacer |
| H | pista |
| A | subir automáticamente |
| N / R | partida nueva / repetir reparto |
| , / P / ? | el panel: ajustes / récords / ayuda |
| Esc | cancelar el arrastre |
