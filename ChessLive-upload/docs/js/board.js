// Board component: renders the position, handles click and drag moves,
// shows legal-move hints, last move, check, and the promotion picker.

const FILES = "abcdefgh";

export function pieceSvg(color, type) {
  // color: 'w' | 'b', type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><use href="#${color}${type}"/></svg>`;
}

function parseFen(fen) {
  const map = new Map();
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      const color = ch === ch.toUpperCase() ? "w" : "b";
      map.set(FILES[f] + (8 - r), color + ch.toLowerCase());
      f++;
    }
  });
  return map;
}

export class Board {
  /**
   * @param {HTMLElement} frame
   * @param {object} opts
   *  - getMoves(square): verbose legal moves from that square (only called when interactive)
   *  - onMove({from, to, promotion}): called when the user makes a move
   */
  constructor(frame, opts = {}) {
    this.frame = frame;
    this.opts = opts;
    this.orientation = "w";
    this.movableColor = null; // which color the user may move right now
    this.position = new Map();
    this.pieceEls = new Map(); // square -> element
    this.selected = null;
    this.targets = [];
    this.drag = null;
    this.lastMove = null;
    this.checkSquare = null;

    this.root = document.createElement("div");
    this.root.className = "board";
    this.squaresEl = document.createElement("div");
    this.squaresEl.className = "squares";
    this.piecesEl = document.createElement("div");
    this.piecesEl.className = "pieces";
    this.root.append(this.squaresEl, this.piecesEl);
    frame.append(this.root);

    this.buildSquares();
    this.bindPointer();
  }

  // ---------- geometry ----------
  squareAt(index) {
    // index 0..63 in display order (top-left first)
    const r = Math.floor(index / 8), c = index % 8;
    if (this.orientation === "w") return FILES[c] + (8 - r);
    return FILES[7 - c] + (r + 1);
  }
  coordsOf(square) {
    const f = FILES.indexOf(square[0]), rank = Number(square[1]);
    if (this.orientation === "w") return { x: f, y: 8 - rank };
    return { x: 7 - f, y: rank - 1 };
  }
  squareFromPoint(clientX, clientY) {
    const rect = this.root.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const y = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return this.squareAt(y * 8 + x);
  }

  buildSquares() {
    this.squaresEl.innerHTML = "";
    this.sqEls = new Map();
    for (let i = 0; i < 64; i++) {
      const sq = this.squareAt(i);
      const el = document.createElement("div");
      const f = FILES.indexOf(sq[0]), rank = Number(sq[1]);
      el.className = "sq " + ((f + rank) % 2 === 0 ? "light" : "dark");
      el.dataset.square = sq;
      const r = Math.floor(i / 8), c = i % 8;
      if (c === 0) el.insertAdjacentHTML("beforeend", `<span class="coord rank">${sq[1]}</span>`);
      if (r === 7) el.insertAdjacentHTML("beforeend", `<span class="coord file">${sq[0]}</span>`);
      this.squaresEl.append(el);
      this.sqEls.set(sq, el);
    }
    this.paintMarks();
  }

  placeEl(el, square) {
    const { x, y } = this.coordsOf(square);
    el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
  }

  // ---------- public API ----------
  setOrientation(color) {
    if (color === this.orientation) return;
    this.orientation = color;
    this.buildSquares();
    for (const [sq, el] of this.pieceEls) {
      el.style.transition = "none";
      this.placeEl(el, sq);
      el.offsetWidth; // flush
      el.style.transition = "";
    }
  }

  setMovable(color) {
    this.movableColor = color;
    this.root.classList.toggle("can-move", !!color);
    if (!color) this.clearSelection();
  }

  setPosition(fen, { lastMove = null, check = null, animate = true } = {}) {
    this.closePromotion();
    this.lastMove = lastMove;
    this.checkSquare = check;
    const next = parseFen(fen);
    const oldEls = new Map(this.pieceEls);
    const newEls = new Map();

    // 1) keep pieces that did not move
    for (const [sq, p] of next) {
      const el = oldEls.get(sq);
      if (el && el.dataset.piece === p) {
        newEls.set(sq, el);
        oldEls.delete(sq);
      }
    }
    // 2) match moved pieces to the nearest leftover element of the same kind
    const pending = [...next].filter(([sq]) => !newEls.has(sq));
    for (const [sq, p] of pending) {
      let best = null, bestDist = Infinity;
      const to = this.coordsOf(sq);
      for (const [osq, el] of oldEls) {
        if (el.dataset.piece !== p) continue;
        const from = this.coordsOf(osq);
        const d = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
        if (d < bestDist) { best = osq; bestDist = d; }
      }
      let el;
      if (best && animate) {
        el = oldEls.get(best);
        oldEls.delete(best);
      } else {
        el = document.createElement("div");
        el.className = "piece";
        el.dataset.piece = p;
        el.innerHTML = pieceSvg(p[0], p[1]);
        el.style.transition = "none";
        this.placeEl(el, sq);
        this.piecesEl.append(el);
        el.offsetWidth;
        el.style.transition = "";
      }
      this.placeEl(el, sq);
      newEls.set(sq, el);
    }
    // 3) remove captured pieces
    for (const el of oldEls.values()) {
      if (animate) {
        el.classList.add("fading");
        setTimeout(() => el.remove(), 160);
      } else el.remove();
    }
    this.pieceEls = newEls;
    this.position = next;
    this.clearSelection();
  }

