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
  se destapan al llegar, como en la mesa. Dura unos 2,6 s y un toque se lo salta.
- **Botón de rematar**: en cuanto la partida ya no tiene decisiones (todo boca
  arriba y sin mazo) aparece un botón que sube el resto en cascada, una carta
  cada 216 ms. Se puede detener a media cascada.
- Atajos de teclado, tema claro/oscuro, y funciona con el dedo en el móvil.

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
src/solvable-seeds.js  150 repartos con solución comprobada
```

El motor no sabe nada del DOM y la interfaz no sabe nada de las reglas: por eso
todo lo de `src/` menos `ui.js` se puede probar en Node sin navegador.

## Pruebas

```bash
npm test
```

138 pruebas con el runner de Node: reglas (incluido un buscador en profundidad que
gana repartos de verdad y comprueba que la victoria se detecta), puntuación,
persistencia, control de partida, una prueba de integración con jsdom que monta la
página entera y simula arrastrar cartas, una regresión por cada fallo que
encontró la revisión del código, y comprobaciones de contraste (WCAG AA) de los dos
temas.

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
| P / , / ? | récords / ajustes / ayuda |
| Esc | cancelar el arrastre |
