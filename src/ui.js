// Tablero: dibuja las cartas y recoge ratón, dedo y teclado.
// Las 52 cartas son elementos fijos que solo cambian de `transform`,
// así el navegador anima cada movimiento sin que haya que orquestar nada.

import { RANK_LABEL, SUIT_GLYPH, isRed } from './cards.js';
import * as engine from './engine.js';
import { PILE } from './engine.js';

const DRAG_THRESHOLD = 5;     // px antes de considerar que se está arrastrando
const DOUBLE_TAP_MS = 320;

export function createBoard({ root, game, onMessage = () => {} }) {
  const layer = root.querySelector('#cards');
  const slots = [...root.querySelectorAll('.slot')];
  const els = new Map();       // id de carta -> elemento
  let layout = null;
  let drag = null;
  let selection = null;        // { from, count, ids } al jugar tocando
  let lastTap = { id: null, at: 0 };

  // --- creación de las cartas (una sola vez) ---
  for (const suit of ['S', 'H', 'D', 'C']) {
    for (let rank = 1; rank <= 13; rank++) {
      const el = document.createElement('div');
      const label = RANK_LABEL[rank];
      const glyph = SUIT_GLYPH[suit];
      el.className = `card${isRed(suit) ? ' red' : ''}${rank > 10 ? ' court' : ''}`;
      el.dataset.id = `${label}${suit}`;
      el.innerHTML =
        '<div class="back"></div>'
        + '<div class="face">'
        + `<span class="corner tl"><span class="rank">${label}</span><span class="suit">${glyph}</span></span>`
        + `<span class="pip">${rank > 10 ? label : glyph}</span>`
        + `<span class="corner br"><span class="rank">${label}</span><span class="suit">${glyph}</span></span>`
        + '</div>';
      el.setAttribute('aria-hidden', 'true');
      els.set(el.dataset.id, el);
      layer.appendChild(el);
    }
  }

  const slotFor = (pile, index) =>
    slots.find((s) => s.dataset.pile === pile && (index == null || Number(s.dataset.index) === index));

  // --- medidas ---
  function measure() {
    const host = root.parentElement;
    const availW = Math.max(280, host.clientWidth - 8);
    const availH = Math.max(320, host.clientHeight - 30);

    const gap = Math.max(5, Math.min(13, availW * 0.013));
    let cw = Math.min((availW - 6 * gap) / 7, 104);
    let ch = cw * 1.4;
    const rowGap = Math.max(9, ch * 0.13);
    // Reservamos sitio para una columna razonablemente larga; si no cabe, se encogen las cartas.
    const needed = ch + rowGap + ch + 6.5 * (ch * 0.24);
    if (needed > availH) {
      cw = Math.max(40, cw * (availH / needed));
      ch = cw * 1.4;
    }
    return { cw, ch, gap, rowGap: Math.max(9, ch * 0.13), tableauY: ch + Math.max(9, ch * 0.13) };
  }

  const colX = (i, m) => i * (m.cw + m.gap);

  /** Dónde va cada carta y cuáles se pueden coger. */
  function computeLayout(state) {
    const m = measure();
    // Atascado es solo un aviso: se sigue pudiendo coger cartas (bajar una de la
    // fundación al tableau suele ser justo lo que desatasca la partida).
    const enJuego = game.status === 'playing' || game.status === 'stuck';
    const positions = new Map();
    const columns = [];
    let z = 0;

    const stockX = colX(0, m);
    state.stock.forEach((card, i) => {
      positions.set(card.id, {
        x: stockX, y: Math.min(i, 6) * 0.6, z: z++, faceUp: false, playable: false,
      });
    });

    const wasteX = colX(1, m);
    const visible = Math.min(state.drawCount === 3 ? 3 : 1, state.waste.length);
    const wasteFan = Math.min(m.cw * 0.3, m.gap + m.cw * 0.24);
    state.waste.forEach((card, i) => {
      const fromTop = state.waste.length - 1 - i;
      const slotIdx = Math.max(0, visible - 1 - fromTop);
      positions.set(card.id, {
        x: wasteX + slotIdx * wasteFan,
        y: 0,
        z: z++,
        faceUp: true,
        playable: fromTop === 0 && enJuego,
        from: { pile: PILE.WASTE },
      });
    });

    state.foundations.forEach((pile, index) => {
      const x = colX(3 + index, m);
      pile.forEach((card, i) => {
        positions.set(card.id, {
          x, y: 0, z: z++, faceUp: true,
          playable: i === pile.length - 1 && enJuego,
          from: { pile: PILE.FOUNDATION, index },
        });
      });
    });

    state.tableau.forEach((pile, index) => {
      const x = colX(index, m);
      const downs = pile.filter((c) => !c.faceUp).length;
      const ups = pile.length - downs;
      let stepDown = m.ch * 0.1;
      let stepUp = m.ch * 0.24;
      const room = Math.max(m.ch * 2.2, root.clientHeight - m.tableauY);
      const needed = m.ch + downs * stepDown + Math.max(0, ups - 1) * stepUp;
      if (needed > room && needed > m.ch) {
        const k = (room - m.ch) / (needed - m.ch);
        stepDown *= k;
        stepUp *= k;
      }

      let y = m.tableauY;
      let firstUp = -1;
      pile.forEach((card, i) => {
        if (i > 0) y += pile[i - 1].faceUp ? stepUp : stepDown;
        if (card.faceUp && firstUp < 0) firstUp = i;
        positions.set(card.id, {
          x, y, z: z++, faceUp: card.faceUp,
          playable: card.faceUp && enJuego && engine.isValidRun(pile, i),
          from: { pile: PILE.TABLEAU, index },
          offset: i,
        });
      });
      columns.push({ index, x, top: m.tableauY, bottom: y + m.ch });
    });

    return { m, positions, columns };
  }

  function paint() {
    const state = game.state;
    if (!state) return;
    if (selection && !sigueValida(selection)) { selection = null; clearHighlights(); }
    layout = computeLayout(state);
    const { m, positions } = layout;

    const style = document.documentElement.style;
    style.setProperty('--cw', `${m.cw}px`);
    style.setProperty('--ch', `${m.ch}px`);
    style.setProperty('--gap', `${m.gap}px`);

    for (const slot of slots) {
      const pile = slot.dataset.pile;
      const index = Number(slot.dataset.index || 0);
      const x = pile === 'stock' ? colX(0, m)
        : pile === 'waste' ? colX(1, m)
          : pile === 'foundation' ? colX(3 + index, m)
            : colX(index, m);
      const y = pile === 'tableau' ? m.tableauY : 0;
      slot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }

    const stock = slotFor('stock');
    stock.classList.toggle('empty', state.stock.length === 0);
    stock.classList.toggle('dead', state.stock.length === 0 && !engine.isLegal(state, { type: 'recycle' }));

    for (const [id, el] of els) {
      const p = positions.get(id);
      if (!p) { el.style.visibility = 'hidden'; continue; }
      el.style.visibility = '';
      if (!drag || !drag.ids.includes(id)) {
        el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
        el.style.zIndex = String(p.z);
      }
      el.classList.toggle('down', !p.faceUp);
      el.classList.toggle('playable', !!p.playable);
      el.classList.toggle('picked', !!selection && selection.ids.includes(id));
      if (!drag || !drag.ids.includes(id)) el.classList.remove('dragging');
    }

    root.style.minHeight = `${Math.max(...layout.columns.map((c) => c.bottom), m.ch)}px`;
  }

  // --- zonas donde se puede soltar ---
  function dropZones() {
    const rect = root.getBoundingClientRect();
    const { m, columns } = layout;
    const zones = [];
    for (let i = 0; i < 4; i++) {
      zones.push({
        to: { pile: PILE.FOUNDATION, index: i },
        left: rect.left + colX(3 + i, m), top: rect.top,
        right: rect.left + colX(3 + i, m) + m.cw, bottom: rect.top + m.ch,
      });
    }
    for (const c of columns) {
      zones.push({
        to: { pile: PILE.TABLEAU, index: c.index },
        left: rect.left + c.x, top: rect.top + c.top,
        right: rect.left + c.x + m.cw, bottom: rect.top + Math.max(c.bottom, c.top + m.ch),
      });
    }
    return zones;
  }

  const overlap = (a, z) => {
    const w = Math.min(a.right, z.right) - Math.max(a.left, z.left);
    const h = Math.min(a.bottom, z.bottom) - Math.max(a.top, z.top);
    return w > 0 && h > 0 ? w * h : 0;
  };

  function bestZone(cardRect) {
    let best = null;
    for (const z of dropZones()) {
      const area = overlap(cardRect, z);
      if (area > 0 && (!best || area > best.area)) best = { zone: z, area };
    }
    return best?.zone ?? null;
  }

  // --- coger cartas ---
  function grabbable(id) {
    const p = layout?.positions.get(id);
    if (!p || !p.playable || !p.from) return null;
    if (p.from.pile === PILE.TABLEAU) {
      const pile = game.state.tableau[p.from.index];
      return { from: p.from, count: pile.length - p.offset };
    }
    return { from: p.from, count: 1 };
  }

  function pileOf(from) {
    if (!from) return null;
    if (from.pile === PILE.WASTE) return game.state.waste;
    if (from.pile === PILE.FOUNDATION) return game.state.foundations[from.index];
    if (from.pile === PILE.TABLEAU) return game.state.tableau[from.index];
    return null;
  }

  function idsOf(grab) {
    const pile = pileOf(grab.from);
    if (!pile || grab.count > pile.length) return [];
    return pile.slice(pile.length - grab.count).map((c) => c.id);
  }

  /**
   * ¿Las cartas anotadas siguen siendo las de arriba de su pila? Entre que se cogen
   * y se sueltan pueden haber cambiado (otro dedo, el teclado, deshacer, autoSafe),
   * y jugar con la referencia vieja movería una carta distinta a la que se ve.
   */
  function sigueValida(ref) {
    if (!ref?.ids?.length) return false;
    const ahora = idsOf(ref);
    return ahora.length === ref.ids.length && ahora.every((id, i) => id === ref.ids[i]);
  }

  function highlightTargets(grab) {
    for (const slot of slots) {
      const pile = slot.dataset.pile;
      if (pile !== 'tableau' && pile !== 'foundation') continue;
      const to = { pile, index: Number(slot.dataset.index) };
      const legal = engine.isLegal(game.state, { type: 'move', from: grab.from, to, count: grab.count });
      slot.classList.toggle('drop-ok', legal);
    }
  }

  const clearHighlights = () => slots.forEach((s) => s.classList.remove('drop-ok'));

  function startDrag(event, id, grab) {
    const ids = idsOf(grab);
    if (!ids.length) return;
    grab.ids = ids;
    drag = {
      ids, grab, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      bases: ids.map((cid) => {
        const p = layout.positions.get(cid);
        return { id: cid, x: p.x, y: p.y };
      }),
      moved: false, id,
    };
    ids.forEach((cid, i) => {
      const el = els.get(cid);
      el.classList.add('dragging');
      el.style.zIndex = String(900 + i);
    });
    highlightTargets(grab);
  }

  function moveDrag(event) {
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    for (const base of drag.bases) {
      els.get(base.id).style.transform = `translate3d(${base.x + dx}px, ${base.y + dy}px, 0)`;
    }
  }

  /** Se suelta fuera, el sistema se queda el puntero o llega otro dedo: no se juega nada. */
  function cancelDrag() {
    if (!drag) return;
    drag.ids.forEach((cid) => els.get(cid)?.classList.remove('dragging'));
    clearHighlights();
    drag = null;
    paint();
  }

  function endDrag(event) {
    const { ids, grab, moved, id } = drag;
    ids.forEach((cid) => els.get(cid).classList.remove('dragging'));
    clearHighlights();
    drag = null;

    if (!moved) { tapCard(id, grab); paint(); return; }

    if (!sigueValida(grab)) { paint(); return; }   // el tablero cambió mientras arrastrábamos

    const rect = els.get(ids[0]).getBoundingClientRect();
    const zone = bestZone({
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    }) ?? bestZone({
      left: event.clientX - 1, top: event.clientY - 1, right: event.clientX + 1, bottom: event.clientY + 1,
    });

    selection = null;
    if (zone) {
      const move = { type: 'move', from: grab.from, to: zone.to, count: grab.count };
      const subeCarta = grab.count === 1 && grab.from.pile !== PILE.FOUNDATION;
      if (!game.play(move) && subeCarta && zone.to.pile === PILE.FOUNDATION) {
        game.sendToFoundation(grab.from, ids[0]);   // soltó sobre la fundación equivocada: probamos la suya
      }
    }
    paint();
  }

  /** Toque simple: seleccionar, mover a lo seleccionado, o subir si es doble toque. */
  function tapCard(id, grab) {
    const now = Date.now();
    if (lastTap.id === id && now - lastTap.at < DOUBLE_TAP_MS) {
      lastTap = { id: null, at: 0 };
      selection = null;
      if (!grab || grab.from.pile === PILE.FOUNDATION) return;   // de las fundaciones no se sube nada
      if (!game.sendToFoundation(grab.from, id)) {
        onMessage(grab.count > 1
          ? 'Solo puede subir la carta de arriba de la columna.'
          : 'Esa carta todavía no puede subir.');
      }
      return;
    }
    lastTap = { id, at: now };

    const p = layout.positions.get(id);
    if (selection && !sigueValida(selection)) selection = null;
    if (selection) {
      const to = p?.from;
      if (to && (to.pile === PILE.TABLEAU || to.pile === PILE.FOUNDATION)) {
        const move = { type: 'move', from: selection.from, to: { pile: to.pile, index: to.index }, count: selection.count };
        if (game.play(move)) { selection = null; return; }
      }
      const mismo = selection.ids.includes(id);
      selection = null;
      if (mismo) return;
    }
    if (grab) {
      const ref = { ...grab, ids: grab.ids ?? idsOf(grab) };
      if (!sigueValida(ref)) return;      // el tablero cambió entre el toque y el dedo levantado
      selection = ref;
      highlightTargets(grab);
      setTimeout(clearHighlights, 900);
    }
  }

  function tapSlot(slot) {
    const pile = slot.dataset.pile;
    if (pile === 'stock') {
      const habia = selection;
      selection = null;
      if (!game.stockClick() && habia) paint();   // el mazo no responde: al menos suelta lo marcado
      return;
    }
    if (selection && !sigueValida(selection)) selection = null;
    if (!selection) return;
    const to = { pile, index: Number(slot.dataset.index || 0) };
    if (pile === 'waste') { selection = null; paint(); return; }
    game.play({ type: 'move', from: selection.from, to, count: selection.count });
    selection = null;
    paint();
  }

  // --- eventos ---
  root.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    if (drag) { cancelDrag(); return; }     // un segundo dedo cancela, no juega dos veces
    if (game.status !== 'playing' && game.status !== 'stuck') return;
    const cardEl = event.target.closest('.card');
    if (cardEl) {
      const id = cardEl.dataset.id;
      const grab = grabbable(id);
      if (!grab) {
        // Carta tapada del tableau o del mazo: solo cuenta si es el mazo.
        const p = layout?.positions.get(id);
        if (p && !p.from) {
          const habia = selection;
          selection = null;
          if (!game.stockClick() && habia) paint();
        }
        return;
      }
      event.preventDefault();
      root.setPointerCapture?.(event.pointerId);
      startDrag(event, id, grab);
      return;
    }
    const slot = event.target.closest('.slot');
    if (slot) { event.preventDefault(); tapSlot(slot); }
  });

  root.addEventListener('pointermove', (event) => {
    if (drag && event.pointerId === drag.pointerId) moveDrag(event);
  });

  root.addEventListener('pointerup', (event) => {
    if (drag && event.pointerId === drag.pointerId) endDrag(event);
  });
  const cancelar = (event) => { if (drag && event.pointerId === drag.pointerId) cancelDrag(); };
  root.addEventListener('pointercancel', cancelar);
  root.addEventListener('lostpointercapture', cancelar);
  window.addEventListener('blur', cancelDrag);
  root.addEventListener('contextmenu', (event) => { if (drag) event.preventDefault(); });
  root.addEventListener('dblclick', (event) => event.preventDefault());

  // --- api ---
  const api = {
    paint,
    clearSelection() { selection = null; cancelDrag(); clearHighlights(); paint(); },
    /** Marca la jugada sugerida para que se vea de un vistazo. */
    flashHint(move) {
      if (!move) return;
      const marcar = (el) => {
        if (!el) return;
        el.classList.remove('hint');
        void el.offsetWidth;      // reinicia la animación
        el.classList.add('hint');
        setTimeout(() => el.classList.remove('hint'), 2000);
      };
      if (move.type === 'draw' || move.type === 'recycle') { marcar(slotFor('stock')); return; }
      for (const id of idsOf({ from: move.from, count: move.count ?? 1 })) marcar(els.get(id));
      if (move.to.pile !== PILE.FOUNDATION && move.to.pile !== PILE.TABLEAU) return;
      const destino = move.to.pile === PILE.FOUNDATION
        ? slotFor('foundation', move.to.index)
        : slotFor('tableau', move.to.index);
      if (destino && (move.to.pile === PILE.FOUNDATION ? game.state.foundations[move.to.index].length === 0
        : game.state.tableau[move.to.index].length === 0)) marcar(destino);
      else {
        const pila = move.to.pile === PILE.FOUNDATION ? game.state.foundations[move.to.index] : game.state.tableau[move.to.index];
        marcar(els.get(engine.top(pila)?.id));
      }
    },
  };

  const repaint = () => paint();
  window.addEventListener('resize', repaint);
  window.addEventListener('orientationchange', repaint);
  return api;
}
