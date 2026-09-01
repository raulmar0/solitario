# Pendientes

Ideas aceptadas que todavía no están hechas. No es una lista de deseos: lo que
está aquí es porque se ha decidido que se hará, y con el suficiente detalle como
para que quien lo coja no tenga que volver a discutirlo.

## Volver al final de una partida cerrada, para aprender

**Qué.** Cuando una partida se cierra —ya no hay jugada posible ni sobre la mesa
ni con lo que quede por robar— el juego ofrece deshacer para buscar dónde estuvo
el error. El problema es el viaje de vuelta: en cuanto deshaces tres o cuatro
jugadas ya no sabes cómo estaba el tablero al final, y no hay forma de volver.
Rehacer se quitó del juego a propósito (en un solitario se deshace mucho y se
rehace casi nunca), así que ahora mismo el final se pierde en cuanto lo dejas.

Hace falta un modo de repaso: al cerrarse la partida se guarda la posición final
y se puede ir y volver entre ella y cualquier punto anterior, sin perder ninguna
de las dos.

**Por qué.** Es donde de verdad se aprende a jugar. La pista te dice qué hacer
ahora; esto te deja ver qué jugada de hace veinte movimientos te dejó sin
huecos. Y el coste de la partida ya está pagado —está cerrada y contada como
derrota—, así que curiosear no puede estropear nada.

**Cómo, a grandes rasgos.**

- El controlador (`src/game.js`) ya guarda hasta 400 pasos en `history`, y
  `undo()` los va sacando. Para esto hace falta que deshacer en modo repaso no
  destruya: un cursor sobre el historial en vez de un `pop()`.
- Un estado nuevo del controlador, «repaso», distinto de `stuck`: no se puntúa,
  no se cronometra y no se vuelve a contar la partida (ya está en los récords).
  Al entrar se congela la posición final; al salir, se vuelve a ella.
- En el diálogo de partida cerrada (`#dlg-stuck`), un botón más: «Ver dónde se
  torció». Abre el repaso en vez de repartir de nuevo.
- Durante el repaso, la barra de acciones cambia: atrás, adelante, «volver al
  final» y «salir». La pista tiene que seguir funcionando —es justo lo que se
  quiere ver: qué habría dicho el consejero en esa posición—.
- La posición final se guarda con la partida (`store.saveGame`) para que el
  repaso sobreviva a cerrar la pestaña.
- Un aviso claro de que lo que se está viendo es una partida ya terminada: nadie
  debe creer que sigue jugando.

**Cuidado con.** El historial guardado en `localStorage` son solo los últimos 25
pasos (`SAVED_HISTORY`), así que un repaso recuperado de disco no llega tan atrás
como uno en memoria. O se sube ese tope para las partidas cerradas, o se dice
cuántas jugadas hay disponibles y ya.
