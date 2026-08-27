# Pistas, movimiento, idiomas y UX seleccionada

## Objetivo

Mejorar la fiabilidad de las pistas de Solitario, unificar y pulir su sistema de
movimiento, traducir por completo la aplicación a español, inglés, francés,
portugués y coreano, e implementar únicamente las mejoras UX seleccionadas por
el usuario. La entrega termina publicada y verificada en GitHub Pages.

## Restricciones globales

- La aplicación desplegada seguirá siendo HTML, CSS y JavaScript nativos, sin
  dependencias de producción ni fase de compilación.
- Las pistas recomendarán solo el siguiente movimiento usando cartas visibles.
  Nunca usarán la identidad de cartas tapadas ni mirarán cuál será la próxima
  carta del mazo.
- Si no existe un movimiento visible que haga avanzar la partida, la pista
  recomendará robar o reciclar el descarte cuando sea legal.
- El tablero no tendrá desplazamiento horizontal ni vertical durante el juego.
- Se conservarán funcionamiento offline, partidas guardadas, preferencias,
  puntuación, sonidos y compatibilidad con los datos locales existentes.
- Los cinco idiomas tendrán la misma cobertura funcional; no se admitirán
  textos mezclados salvo símbolos universales de las cartas.

## Arquitectura

### Recomendador

Se creará `src/advisor.js`, un módulo puro que consumirá el estado del motor y
producirá una recomendación estructurada:

```js
{
  move,
  reason,
  alternatives,
  score,
}
```

`reason` será una clave semántica traducible, no texto en español. El módulo:

1. Generará movimientos de cartas visibles, robo y reciclaje.
2. Aplicará cada candidato sobre una copia del estado para evaluar su resultado.
3. Rechazará la inversión inmediata y penalizará cualquier estado ya presente en
   el historial reciente de la partida.
4. Priorizará, por este orden general, destapar una carta, subir con seguridad a
   fundación, sacar una carta del descarte, liberar una columna con utilidad y
   aumentar la movilidad visible.
5. Penalizará fundaciones inseguras, consumir un hueco sin beneficio, mover una
   secuencia sin progreso y reducir la movilidad.
6. Recomendará bajar desde una fundación solo cuando la partida esté bloqueada y
   el resultado cree una jugada visible útil.
7. Recomendará robar o reciclar antes que alternar movimientos reversibles.

El motor expondrá una huella estable del estado que no revele identidades
ocultas al evaluador. `game.hint()` pasará las huellas del historial reciente.
El toque automático de una carta filtrará el mismo ranking por origen, de modo
que pista y toque nunca utilicen criterios contradictorios. Una subida insegura
no se ejecutará automáticamente: requerirá arrastre explícito.

La UI describirá la jugada completa con carta, origen, destino y razón. Solo
existirá una pista visual activa. Se cancelará al pedir otra, jugar, deshacer,
repartir, iniciar un arrastre o cambiar el idioma.

### Internacionalización

Se crearán `src/i18n.js` y diccionarios separados bajo `src/locales/` para:

- `es`: Español
- `en`: English
- `fr`: Français
- `pt`: Português
- `ko`: 한국어

El módulo resolverá pluralización sencilla, interpolación de parámetros, fechas
y nombres accesibles de cartas/pilas. Todo el texto de `index.html` se marcará
con atributos semánticos (`data-i18n`, variantes para `title`, `placeholder` y
`aria-label`). Todo texto creado desde JavaScript usará `t(key, params)`.

En una instalación sin preferencia manual se elegirá el primer idioma compatible
de `navigator.languages`, usando español como fallback. El selector de Ajustes
mostrará los cinco idiomas y guardará la selección mediante las preferencias
existentes. Cambiarlo actualizará el documento sin recargar, establecerá
`<html lang>`, repintará textos dinámicos y conservará la partida.