  // ---------- marks ----------
  paintMarks() {
    if (!this.sqEls) return;
    for (const [sq, el] of this.sqEls) {
      el.classList.toggle("last", !!this.lastMove && (sq === this.lastMove.from || sq === this.lastMove.to));
      el.classList.toggle("sel", sq === this.selected);
      el.classList.toggle("check", sq === this.checkSquare);
      el.querySelector(".hint")?.remove();
    }
    for (const t of this.targets) {
      const el = this.sqEls.get(t.to);
      if (!el || el.querySelector(".hint")) continue;
      const h = document.createElement("span");
      h.className = "hint" + (t.captured ? " capture" : "");
      el.append(h);
    }
  }

  select(square) {
    this.selected = square;
    this.targets = this.opts.getMoves ? this.opts.getMoves(square) : [];
    this.paintMarks();
  }
  clearSelection() {
    this.selected = null;
    this.targets = [];
    this.paintMarks();
  }

  ownPieceAt(square) {
    const p = this.position.get(square);
    return p && p[0] === this.movableColor;
  }

  tryMove(from, to) {
    const options = this.targets.filter((m) => m.from === from && m.to === to);
    if (!options.length) return false;
    this.clearSelection();
    if (options.some((m) => m.promotion)) {
      this.openPromotion(from, to);
    } else {
      this.opts.onMove?.({ from, to });
    }
    return true;
  }

  // ---------- promotion ----------
  openPromotion(from, to) {
    this.closePromotion();
    const color = this.position.get(from)?.[0] || this.movableColor;
    const { x, y } = this.coordsOf(to);
    const overlay = document.createElement("div");
    overlay.className = "promo";
    const col = document.createElement("div");
    col.className = "promo-col" + (y === 0 ? "" : " from-bottom");
    col.style.left = `${x * 12.5}%`;
    col.style[y === 0 ? "top" : "bottom"] = "0";
    for (const t of ["q", "n", "r", "b"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", { q: "Queen", n: "Knight", r: "Rook", b: "Bishop" }[t]);
      b.innerHTML = pieceSvg(color, t);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closePromotion();
        this.opts.onMove?.({ from, to, promotion: t });
      });
      col.append(b);
    }
    overlay.append(col);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) { e.stopPropagation(); this.closePromotion(); }
    });
    this.root.append(overlay);
    this.promoEl = overlay;
    col.querySelector("button").focus();
  }
  closePromotion() {
    if (!this.promoEl) return;
    this.promoEl.remove();
    this.promoEl = null;
    // If the promotion was cancelled, put any dragged pawn back where it belongs.
    for (const [sq, el] of this.pieceEls) this.placeEl(el, sq);
  }

  // ---------- pointer input ----------
  bindPointer() {
    const root = this.root;

    root.addEventListener("pointerdown", (e) => {
      if (!this.movableColor || this.promoEl) return;
      if (e.button !== undefined && e.button !== 0) return;
      const sq = this.squareFromPoint(e.clientX, e.clientY);
      if (!sq) return;

      // Clicking a highlighted target completes the move.
      if (this.selected && sq !== this.selected && this.targets.some((t) => t.to === sq) && !this.ownPieceAt(sq)) {
        this.tryMove(this.selected, sq);
        return;
      }
      if (!this.ownPieceAt(sq)) {
        this.clearSelection();
        return;
      }
      e.preventDefault();
      const wasSelected = this.selected === sq;
      this.select(sq);
      const el = this.pieceEls.get(sq);
      if (!el) return;
      const rect = root.getBoundingClientRect();
      this.drag = { from: sq, el, rect, wasSelected, moved: false, startX: e.clientX, startY: e.clientY, hover: null };
      root.setPointerCapture?.(e.pointerId);
    });

    root.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
      d.moved = true;
      d.el.classList.add("dragging");
      const size = d.rect.width / 8;
      const x = e.clientX - d.rect.left - size / 2;
      const y = e.clientY - d.rect.top - size / 2;
      d.el.style.transform = `translate(${x}px, ${y}px)`;
      const over = this.squareFromPoint(e.clientX, e.clientY);
      if (over !== d.hover) {
        if (d.hover) this.sqEls.get(d.hover)?.classList.remove("hover");
        d.hover = over;
        if (over && this.targets.some((t) => t.to === over)) this.sqEls.get(over)?.classList.add("hover");
      }
    });

    const finish = (e) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (d.hover) this.sqEls.get(d.hover)?.classList.remove("hover");
      d.el.classList.remove("dragging");
      const to = e.type === "pointercancel" ? null : this.squareFromPoint(e.clientX, e.clientY);

      if (d.moved) {
        if (to && to !== d.from && this.tryMove(d.from, to)) {
          // Move accepted: snap the dragged piece onto its target without sliding back first.
          d.el.style.transition = "none";
          this.placeEl(d.el, to);
          d.el.offsetWidth;
          d.el.style.transition = "";
          return;
        }
        this.placeEl(d.el, d.from); // snap back
        return;
      }
      // Plain click on a piece that was already selected toggles it off.
      if (d.wasSelected) this.clearSelection();
    };
    root.addEventListener("pointerup", finish);
    root.addEventListener("pointercancel", finish);
  }
}
