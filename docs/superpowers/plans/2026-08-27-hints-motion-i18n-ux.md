# Hints, Motion, i18n, and Selected UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable visible-card hints, coherent and accessible motion, complete five-language localization, the selected UX changes, and a verified GitHub Pages release.

**Architecture:** Add three focused pure modules: `advisor.js` ranks visible next moves, `i18n.js` owns locale resolution/translation, and `motion.js` owns effective motion state. Existing game, board, panels, and main modules consume those interfaces; HTML carries translation keys while CSS responds to global motion and measured layout variables.

**Tech Stack:** Native ES modules, HTML5, CSS, Node test runner, jsdom, service worker, Git, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-27-hints-motion-i18n-ux-design.md`

## Global Constraints

- Production remains dependency-free HTML, CSS, and native JavaScript with no build step.
- Hints inspect only visible cards and recommend exactly one next action; they never inspect hidden identities or the next stock card.
- If no visible move makes progress, recommend draw/recycle when legal.
- The board must not scroll horizontally or vertically.
- Preserve offline use, saved games, scoring, sound, and existing local data.
- Spanish, English, French, Portuguese, and Korean must have equal runtime coverage.
- Release version is `1.5.0` and the final state must be pushed to `origin/main` and verified on GitHub Pages.

---

### Task 1: Internationalization Core and Locale Dictionaries

**Files:**
- Create: `src/i18n.js`
- Create: `src/locales/es.js`
- Create: `src/locales/en.js`
- Create: `src/locales/fr.js`
- Create: `src/locales/pt.js`
- Create: `src/locales/ko.js`
- Modify: `src/storage.js:17-27`
- Modify: `scripts/version.js:18-31`
- Create: `test/i18n.test.js`
- Modify: `test/storage.test.js:11-27`

**Interfaces:**
- Produces: `SUPPORTED_LOCALES`, `resolveLocale(preferred, browserLanguages)`, `createI18n({ locale, fallback, catalogs })`, and singleton exports `initI18n`, `setLocale`, `getLocale`, `t`, `translateDom`, `formatDate`, `cardName`, `onLocaleChange`.
- Produces: `prefs.language`, sanitized to `null | 'es' | 'en' | 'fr' | 'pt' | 'ko'`.
- Produces: recursive application-file discovery so `src/locales/*.js` enters the service-worker precache.

- [ ] **Step 1: Write failing locale parity, detection, interpolation, fallback, and persistence tests**

```js
// test/i18n.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  SUPPORTED_LOCALES, dictionaries, resolveLocale, createI18n,
} from '../src/i18n.js';

test('los cinco idiomas contienen exactamente las mismas claves', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['es', 'en', 'fr', 'pt', 'ko']);
  const expected = Object.keys(dictionaries.es).sort();
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(dictionaries[locale]).sort(), expected, locale);
  }
});

test('detecta el primer idioma compatible y usa español como fallback', () => {
  assert.equal(resolveLocale(null, ['de-DE', 'fr-CA', 'en-US']), 'fr');
  assert.equal(resolveLocale(null, ['pt-BR']), 'pt');
  assert.equal(resolveLocale(null, ['ko-KR']), 'ko');
  assert.equal(resolveLocale(null, ['de-DE']), 'es');
  assert.equal(resolveLocale('en', ['fr-FR']), 'en');
});

test('traduce texto, atributos, parámetros y fallback', () => {
  const dom = new JSDOM('<button data-i18n="toolbar.undo" data-i18n-title="toolbar.undoTitle"></button>');
  const i18n = createI18n({ locale: 'ko' });
  i18n.translateDom(dom.window.document);
  assert.equal(dom.window.document.querySelector('button').textContent, '실행 취소');
  assert.match(i18n.t('hint.moveToTableau', { card: '7♥', target: '8♣' }), /7♥/);
  const fallback = createI18n({
    locale: 'ko',
    catalogs: { es: { only: 'reserva española' }, ko: {} },
  });
  assert.equal(fallback.t('only'), 'reserva española');
});
```

Extend `test/storage.test.js` to assert `DEFAULT_PREFS.language === null`, valid locale persistence, and invalid locale sanitization back to `null`.

- [ ] **Step 2: Run focused tests and confirm they fail because the module and preference do not exist**

Run: `node --test test/i18n.test.js test/storage.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/i18n.js` and missing `language` assertions.

- [ ] **Step 3: Implement the i18n API and complete dictionaries**

Use flat semantic keys. The Spanish dictionary is the canonical key set; every other dictionary must define every key. Namespaces must include:

```js
export default {
  'app.title': 'Solitario',
  'toolbar.new': 'Nueva',
  'toolbar.restart': 'Repetir',
  'toolbar.undo': 'Deshacer',
  'toolbar.hint': 'Pista',
  'toolbar.menu': 'Menú',
  'mode.standard': 'Estándar',
  'mode.vegas': 'Vegas',
  'hint.reveal': 'Destapa una carta',
  'hint.safeFoundation': 'Sube una carta que ya no hace falta abajo',
  'hint.draw': 'Roba del mazo',
  'hint.recycle': 'Recicla el descarte',
  'hint.foundationRescue': 'Baja una carta para crear una jugada',
  'error.invalidTableau': 'En las columnas se baja alternando color',
  'error.invalidFoundation': 'Las pilas suben por palo desde el as',
  'error.emptyOnlyKing': 'En un hueco vacío solo entra un rey',
  'error.stockExhausted': 'No quedan cartas ni más pasadas por el mazo',
  'status.stuckRecoverable': 'No quedan jugadas directas. Puedes bajar una carta de las pilas superiores.',
  'status.noMoves': 'No queda ningún movimiento legal.',
};
```

`createI18n` must interpolate `{name}` placeholders, fall back to Spanish for missing keys, set text and `title`/`placeholder`/`aria-label` attributes, and expose localized date/card helpers. `setLocale` must notify subscribers only when the resolved locale changes.

- [ ] **Step 4: Add and sanitize the language preference**

Add `language: null` to `DEFAULT_PREFS`. In `getPrefs`, retain only the five supported codes; otherwise reset to `null`. Do not write automatic detection back until the user changes the selector.

- [ ] **Step 5: Make application-file discovery recursive**

Replace the one-level `listar('src', ...)` helper with a deterministic recursive walker returning POSIX-style relative paths. Keep icons one level deep. Add a `test/pwa.test.js` assertion that `src/locales/es.js` and `src/locales/ko.js` are included after the files exist.

- [ ] **Step 6: Run focused tests and confirm they pass**

Run: `node --test test/i18n.test.js test/storage.test.js test/pwa.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the i18n core**

```bash
git add src/i18n.js src/locales src/storage.js scripts/version.js test/i18n.test.js test/storage.test.js test/pwa.test.js
git commit -m "feat: add complete five-language i18n core"
```

---

### Task 2: Visible-Card Recommendation Engine

**Files:**
- Create: `src/advisor.js`
- Modify: `src/engine.js:210-305`
- Create: `test/advisor.test.js`
- Modify: `test/engine.test.js:286-297`
- Modify: `test/regresiones.test.js:104-145`

**Interfaces:**
- Consumes: pure move generation/application from `engine.js`.
- Produces: `visibleStateKey(state)`, `recommend(state, { seenKeys, from })`, `describeMove(state, recommendation)`, and `isProgressMove(state, move)`.
- `recommend` returns `null` or `{ move, reason, alternatives, score }`; `reason` is an i18n key.

- [ ] **Step 1: Write failing tests for cycles, safety, rescue, draw, and origin filtering**

```js
// test/advisor.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/engine.js';
import { PILE } from '../src/engine.js';
import { recommend, visibleStateKey } from '../src/advisor.js';

const card = (rank, suit, faceUp = true) => ({
  id: `${rank}${suit}`, rank, suit, faceUp,
});
const foundation = (suit, rank) => Array.from({ length: rank }, (_, i) => card(i + 1, suit));
const state = (over = {}) => ({
  seed: 1,
  drawCount: 1,
  scoring: 'standard',
  stock: [],
  waste: [],
  foundations: [[], [], [], []],
  tableau: [[], [], [], [], [], [], []],
  recycles: 0,
  maxRecycles: Infinity,
  ...over,
});

test('el reparto 45 no recomienda volver al estado anterior', () => {
  let state = engine.newGame({ seed: 45, drawCount: 1 });
  const first = recommend(state, { seenKeys: new Set([visibleStateKey(state)]) });
  const previous = visibleStateKey(state);
  state = engine.applyMove(state, first.move).state;
  const second = recommend(state, { seenKeys: new Set([previous, visibleStateKey(state)]) });
  assert.notEqual(visibleStateKey(engine.applyMove(state, second.move).state), previous);
});

test('una fundación insegura pierde frente a una colocación visible', () => {
  const position = state({
    foundations: [foundation('S', 4), [], [], []],
    tableau: [[card(9, 'C', false), card(5, 'S')], [card(6, 'H')], [], [], [], [], []],
  });
  const result = recommend(position, { seenKeys: new Set() });
  assert.deepEqual(result.move.to, { pile: PILE.TABLEAU, index: 1 });
  assert.equal(result.reason, 'hint.reveal');
});

test('si solo queda reorganizar sin progreso recomienda robar', () => {
  const position = state({
    stock: [card(1, 'H', false)],
    tableau: [[card(7, 'D')], [card(8, 'C')], [card(8, 'S')], [], [], [], []],
  });
  assert.deepEqual(recommend(position, { seenKeys: new Set() }).move, { type: 'draw' });
});

test('incluye bajar de fundación cuando es el único rescate visible', () => {
  const position = state({
    foundations: [foundation('S', 5), [], [], []],
    tableau: [[card(6, 'H')], [], [], [], [], [], []],
  });
  const result = recommend(position, { seenKeys: new Set() });
  assert.equal(result.move.from.pile, PILE.FOUNDATION);
  assert.equal(result.reason, 'hint.foundationRescue');
});
```

For the separate engine invariant regression, wrap equivalent visible layouts in the existing full-52-card `tablero()` helper from `test/regresiones.test.js`; advisor unit fixtures may stay minimal because they test pure ranking rather than deck validity.

- [ ] **Step 2: Run the new tests and confirm module-not-found failure**

Run: `node --test test/advisor.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/advisor.js`.

- [ ] **Step 3: Export engine helpers needed by the advisor**

Export a read-only `pileFor(state, ref)` wrapper and keep `cardMoves`/`usefulMoves` pure. Do not move ranking back into `engine.js`; remove the old `hint()` ranking only after all callers migrate in Task 3.

- [ ] **Step 4: Implement visible fingerprints and candidate scoring**

The visible fingerprint must encode stock count, waste IDs, foundation IDs, tableau visible IDs, face-down counts, recycle count, and limit—never hidden IDs.

Use deterministic scoring with explicit constants:

```js
const SCORE = {
  REVEAL: 1200,
  SAFE_FOUNDATION: 800,
  FROM_WASTE: 550,
  FREE_COLUMN: 350,
  MOBILITY: 45,
  DRAW: 120,
  RECYCLE: 90,
  FOUNDATION_RESCUE: 180,
  UNSAFE_FOUNDATION: -900,
  EMPTY_COLUMN_COST: -220,
  REVERSIBLE: -500,
  SEEN_STATE: -100000,
};
```

Apply candidates once, compare visible mobility before/after, and sort by score then stable move key. Include draw/recycle in the same candidate list. A card move scoring at or below the best legal draw/recycle must not displace the stock action. Only evaluate foundation-to-tableau candidates if ordinary visible candidates fail to progress; require positive mobility delta.

When `from` is supplied, return only moves matching pile/index/count. Exclude unsafe foundation moves from this automatic-origin mode.

- [ ] **Step 5: Add the 150-seed no-two-state-cycle regression**

For each `SOLVABLE_SEEDS` seed and draw mode, follow at most 200 recommendations while adding each visible key to `seenKeys`. Assert that no recommended result equals either of the previous two keys. Stop normally on win, `null`, or an exhausted non-progress position; this test measures cycle safety, not guaranteed victory.

- [ ] **Step 6: Run advisor and engine tests**

Run: `node --test test/advisor.test.js test/engine.test.js test/regresiones.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the advisor**

```bash
git add src/advisor.js src/engine.js test/advisor.test.js test/engine.test.js test/regresiones.test.js
git commit -m "feat: recommend visible moves without cycles"
```

---

### Task 3: Game Integration and Removal of Redo

**Files:**
- Modify: `src/game.js:20-400`
- Modify: `src/engine.js:276-296`
- Modify: `test/game.test.js`
- Modify: `test/engine.test.js:286-297`
- Modify: `test/regresiones.test.js`

**Interfaces:**
- Consumes: `recommend` and `visibleStateKey` from Task 2.
- Produces: `game.hint()` returning the structured recommendation.
- Produces: `game.bestMoveFor(from, count)` using the same advisor.
- Removes: `future`, `canRedo`, and `redo()`.

- [ ] **Step 1: Change game tests first**

Replace redo expectations with:

```js
test('deshacer queda disponible y rehacer desaparece', () => {
  const { game } = crear();
  game.newGame(17);
  game.draw();
  assert.equal(game.canUndo, true);
  assert.equal(game.undo(), true);
  assert.equal(game.moves, 0);
  assert.equal('canRedo' in game, false);
  assert.equal('redo' in game, false);
});

test('la pista comparte evaluador con el toque automático', () => {
  const { game } = crear();
  let recommendation = null;
  for (const seed of [5, 8, 17, 21]) {
    game.newGame(seed);
    recommendation = game.hint();
    if (recommendation?.move.type === 'move') break;
  }
  assert.equal(recommendation.move.type, 'move');
  assert.deepEqual(game.bestMoveFor(recommendation.move.from, recommendation.move.count).move,
    recommendation.move);
});
```

Update every existing test that calls `redo()` or reads `canRedo`; retain undo persistence and history-limit coverage.

- [ ] **Step 2: Run game tests and confirm old redo behavior causes failures**

Run: `node --test test/game.test.js test/regresiones.test.js`

Expected: FAIL because redo still exists and hint returns a bare move.

- [ ] **Step 3: Remove redo state and wire the advisor**

Delete `future`, all assignments that clear/populate it, getters, and `redo()`. Keep history snapshots for undo and recommendation fingerprints. `game.hint()` must pass a set built from the last 64 history states plus the current key. `bestMoveFor(from, count)` must pass `{ from: { ...from, count } }` to the same advisor.

Callers still needing a bare move use `.move`; do not make `game.play` accept recommendation objects.

Delete the obsolete `engine.hint()` implementation and replace its legality-only test with advisor quality coverage. Update every `game.hint()` call in `test/game.test.js` and `test/regresiones.test.js` to pass `recommendation.move` into `game.play()`.

- [ ] **Step 4: Run game tests**

Run: `node --test test/game.test.js test/regresiones.test.js`

Expected: PASS.

- [ ] **Step 5: Commit game integration**

```bash
git add src/game.js src/engine.js test/game.test.js test/engine.test.js test/regresiones.test.js
git commit -m "feat: unify hints and tap moves and remove redo"
```

---

### Task 4: Complete Runtime Translation and Selected Navigation UX

**Files:**
- Modify: `index.html`
- Modify: `src/main.js`
- Modify: `src/panels.js`
- Modify: `src/scoring.js`
- Modify: `src/game.js`
- Modify: `manifest.webmanifest`
- Modify: `test/dom.test.js`
- Modify: `test/scoring.test.js`

**Interfaces:**
- Consumes: Task 1 singleton i18n API and Task 3 structured hints.
- Produces: `#language-select`, `#mode-chip`, `#panel-status`, `#seed-error`, and translated static/dynamic UI.
- Removes: `#btn-redo`; adds `#btn-undo` in the same toolbar position.

- [ ] **Step 1: Write failing DOM tests for language switching, undo/menu, mode, and panel-local feedback**

```js
test('la barra tiene Deshacer y Menú, sin Rehacer', () => {
  assert.ok($('#btn-undo'));
  assert.equal($('#btn-redo'), null);
  assert.equal($('#btn-settings .rotulo').textContent, 'Menú');
});

test('cambiar a coreano traduce DOM, mensajes y accesibilidad sin recargar', () => {
  panels.openSettings();
  $('#language-select').value = 'ko';
  $('#language-select').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.documentElement.lang, 'ko');
  assert.equal($('#btn-undo .rotulo').textContent, '실행 취소');
  assert.match($('#btn-hint').getAttribute('aria-label'), /힌트/);
  assert.match($('#panel-titulo').textContent, /설정/);
});

test('el feedback de una semilla inválida aparece dentro del diálogo', () => {
  panels.openSettings();
  $('#seed-input').value = '0';
  $('#btn-seed-go').click();
  assert.equal($('#panel-status').textContent.length > 0, true);
  assert.equal($('#seed-error').hidden, false);
});

test('la cabecera enseña el modo activo localizado', () => {
  assert.match($('#mode-chip').textContent, /Estándar|표준/);
  assert.match($('#mode-chip').textContent, /1|한/);
});
```

- [ ] **Step 2: Run DOM tests and confirm missing elements/translation failures**

Run: `node --test test/dom.test.js`

Expected: FAIL on `#btn-undo`, `#language-select`, `#mode-chip`, and `#panel-status`.

- [ ] **Step 3: Mark all static HTML strings with translation keys**

Add translation attributes for document title/description, scoreboard, toolbar, all dialog headings/buttons/fields/hints, record headers/empty state, help, accessibility labels, titles, and placeholders. Replace the third toolbar control with:

```html
<button id="btn-undo" class="tool" type="button"
  data-i18n-aria-label="toolbar.undoTitle" data-i18n-title="toolbar.undoTitle">
  <svg class="ico" aria-hidden="true"><use href="#i-deshacer"/></svg>
  <span class="rotulo" data-i18n="toolbar.undo">Deshacer</span>
</button>
```

Add a localized mode chip near the scoreboard. Rename only the visible launcher to Menu; section/tab names remain localized equivalents of Settings, Records, and Help.

Add the language select with exactly five options and add the dialog-local status/error nodes.

- [ ] **Step 4: Translate every dynamic string**

Replace literals in `main.js`, `panels.js`, and relevant formatting exports with `t(key, params)`. Native confirm/alert text, PWA status, validation, victory notes, stuck text, record labels/date formatting, draw counts, score mode labels, hint descriptions, and first-run help must all flow through i18n.

Initialize locale before first `refresh()`. On selector change call `game.setPrefs({ language })`, `setLocale(language)`, translate the DOM, rerender settings/stats/header, and clear any active hint. Locale change must not start a new game.

- [ ] **Step 5: Route feedback to the active surface**

Make the shared message function route to `#panel-status` while `#dlg-settings.open`; accept `{ scope: 'board' | 'panel' | 'auto', error, sticky }`. Seed validation also sets `#seed-error`; clear it on valid input/change. Board-state messages such as stuck always force `scope: 'board'`.

- [ ] **Step 6: Wire Undo and remove all Redo presentation**

Bind `#btn-undo` to the existing undo helper, disable it from `game.canUndo`, remove Ctrl+Y/Ctrl+Shift+Z handling and all help/title/copy references to redo. Keep Ctrl/Cmd+Z and `U`.

- [ ] **Step 7: Run i18n, DOM, scoring, and game tests**

Run: `node --test test/i18n.test.js test/dom.test.js test/scoring.test.js test/game.test.js`

Expected: PASS.

- [ ] **Step 8: Commit translated UX integration**

```bash
git add index.html manifest.webmanifest src/main.js src/panels.js src/scoring.js src/game.js test/dom.test.js test/scoring.test.js test/game.test.js
git commit -m "feat: localize the complete interface and add undo"
```

---

### Task 5: Hint Presentation, Shared Tap Destination, and Invalid-Action Feedback

**Files:**
- Modify: `src/ui.js:38-658`
- Modify: `src/main.js:239-275`
- Modify: `src/engine.js`
- Modify: `test/dom.test.js`
- Modify: `test/regresiones.test.js`

**Interfaces:**
- Consumes: Task 3 `game.hint()`/`game.bestMoveFor()` and Task 1 `t`/card naming helpers.
- Produces: `board.showHint(recommendation)`, `board.clearHint()`, and localized rejection reasons.
- Removes: private `mejorDestino()` ranking and timer-per-element `flashHint()` behavior.

- [ ] **Step 1: Write failing tests for a single cancellable hint and invalid actions**

```js
test('solo existe una pista activa y jugar la limpia', () => {
  const first = game.hint();
  board.showHint(first);
  assert.ok(document.querySelectorAll('.hint, .hint-destino').length > 0);
  game.play(first.move);
  assert.equal(document.querySelectorAll('.hint, .hint-destino').length, 0);
});

test('una pista nueva sustituye completamente la anterior', () => {
  board.showHint(game.hint());
  game.draw();
  const next = game.hint();
  board.showHint(next);
  const marked = [...document.querySelectorAll('.hint, .hint-destino')];
  assert.ok(marked.every((el) => el.matches('.slot-stock') || next.move.type === 'move'));
});

test('un arrastre ilegal explica la regla', () => {
  dragKnownCardOntoInvalidTableau();
  assert.match($('#banner').textContent, /alternando|색|alternating/i);
});

test('un mazo agotado explica por qué no puede reciclar', () => {
  escenario({ stock: [], waste: [], tableau: [[{ id: '5H', rank: 5, suit: 'H', faceUp: true }]] });
  const ev = new window.MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  $('.slot-stock').dispatchEvent(ev);
  assert.notEqual($('#banner').textContent, '');
});
```

- [ ] **Step 2: Run focused DOM tests and confirm current stale/silent behavior fails**

Run: `node --test test/dom.test.js test/regresiones.test.js`

Expected: FAIL because `showHint`/`clearHint` do not exist and invalid actions are silent.

- [ ] **Step 3: Replace private destination ranking with the shared advisor**

In `tapCard`, call `game.bestMoveFor(grab.from, grab.count)`. Play only `recommendation.move`. If it returns `null`, use the localized no-destination feedback. Foundation cards still require explicit drag downward.

- [ ] **Step 4: Implement one active hint lifecycle**

Track one hint token, one cleanup timer, and the currently marked elements. `clearHint` removes all classes and cancels the timer. Call it before a new hint, on every game epoch change, pointer-down, cancel, resize, locale change, and new deal. Never let an old timer remove a newer hint.

`showHint` receives the structured recommendation, highlights source/destination, and returns the list of marked elements for tests. Main renders a complete localized sentence and the translated reason.

- [ ] **Step 5: Explain invalid moves and exhausted stock**

Add `engine.moveRejection(state, move)` returning semantic keys for wrong foundation, tableau order/color, empty-column king rule, invalid origin, and generic destination. In `endDrag`, if no legal play occurs, animate rejection and message the translated reason. In `tapSlot`, inspect stock/waste/recycle state and report no cards versus pass limit. Include remaining passes in Vegas when nonzero.

- [ ] **Step 6: Run focused tests**

Run: `node --test test/dom.test.js test/regresiones.test.js test/advisor.test.js`

Expected: PASS.

- [ ] **Step 7: Commit hint and invalid-action UX**

```bash
git add src/ui.js src/main.js src/engine.js test/dom.test.js test/regresiones.test.js
git commit -m "fix: keep hints coherent and explain invalid moves"
```

---

### Task 6: Global Motion System and Animation Performance

**Files:**
- Create: `src/motion.js`
- Modify: `styles.css`
- Modify: `src/ui.js`
- Modify: `src/main.js`
- Modify: `src/panels.js`
- Create: `test/motion.test.js`
- Modify: `test/dom.test.js`

**Interfaces:**
- Produces: `createMotionController({ preference, mediaQuery, root })` with `enabled`, `mode`, `setPreference`, `refreshSystemPreference`, `subscribe`, and `durationForDistance`.
- Consumes: current animation preference and OS reduced-motion media query.
- Sets: `html[data-motion='full'|'reduced'|'off']`.

- [ ] **Step 1: Write failing controller and CSS behavior tests**

```js
// test/motion.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMotionController } from '../src/motion.js';

function fakeMedia(initial) {
  let matches = initial;
  const listeners = new Set();
  return {
    get matches() { return matches; },
    addEventListener(type, fn) { if (type === 'change') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'change') listeners.delete(fn); },
    set(value) {
      matches = value;
      for (const fn of listeners) fn({ matches });
    },
  };
}

test('preferencia y sistema producen un único estado de movimiento', () => {
  const dom = new JSDOM('<html></html>');
  const media = fakeMedia(false);
  const motion = createMotionController({ preference: true, mediaQuery: media, root: dom.window.document.documentElement });
  assert.equal(motion.mode, 'full');
  media.set(true);
  assert.equal(motion.mode, 'reduced');
  motion.setPreference(false);
  assert.equal(motion.mode, 'off');
});

test('la duración aumenta con distancia y queda entre 180 y 320 ms', () => {
  const motion = createMotionController({ preference: true, mediaQuery: fakeMedia(false) });
  assert.equal(motion.durationForDistance(0), 180);
  assert.ok(motion.durationForDistance(120) < motion.durationForDistance(700));
  assert.equal(motion.durationForDistance(5000), 320);
});
```

Add CSS assertions that `.card` has no permanent `will-change`, motion selectors are rooted at `[data-motion="full"]`, reduced/off hints have static outline/box-shadow, and attention animations have finite iterations.

- [ ] **Step 2: Run motion and DOM tests and confirm module/CSS failures**

Run: `node --test test/motion.test.js test/dom.test.js`

Expected: FAIL with missing module and old CSS assertions.

- [ ] **Step 3: Implement the motion controller**

The controller owns the media-query `change` listener, applies the root attribute, and notifies subscribers. `durationForDistance(px)` returns `clamp(180 + px * 0.2, 180, 320)` rounded to an integer; reduced/off returns zero to consumers that request effective duration.

- [ ] **Step 4: Scope every animation and provide static reduced states**

Replace unconditional animation rules with `html[data-motion="full"]` selectors. Give `.hint` and `.hint-destino` permanent distinct rings under reduced/off modes. Use `cubic-bezier(.2,.75,.25,1)` for card movement and `ease-in-out` for flips. Limit finish/update pulses to three iterations. Add subtle dialog/control transitions only in full mode.

- [ ] **Step 5: Use per-flight duration and transient compositor hints**

When a card changes position, compute pixel distance from the prior coordinates, set `--move-duration`, add `.volando`, and schedule its removal using that duration. Apply `will-change` only to `.volando`/`.dragging`. Keep `board.flightMs` as the maximum 320 ms for cascade coordination.

- [ ] **Step 6: Remove stale timers and per-element forced reflows**

Use one cancellation token/timer for hint and rejection feedback. Restart CSS fallback classes with at most one root reflow after removing all affected classes. Prefer `Element.animate()` where supported and cancel the previous animation before starting another. Batch score feedback in `main.js` similarly.

- [ ] **Step 7: Make deal, autocomplete, win, stuck, and confetti consume effective motion**

Pass the motion controller into board/panels. Off/reduced deal settles immediately, autocomplete completes without an 81 ms visual cadence, win/stuck dialogs do not wait 420 ms, and confetti appears only in full mode. A media-query/preference change cancels an in-progress deal and settles the board.

- [ ] **Step 8: Run motion and DOM tests**

Run: `node --test test/motion.test.js test/dom.test.js`

Expected: PASS.

- [ ] **Step 9: Commit motion improvements**

```bash
git add src/motion.js styles.css src/ui.js src/main.js src/panels.js test/motion.test.js test/dom.test.js
git commit -m "feat: unify and polish application motion"
```

---

### Task 7: No-Scroll Responsive Board and 44px Effective Touch Targets

**Files:**
- Modify: `src/ui.js:76-175`
- Modify: `styles.css:199-220`
- Modify: `test/dom.test.js:769-803`

**Interfaces:**
- Produces: exported `MIN_TOUCH_TARGET = 44` and `nearestBoardTarget(x, y)` behavior through board pointer handling.
- Preserves: seven-column geometry and current `COLUMNA` mapping.

- [ ] **Step 1: Write failing narrow/short viewport tests**

```js
let viewportWidth = 1100;
let viewportHeight = 760;
const setViewport = (width, height) => {
  viewportWidth = width;
  viewportHeight = height;
};

test('el tablero cabe sin scroll en 280x320 y 667x280', () => {
  for (const [width, height] of [[280, 320], [320, 480], [667, 280]]) {
    setViewport(width, height);
    board.settle();
    assert.ok($('#board').scrollHeight <= $('#table').clientHeight + 0.5, `${width}x${height}`);
    assert.equal(getComputedStyle($('#table')).overflowY, 'hidden');
  }
});

test('una pulsación dentro del radio de 22 px elige la columna más cercana', () => {
  setViewport(280, 480);
  escenario({
    stock: [{ id: 'AS', rank: 1, suit: 'S', faceUp: false }],
    tableau: [[{ id: '7D', rank: 7, suit: 'D', faceUp: true }],
      [{ id: '7H', rank: 7, suit: 'H', faceUp: true }]],
  });
  board.settle();
  const left = posicion('7D');
  const right = posicion('7H');
  const target = board.targetAt({
    x: (left.x + right.x) / 2 + 2,
    y: right.y + cssVar('--ch') / 2,
  });
  assert.equal(target.id, '7H');
});

test('una columna larga compacta sus pasos y conserva la carta superior dentro del tablero', () => {
  setViewport(667, 280);
  escenario({
    tableau: [[
      { id: 'KC', rank: 13, suit: 'C', faceUp: true },
      { id: 'QH', rank: 12, suit: 'H', faceUp: true },
      { id: 'JS', rank: 11, suit: 'S', faceUp: true },
      { id: '10D', rank: 10, suit: 'D', faceUp: true },
      { id: '9C', rank: 9, suit: 'C', faceUp: true },
      { id: '8H', rank: 8, suit: 'H', faceUp: true },
      { id: '7S', rank: 7, suit: 'S', faceUp: true },
    ]],
  });
  board.settle();
  const cardRect = cartaEl('7S').getBoundingClientRect();
  const hostRect = $('#table').getBoundingClientRect();
  assert.ok(cardRect.bottom <= hostRect.bottom);
});
```

Refactor the DOM test viewport shim so `clientWidth` returns `viewportWidth` and `clientHeight` returns `viewportHeight`, then reset both to 1100 × 760 in `test.afterEach` to prevent cross-test leakage. Reuse the existing `escenario`, `posicion`, `cartaEl`, and `cssVar` helpers shown above.

- [ ] **Step 2: Run the focused layout tests and confirm overflow/target failures**

Run: `node --test --test-name-pattern="tablero cabe sin scroll|radio de 22|columna larga" test/dom.test.js`

Expected: FAIL under current 320 px height floor and DOM-only hit testing.

- [ ] **Step 3: Rework measurement around actual available height**

Pass state into `measure(state)`. Compute width-constrained card size first, then calculate the longest tableau requirement. Reduce down/up steps to fit actual `host.clientHeight`; if required visible strips cannot fit, proportionally reduce card width/height, gap, row gap, and card typography until the maximum column bottom is within the board. Remove `Math.max(320, ...)` and `Math.max(ch * 2.2, ...)` floors that force overflow.

- [ ] **Step 4: Add nearest-center effective hit testing**

When pointer-down lands on empty board space or an overlapping expanded target, consider playable cards/stock/slots whose center lies within a 22 px half-target box and choose the smallest squared distance, breaking ties by visual z-index. Expose `board.targetAt({ x, y })` for deterministic tests. Preserve exact DOM targets when their center is also nearest.

- [ ] **Step 5: Disable table scroll without hiding reachable content**

Set table/board overflow to hidden, remove scroll-specific touch behavior, and keep `touch-action: none` only on the board because all content now fits. Ensure banners/finish controls reserve measured space or overlay without expanding the table.

- [ ] **Step 6: Run all DOM layout/gesture tests**

Run: `node --test test/dom.test.js`

Expected: PASS at existing desktop sizes and new 280/320/landscape cases.

- [ ] **Step 7: Commit responsive layout changes**

```bash
git add src/ui.js styles.css test/dom.test.js
git commit -m "fix: compact the board without scrolling"
```

---

### Task 8: Integrated Regression, Versioning, and GitHub Pages Publication

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/version.js`
- Modify: `sw.js`
- Modify: any tests whose old expectations deliberately conflict with the approved specification

**Interfaces:**
- Consumes: all previous tasks.
- Produces: version `1.5.0`, complete offline precache, clean main branch, and a reachable GitHub Pages release.

- [ ] **Step 1: Search for stale Spanish runtime literals, redo references, and old motion assertions**

Run:

```bash
rg -n "btn-redo|canRedo|\.redo\(|Ctrl\+Y|Rehacer|Ya no hay posibilidad|Toca la carta que parpadea" index.html src test README.md
rg -n "textContent\s*=\s*['\"]|message\(['\"]|confirm\(['\"]|alert\(['\"]" src
```

Expected: no runtime redo references; remaining string literals are translation keys, card symbols, internal errors, or documented/test fixtures with an explicit reason.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: all tests pass with zero failures, cancellations, skips, or todos.

- [ ] **Step 3: Update documentation**

Document the language selector, visible-only hint behavior, Undo toolbar, global animation preference, mode chip, invalid-action feedback, and no-scroll compaction. Update test count only after the final test run.

- [ ] **Step 4: Generate release version and precache**

Run: `npm run version -- 1.5.0`

Expected: output identifies version `1.5.0`, a new build hash, and includes every locale/advisor/motion module in `sw.js`.

- [ ] **Step 5: Re-run release verification**

Run:

```bash
npm test
git diff --check
git status --short
```

Expected: tests pass; diff check is silent; only intended release/documentation files remain uncommitted.

- [ ] **Step 6: Commit the release**

```bash
git add README.md package.json package-lock.json src/version.js sw.js
git add index.html styles.css src test scripts manifest.webmanifest
git commit -m "release: publish solitario 1.5.0"
```

If no code files remain after earlier task commits, Git reports them unchanged; do not create an empty commit.

- [ ] **Step 7: Perform final independent code review and fix every approved finding**

Dispatch a specification-compliance reviewer followed by a code-quality reviewer. For any issue, resume the implementing task agent, add a failing regression when applicable, fix it, rerun affected tests, and repeat review until approved.

- [ ] **Step 8: Merge the isolated implementation branch into local `main`**

From the primary checkout, verify it contains only the approved spec commit, merge the feature branch with `--no-ff`, and run `npm test` once more on `main`.

- [ ] **Step 9: Push and verify GitHub Pages configuration**

Run:

```bash
git push origin main
gh api repos/raulmar0/solitario/pages
```

If Pages is not configured, create it from `main` and `/`:

```bash
gh api -X POST repos/raulmar0/solitario/pages -f 'source[branch]=main' -f 'source[path]=/'
```

- [ ] **Step 10: Wait for deployment and verify the published build**

Poll the Pages deployment/status API at intervals no longer than 60 seconds while reporting progress. Then request `https://raulmar0.github.io/solitario/` and `src/version.js` with cache-busting query parameters. Require HTTP 200 and `VERSION = '1.5.0'`; also verify one locale module and `src/advisor.js` return 200.

- [ ] **Step 11: Report the release**

Provide the commit hash, test count, Pages URL, deployed version, and concise behavior summary. Do not claim deployment if the public URL or version check fails.