Las caras de las cartas mantendrán los símbolos internacionales actuales; sus
nombres en mensajes y accesibilidad sí se traducirán. Coreano seguirá usando
dirección izquierda-a-derecha.

### Movimiento y animaciones

Habrá una única función efectiva `motionEnabled`, definida por la preferencia
`animations` y `prefers-reduced-motion`. Su resultado se reflejará en un atributo
global del documento y gobernará:

- vuelos y volteos de cartas;
- reparto inicial y autocompletado;
- pista, rechazo y cambio de puntuación;
- botones pulsantes, actualización y confeti;
- transiciones de controles y diálogos.

Con movimiento reducido o desactivado, las pistas conservarán anillos estáticos
diferentes para origen y destino. Los mensajes nunca dependerán de “parpadea”.
Autocompletado, victoria y bloqueo no conservarán retrasos destinados a una
animación que ya no existe.

Cada vuelo calculará una duración entre 180 y 320 ms a partir de la distancia,
con curva de salida suave. El volteo usará una curva simétrica más corta. Los
rechazos serán rápidos y cancelables; ningún temporizador antiguo podrá borrar
una animación nueva.

`will-change` solo se aplicará a cartas arrastradas o en vuelo. Los reinicios de
pista, rechazo y puntuación evitarán reflows por elemento; se usarán animaciones
cancelables o una única sincronización en bloque. Los pulsos de atención tendrán
un número finito de iteraciones.

### UX seleccionada

#### Deshacer y eliminación de Rehacer

La tercera acción de la barra será **Deshacer**. Se eliminarán el botón, atajos,
ayuda, estado futuro y API pública de Rehacer. Deshacer se mantendrá disponible
en teclado, barra y diálogo de bloqueo cuando exista historial.

#### Feedback dentro de Menú

El diálogo principal incluirá una región `role="status"` visible en la capa del
propio diálogo. Validaciones de reparto, exportación, importación, borrado,
actualización, instalación y ajustes diferidos escribirán allí mientras el
diálogo esté abierto. Los errores de campos aparecerán también junto al control
correspondiente. Los mensajes del tablero seguirán usándose fuera del diálogo.

#### Objetivos táctiles y tablero sin scroll

Las cartas conservarán un objetivo efectivo mínimo de 44 × 44 CSS px. Cuando el
ancho visible no permita siete objetivos sin solapamiento, la selección por
puntero resolverá el elemento jugable cuyo centro esté más cerca, dentro del
radio táctil, evitando que el orden de capas elija una columna vecina.

El layout medirá el alto realmente disponible. Para impedir scroll, compactará
primero los intervalos entre cartas tapadas y descubiertas; si no basta, reducirá
de forma proporcional carta, huecos y tipografía hasta que la columna más larga
quepa. El tapete usará overflow oculto y dispondrá de pruebas para pantallas
estrechas, móviles horizontales y columnas largas.

#### Contexto y navegación

La cabecera mostrará un chip localizado con puntuación, robo y contrarreloj del
reparto activo, por ejemplo `Estándar · 1 carta · crono`. El botón visual
“Ajustes” pasará a llamarse **Menú** y su etiqueta accesible enumerará Ajustes,
Récords y Ayuda.

#### Acciones inválidas

Un arrastre ilegal volverá a origen con feedback visual, sonoro y un mensaje que
explique la regla o indique que el destino no es válido. Tocar un mazo agotado
explicará si no hay descarte o si se alcanzó el límite de pasadas; Vegas mostrará
las pasadas restantes cuando resulte pertinente.

#### Partida bloqueada

Se sustituirá “Ya no hay posibilidad” por lenguaje preciso. Cuando exista un
rescate desde fundación, se indicará que no quedan jugadas directas y se ofrecerá
esa alternativa. Solo se afirmará que no quedan movimientos cuando el motor no
encuentre ninguno legal.

## Flujo de datos

1. El arranque carga preferencias y resuelve idioma y movimiento efectivos.
2. El módulo i18n traduce el DOM antes de abrir ayuda o emitir mensajes.
3. Cada cambio de estado invalida la pista activa y actualiza cabecera, modo y
   disponibilidad de Deshacer.
4. Al pedir pista, `game` entrega estado e historial al recomendador; la UI
   traduce la razón y señala origen y destino.
5. Un cambio de idioma vuelve a traducir DOM y vistas dinámicas sin tocar el
   estado de cartas.
6. Un cambio de movimiento cancela animaciones activas y repinta en el estado
   final coherente.

## Errores y compatibilidad

- Una clave de traducción ausente caerá a español y se hará visible en pruebas.
- Códigos de idioma desconocidos se sanearán a detección automática/español.
- Preferencias guardadas anteriores, sin campo de idioma, seguirán siendo
  válidas y activarán la detección inicial.
- Navegadores sin Web Animations API usarán clases y temporizadores cancelables.
- Un cambio de idioma durante un diálogo conservará sección, foco razonable y
  estado de formularios.
- Los errores de publicación no se ocultarán: no se declarará GitHub Pages listo
  hasta obtener respuesta correcta del sitio publicado.

## Pruebas y criterios de aceptación

### Pistas

- El reparto `#45` no recomienda una inversión inmediata.
- Ninguno de los 150 repartos resolubles entra en un ciclo de dos estados al
  seguir pistas visibles.
- Una fundación insegura pierde frente a una alternativa visible segura.
- Una partida bloqueada recibe la bajada de fundación cuando es el único rescate.
- Cuando solo quedan movimientos reversibles, la pista recomienda el mazo.
- Pista y toque automático seleccionan el mismo destino para el mismo origen.

### Idiomas

- Las cinco tablas contienen exactamente las mismas claves.
- Detección, fallback, persistencia y cambio en vivo funcionan.
- No queda texto español literal en los flujos dinámicos traducibles.
- HTML, títulos, placeholders, ARIA, fechas, confirmaciones, ayuda, razones y
  mensajes se verifican al menos en inglés y coreano mediante DOM.

### Movimiento

- Apagar animaciones detiene todas las familias de movimiento.
- Reduced motion conserva una pista estática comprensible.
- Pedir dos pistas o jugar durante una pista no deja clases ni temporizadores
  obsoletos.
- La duración de vuelo aumenta con distancia dentro de 180–320 ms.
- No existe `will-change` permanente en las 52 cartas.

### UX

- Barra, teclado y ayuda contienen Deshacer y no contienen Rehacer.
- El feedback de Menú es visible dentro del diálogo.
- El modo activo aparece y se traduce.
- Los targets efectivos alcanzan 44 px en anchos de 280 y 320 px.
- El tablero no desborda en móvil horizontal ni con columnas largas.
- Arrastres y mazo inválidos explican el fallo.
- El texto de bloqueo distingue rescate, bloqueo temporal y ausencia de jugadas.

### Regresión y publicación

- Toda la suite existente, actualizada donde cambien requisitos deliberados,
  debe pasar.
- Se añadirán pruebas unitarias, DOM, CSS, PWA y de regresión para el nuevo
  comportamiento.
- La versión se incrementará a `1.5.0`; service worker y precache incluirán todos
  los módulos y diccionarios nuevos.
- Se hará commit en `main`, push a `origin/main` y verificación HTTP del GitHub
  Pages asociado al repositorio.

## Fuera de alcance

- No se hará accesibilidad completa del tablero por lector de pantalla.
- No se habilitará zoom ni scroll del tablero.
- No se sincronizará importación/borrado con preferencias en memoria en esta
  entrega.
- No se añadirá persistencia de diagnósticos de pistas ni botón de valoración.
- No se mostrará el nombre del jugador en Récords ni se rediseñará la tabla.
- No se usará un solucionador omnisciente ni se inspeccionarán cartas ocultas.
