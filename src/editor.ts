import * as M from './model';
import type { DropMode, MindMap, NodeType } from './model';
import { type Box, boundsOf, displayText, layoutMap } from './layout';
import { applyParsed, parseOutline } from './outline';
import { shareDialog } from './panels';

const NS = 'http://www.w3.org/2000/svg';
const HUES = [210, 150, 28, 280, 350, 180, 52, 320];
const DRAG_THRESHOLD = 5; // px
const LONG_PRESS_MS = 380;
const DOUBLE_TAP_MS = 350;
const MIN_K = 0.15;
const MAX_K = 3;

type Target =
  | { kind: 'node'; id: string; mode: DropMode }
  | { kind: 'free' }
  | null;

interface DragState {
  id: string;
  /** Versatz Zeiger → Knotenmitte (Weltkoordinaten) beim Start */
  ox: number;
  oy: number;
  wx: number;
  wy: number;
  target: Target;
  dim: Set<string>;
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | {
      kind: 'node';
      nodeId: string;
      chk: boolean;
      sx: number;
      sy: number;
      touch: boolean;
      timer: number | null;
      moved: boolean;
    }
  | { kind: 'drag' }
  | { kind: 'pinch'; d0: number; k0: number; w0x: number; w0y: number };

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export class Editor {
  private map: MindMap;
  private sel: string | null = null;
  private view = { x: 0, y: 0, k: 1 };
  private boxes: Record<string, Box> = {};
  private done: Record<string, boolean | null> = {};
  private undoStack: MindMap[] = [];
  private redoStack: MindMap[] = [];

  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private drag: DragState | null = null;
  private lastTap: { id: string; t: number } | null = null;
  private editing: { id: string; finish: (commit: boolean) => void } | null = null;
  private saveTimer: number | null = null;

  private root: HTMLElement;
  private svgEl!: SVGSVGElement;
  private world!: SVGGElement;
  private gEdges!: SVGGElement;
  private gNodes!: SVGGElement;
  private gOverlay!: SVGGElement;
  private input!: HTMLInputElement;
  private empty!: HTMLElement;
  private toolbar!: HTMLElement;
  private cleanup: Array<() => void> = [];

  constructor(
    host: HTMLElement,
    map: MindMap,
    private onSave: (map: MindMap) => void,
    private onBack: () => void,
  ) {
    this.map = map;
    this.root = host;
    this.build();
    this.render();
    requestAnimationFrame(() => this.fit());
  }

  // ───────────────────────── Aufbau ─────────────────────────

  private build() {
    this.root.innerHTML = `
      <header class="topbar">
        <button class="btn icon" data-act="back" title="Zur Liste" aria-label="Zur Liste">←</button>
        <input class="title" aria-label="Titel" maxlength="80">
        <button class="btn icon" data-act="undo" title="Rückgängig (Strg+Z)" aria-label="Rückgängig">↶</button>
        <button class="btn icon" data-act="redo" title="Wiederholen (Strg+Y)" aria-label="Wiederholen">↷</button>
        <button class="btn" data-act="layout" title="Layout wechseln"></button>
        <button class="btn icon" data-act="fit" title="Alles anzeigen" aria-label="Alles anzeigen">⤢</button>
        <button class="btn icon" data-act="export" title="Export &amp; KI" aria-label="Export und KI">⇅</button>
      </header>
      <div class="stage">
        <svg class="canvas" xmlns="${NS}">
          <g class="world"><g class="edges"></g><g class="nodes"></g><g class="overlay"></g></g>
        </svg>
        <input class="inline-edit" hidden maxlength="300" aria-label="Knotentext">
        <div class="empty" hidden>Noch keine Knoten.<br>Tippe auf „＋ Freier Knoten“.</div>
        <button class="fab" data-act="free" title="Freien Knoten anlegen">＋ Freier Knoten</button>
      </div>
      <footer class="toolbar">
        <button class="btn" data-act="sibling">＋ Geschwister</button>
        <button class="btn" data-act="child">＋ Unterknoten</button>
        <div class="seg" role="group" aria-label="Knotentyp">
          <button class="btn" data-type="none" title="Kein Typ">Kein</button>
          <button class="btn" data-type="checkbox" title="Aufgabe mit Haken">☑ Aufgabe</button>
          <button class="btn" data-type="info" title="Info (zählt als erledigt)">ⓘ Info</button>
        </div>
        <button class="btn" data-act="edit">✎ Text</button>
        <button class="btn" data-act="detach" title="Vom Elternknoten lösen (freier Knoten)">⛓ Lösen</button>
        <button class="btn danger" data-act="delete">🗑 Löschen</button>
      </footer>`;
    const q = <T extends Element>(s: string) => this.root.querySelector(s) as T;
    this.svgEl = q<SVGSVGElement>('svg.canvas');
    this.world = q<SVGGElement>('g.world');
    this.gEdges = q<SVGGElement>('g.edges');
    this.gNodes = q<SVGGElement>('g.nodes');
    this.gOverlay = q<SVGGElement>('g.overlay');
    this.input = q<HTMLInputElement>('input.inline-edit');
    this.empty = q<HTMLElement>('.empty');
    this.toolbar = q<HTMLElement>('footer.toolbar');

    const title = q<HTMLInputElement>('input.title');
    title.value = this.map.title;
    title.addEventListener('input', () => {
      this.map.title = title.value;
      this.scheduleSave();
    });

    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b || b.disabled) return;
      if (b.dataset.type) return this.setSelType(b.dataset.type as NodeType);
      switch (b.dataset.act) {
        case 'back': return this.onBack();
        case 'undo': return this.undo();
        case 'redo': return this.redo();
        case 'fit': return this.fit();
        case 'export': return shareDialog(() => this.map, (t) => this.applyOutlineText(t));
        case 'layout':
          return this.commit((m) => (m.layout = m.layout === 'radial' ? 'tree' : 'radial'), true);
        case 'free': return this.addFreeNode();
        case 'sibling': return this.addSiblingNode();
        case 'child': return this.addChildNode();
        case 'edit': return this.sel && this.startEdit(this.sel);
        case 'detach': return this.detachSel();
        case 'delete': return this.deleteSel();
      }
    });

    const s = this.svgEl;
    s.addEventListener('pointerdown', this.onDown);
    s.addEventListener('pointermove', this.onMove);
    s.addEventListener('pointerup', this.onUp);
    s.addEventListener('pointercancel', this.onUp);
    s.addEventListener('wheel', this.onWheel, { passive: false });
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    document.addEventListener('keydown', onKey);
    const onHide = () => document.visibilityState === 'hidden' && this.flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    this.cleanup.push(
      () => document.removeEventListener('keydown', onKey),
      () => document.removeEventListener('visibilitychange', onHide),
      () => window.removeEventListener('pagehide', onHide),
    );
  }

  destroy() {
    this.editing?.finish(true);
    this.flush();
    this.cleanup.forEach((f) => f());
    this.root.innerHTML = '';
  }

  // ───────────────────────── Daten / Undo ─────────────────────────

  private commit(fn: (m: MindMap) => void, refit = false) {
    this.undoStack.push(M.cloneMap(this.map));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    fn(this.map);
    this.afterChange();
    if (refit) this.fit();
  }

  private afterChange() {
    this.map.updatedAt = Date.now();
    if (this.sel && !this.map.nodes[this.sel]) this.sel = null;
    this.render();
    this.scheduleSave();
  }

  private undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(M.cloneMap(this.map));
    this.map = prev;
    this.afterChange();
  }

  private redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(M.cloneMap(this.map));
    this.map = next;
    this.afterChange();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 300);
  }

  private flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.onSave(this.map);
  }

  // ───────────────────────── Aktionen ─────────────────────────

  private addChildNode() {
    if (!this.sel) return;
    let id = '';
    this.commit((m) => (id = M.addChild(m, this.sel!)));
    this.sel = id;
    this.render();
    this.startEdit(id);
  }

  private addSiblingNode() {
    if (!this.sel) return;
    const wasRoot = this.map.nodes[this.sel].parent === null;
    if (wasRoot) return this.addChildNode(); // Wurzeln: Enter legt ein Kind an
    let id = '';
    this.commit((m) => (id = M.addSibling(m, this.sel!)));
    this.sel = id;
    this.render();
    this.startEdit(id);
  }

  private addFreeNode() {
    const c = this.screenToWorld(this.svgEl.clientWidth / 2, this.svgEl.clientHeight / 2);
    let id = '';
    this.commit((m) => (id = M.addFree(m, c.x, c.y)));
    this.sel = id;
    this.render();
    this.startEdit(id);
  }

  private deleteSel() {
    const id = this.sel;
    if (!id) return;
    const count = M.subtreeIds(this.map, id).length;
    if (count > 1 && !confirm(`Knoten mit ${count - 1} Unterknoten löschen?`)) return;
    this.sel = null;
    this.commit((m) => M.deleteNode(m, id));
  }

  private detachSel() {
    const id = this.sel;
    if (!id || this.map.nodes[id].parent === null) return;
    const b = this.boxes[id];
    this.commit((m) => M.detachToFree(m, id, b.x + 40, b.y + 70));
  }

  private setSelType(t: NodeType) {
    if (this.sel && this.map.nodes[this.sel].type !== t) {
      const id = this.sel;
      this.commit((m) => M.setType(m, id, t));
    }
  }

  /** Ersetzt den Inhalt der Mindmap durch eine Gliederung (z. B. Antwort einer KI). */
  private applyOutlineText(text: string) {
    const parsed = parseOutline(text);
    this.sel = null;
    this.commit((m) => applyParsed(m, parsed), true);
    const t = this.root.querySelector<HTMLInputElement>('input.title');
    if (t) t.value = this.map.title;
  }

  // ───────────────────────── Zeichnen ─────────────────────────

  private render() {
    this.boxes = layoutMap(this.map);
    this.done = M.computeDone(this.map);
    this.gEdges.replaceChildren();
    this.gNodes.replaceChildren();
    this.gOverlay.replaceChildren();

    const dim = this.drag?.dim;
    for (const id of Object.keys(this.map.nodes)) {
      const n = this.map.nodes[id];
      if (n.parent) this.drawEdge(n.parent, id, dim?.has(id) ?? false);
    }
    for (const id of Object.keys(this.map.nodes)) this.drawNode(id, dim?.has(id) ?? false);
    this.applyView();
    this.updateToolbar();
    if (this.drag) this.drawOverlay();
  }

  private hue(b: Box): number | null {
    return b.branch < 0 ? null : HUES[b.branch % HUES.length];
  }

  private drawEdge(pid: string, cid: string, dim: boolean) {
    const p = this.boxes[pid];
    const c = this.boxes[cid];
    const h = this.hue(c);
    const color = h === null ? 'var(--edge)' : `hsl(${h} 55% 52%)`;
    let d: string;
    if (this.map.layout === 'tree') {
      const x1 = p.x + p.w / 2;
      const x2 = c.x - c.w / 2;
      const mx = (x1 + x2) / 2;
      d = `M${x1} ${p.y} C${mx} ${p.y} ${mx} ${c.y} ${x2} ${c.y}`;
    } else {
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      // Steuerpunkt in Richtung "weg von der Wurzel" für leichte Kurven
      const rootBox = this.boxes[this.rootOf(pid)];
      let ux = p.x - rootBox.x;
      let uy = p.y - rootBox.y;
      const ul = Math.hypot(ux, uy);
      if (ul < 1) { ux = dx / len; uy = dy / len; } else { ux /= ul; uy /= ul; }
      d = `M${p.x} ${p.y} Q${p.x + ux * len * 0.4} ${p.y + uy * len * 0.4} ${c.x} ${c.y}`;
    }
    svg('path', {
      d,
      class: 'edge' + (dim ? ' dim' : ''),
      stroke: color,
      'stroke-width': Math.max(1.8, 4.5 - c.depth),
    }, this.gEdges);
  }

  private rootOf(id: string): string {
    let cur = id;
    while (this.map.nodes[cur].parent) cur = this.map.nodes[cur].parent!;
    return cur;
  }

  private drawNode(id: string, dim: boolean, into: Element = this.gNodes, at?: { x: number; y: number }) {
    const n = this.map.nodes[id];
    const b = this.boxes[id];
    const h = this.hue(b);
    const done = this.done[id];
    const isRoot = n.parent === null;
    const cls = ['node'];
    if (isRoot) cls.push('root');
    if (id === this.sel && into === this.gNodes) cls.push('selected');
    if (dim) cls.push('dim');
    if (n.type !== 'none' && done) cls.push('done');
    const cx = at ? at.x : b.x;
    const cy = at ? at.y : b.y;
    const g = svg('g', {
      class: cls.join(' '),
      'data-id': id,
      transform: `translate(${cx - b.w / 2} ${cy - b.h / 2})`,
      style: h === null ? '' : `--h:${h}`,
    }, into);
    svg('rect', { class: 'body', width: b.w, height: b.h, rx: b.h / 2 }, g);

    const hasIcon = n.type !== 'none';
    if (n.type === 'checkbox') {
      const derived = M.isDerived(this.map, id);
      const cg = svg('g', { class: 'chk' + (derived ? ' derived' : ''), 'data-chk': 1 }, g);
      svg('rect', { class: 'hit', x: 2, y: 0, width: 34, height: b.h, fill: 'transparent' }, cg);
      svg('rect', { class: 'box', x: 11, y: b.h / 2 - 8, width: 16, height: 16, rx: 4 }, cg);
      if (done) svg('path', { class: 'tick', d: `M14.5 ${b.h / 2} l3.5 3.8 l6.5 -7.6` }, cg);
    } else if (n.type === 'info') {
      svg('circle', { class: 'info-dot', cx: 20, cy: b.h / 2, r: 9 }, g);
      const t = svg('text', { class: 'info-i', x: 20, y: b.h / 2 + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      t.textContent = 'i';
    }
    const t = svg('text', {
      class: 'label' + (n.text.trim() ? '' : ' placeholder'),
      x: hasIcon ? 36 : b.w / 2,
      y: b.h / 2 + 0.5,
      'text-anchor': hasIcon ? 'start' : 'middle',
      'dominant-baseline': 'central',
    }, g);
    t.textContent = displayText(n.text);
  }

  private updateToolbar() {
    const has = !!this.sel;
    const node = this.sel ? this.map.nodes[this.sel] : null;
    this.toolbar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const act = b.dataset.act;
      b.disabled = !has;
      if (act === 'detach') b.disabled = !node || node.parent === null;
      if (b.dataset.type) b.classList.toggle('active', node?.type === b.dataset.type);
    });
    const layoutBtn = this.root.querySelector<HTMLButtonElement>('[data-act="layout"]')!;
    layoutBtn.innerHTML = this.map.layout === 'radial' ? '◎<span class="lbl"> Radial</span>' : '☰<span class="lbl"> Baum</span>';
    (this.root.querySelector('[data-act="undo"]') as HTMLButtonElement).disabled = !this.undoStack.length;
    (this.root.querySelector('[data-act="redo"]') as HTMLButtonElement).disabled = !this.redoStack.length;
    this.empty.hidden = Object.keys(this.map.nodes).length > 0;
  }

  // ───────────────────────── Ansicht ─────────────────────────

  private applyView() {
    const { x, y, k } = this.view;
    this.world.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
  }

  private svgRect() {
    return this.svgEl.getBoundingClientRect();
  }

  private clientToScreen(cx: number, cy: number) {
    const r = this.svgRect();
    return { x: cx - r.left, y: cy - r.top };
  }

  private screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.view.x) / this.view.k, y: (sy - this.view.y) / this.view.k };
  }

  private fit() {
    const b = boundsOf(this.boxes);
    const W = this.svgEl.clientWidth || 800;
    const H = this.svgEl.clientHeight || 600;
    if (!b) {
      this.view = { x: W / 2, y: H / 2, k: 1 };
      return this.applyView();
    }
    const pad = 40;
    const k = Math.min(1, Math.max(MIN_K, Math.min((W - 2 * pad) / (b.x1 - b.x0), (H - 2 * pad) / (b.y1 - b.y0))));
    this.view = {
      k,
      x: W / 2 - ((b.x0 + b.x1) / 2) * k,
      y: H / 2 - ((b.y0 + b.y1) / 2) * k,
    };
    this.applyView();
  }

  private zoomAt(sx: number, sy: number, factor: number) {
    const k = Math.min(MAX_K, Math.max(MIN_K, this.view.k * factor));
    const w = this.screenToWorld(sx, sy);
    this.view = { k, x: sx - w.x * k, y: sy - w.y * k };
    this.applyView();
    this.positionInput();
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const s = this.clientToScreen(e.clientX, e.clientY);
    this.zoomAt(s.x, s.y, Math.exp(-e.deltaY * 0.0015));
  };

  private ensureVisible(id: string) {
    const b = this.boxes[id];
    if (!b) return;
    const W = this.svgEl.clientWidth;
    const H = this.svgEl.clientHeight;
    const sx = this.view.x + b.x * this.view.k;
    const sy = this.view.y + b.y * this.view.k;
    const m = 70;
    let dx = 0, dy = 0;
    if (sx < m) dx = m - sx; else if (sx > W - m) dx = W - m - sx;
    if (sy < m) dy = m - sy; else if (sy > H - m) dy = H - m - sy;
    if (dx || dy) {
      this.view.x += dx;
      this.view.y += dy;
      this.applyView();
    }
  }

  // ───────────────────────── Texteditor ─────────────────────────

  private startEdit(id: string) {
    this.editing?.finish(true);
    const n = this.map.nodes[id];
    if (!n) return;
    this.ensureVisible(id);
    const inp = this.input;
    inp.value = n.text;
    inp.hidden = false;
    this.editing = { id, finish: () => {} };
    this.positionInput();
    inp.focus();
    inp.select();

    let finished = false;
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      inp.removeEventListener('keydown', onKey);
      inp.removeEventListener('blur', onBlur);
      inp.removeEventListener('input', onInput);
      this.editing = null;
      inp.hidden = true;
      const text = inp.value.trim();
      if (commit && this.map.nodes[id] && text !== this.map.nodes[id].text) {
        this.commit((m) => M.setText(m, id, text));
      } else {
        this.render();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
        this.svgEl.focus?.();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        finish(true);
        this.sel = id;
        this.addChildNode();
      }
    };
    const onBlur = () => finish(true);
    const onInput = () => this.positionInput();
    inp.addEventListener('keydown', onKey);
    inp.addEventListener('blur', onBlur);
    inp.addEventListener('input', onInput);
    this.editing.finish = finish;
  }

  private positionInput() {
    if (!this.editing) return;
    const b = this.boxes[this.editing.id];
    if (!b) return;
    const { x, y, k } = this.view;
    const w = Math.max(b.w * k, 160);
    this.input.style.left = `${x + b.x * k - w / 2}px`;
    this.input.style.top = `${y + (b.y - b.h / 2) * k}px`;
    this.input.style.width = `${w}px`;
    this.input.style.height = `${b.h * k}px`;
    this.input.style.fontSize = `${Math.max(14, 14 * k)}px`;
  }

  // ───────────────────────── Zeiger-Eingabe ─────────────────────────

  private onDown = (e: PointerEvent) => {
    if (this.editing) this.editing.finish(true);
    this.svgEl.setPointerCapture(e.pointerId);
    const s = this.clientToScreen(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, s);

    if (this.pointers.size === 2) {
      this.cancelGesture();
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const w = this.screenToWorld(mid.x, mid.y);
      this.gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: this.view.k, w0x: w.x, w0y: w.y };
      return;
    }
    if (this.pointers.size > 2) return;

    const target = e.target as Element;
    const nodeEl = target.closest('[data-id]') as SVGElement | null;
    if (nodeEl) {
      const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
      const g: Gesture = {
        kind: 'node',
        nodeId: nodeEl.dataset.id!,
        chk: !!target.closest('[data-chk]'),
        sx: s.x,
        sy: s.y,
        touch,
        timer: null,
        moved: false,
      };
      if (touch && !g.chk) {
        g.timer = window.setTimeout(() => {
          g.timer = null;
          if (this.gesture === g) {
            navigator.vibrate?.(15);
            this.beginDrag(g.nodeId, s.x, s.y);
          }
        }, LONG_PRESS_MS);
      }
      this.gesture = g;
    } else {
      this.gesture = { kind: 'pan', sx: s.x, sy: s.y, vx: this.view.x, vy: this.view.y, moved: false };
    }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    const s = this.clientToScreen(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, s);
    const g = this.gesture;
    if (!g) return;

    if (g.kind === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      if (!b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const k = Math.min(MAX_K, Math.max(MIN_K, (g.k0 * d) / g.d0));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.view = { k, x: mx - g.w0x * k, y: my - g.w0y * k };
      this.applyView();
    } else if (g.kind === 'pan') {
      const dx = s.x - g.sx;
      const dy = s.y - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      g.moved = true;
      this.view.x = g.vx + dx;
      this.view.y = g.vy + dy;
      this.applyView();
    } else if (g.kind === 'node') {
      const dist = Math.hypot(s.x - g.sx, s.y - g.sy);
      if (dist < DRAG_THRESHOLD) return;
      g.moved = true;
      if (g.timer) {
        clearTimeout(g.timer);
        g.timer = null;
      }
      if (g.chk) return;
      if (g.touch) {
        // Finger bewegt sich vor dem Long-Press → Fläche verschieben
        this.gesture = { kind: 'pan', sx: g.sx, sy: g.sy, vx: this.view.x, vy: this.view.y, moved: true };
        this.onMove(e);
      } else {
        this.beginDrag(g.nodeId, g.sx, g.sy);
        this.updateDrag(s.x, s.y);
      }
    } else if (g.kind === 'drag') {
      this.updateDrag(s.x, s.y);
    }
  };

  private onUp = (e: PointerEvent) => {
    const g = this.gesture;
    this.pointers.delete(e.pointerId);
    if (g?.kind === 'pinch') {
      if (this.pointers.size < 2) this.gesture = null;
      return;
    }
    this.gesture = null;
    if (!g) return;
    if (g.kind === 'drag') {
      if (e.type === 'pointercancel') this.endDrag(false);
      else this.endDrag(true);
    } else if (g.kind === 'node') {
      if (g.timer) clearTimeout(g.timer);
      if (e.type === 'pointercancel' || g.moved) return;
      this.tapNode(g.nodeId, g.chk);
    } else if (g.kind === 'pan') {
      if (!g.moved && e.type !== 'pointercancel') {
        this.sel = null;
        this.render();
      }
    }
  };

  private cancelGesture() {
    const g = this.gesture;
    if (g?.kind === 'node' && g.timer) clearTimeout(g.timer);
    if (g?.kind === 'drag') this.endDrag(false);
    this.gesture = null;
  }

  private tapNode(id: string, chk: boolean) {
    const n = this.map.nodes[id];
    if (!n) return;
    if (chk && n.type === 'checkbox' && !M.isDerived(this.map, id)) {
      this.sel = id;
      this.commit((m) => M.toggleDone(m, id));
      return;
    }
    const now = Date.now();
    if (this.lastTap && this.lastTap.id === id && now - this.lastTap.t < DOUBLE_TAP_MS) {
      this.lastTap = null;
      this.sel = id;
      this.render();
      this.startEdit(id);
      return;
    }
    this.lastTap = { id, t: now };
    this.sel = id;
    this.render();
  }

  // ───────────────────────── Drag & Drop (Umhängen) ─────────────────────────

  private beginDrag(id: string, sx: number, sy: number) {
    const b = this.boxes[id];
    const w = this.screenToWorld(sx, sy);
    this.sel = id;
    this.drag = {
      id,
      ox: w.x - b.x,
      oy: w.y - b.y,
      wx: w.x,
      wy: w.y,
      target: null,
      dim: new Set(M.subtreeIds(this.map, id)),
    };
    this.gesture = { kind: 'drag' };
    this.render(); // blendet Teilbaum aus und zeichnet Overlay
  }

  private updateDrag(sx: number, sy: number) {
    const d = this.drag;
    if (!d) return;
    const w = this.screenToWorld(sx, sy);
    d.wx = w.x;
    d.wy = w.y;
    d.target = this.findTarget(d, w.x, w.y);
    this.drawOverlay();
  }

  private findTarget(d: DragState, wx: number, wy: number): Target {
    let best: { id: string; dist: number } | null = null;
    const pad = 10 / this.view.k;
    for (const [id, b] of Object.entries(this.boxes)) {
      if (d.dim.has(id)) continue;
      if (Math.abs(wx - b.x) <= b.w / 2 + pad && Math.abs(wy - b.y) <= b.h / 2 + pad) {
        const dist = Math.hypot(wx - b.x, wy - b.y);
        if (!best || dist < best.dist) best = { id, dist };
      }
    }
    if (!best) return { kind: 'free' };
    const b = this.boxes[best.id];
    const hasParent = this.map.nodes[best.id].parent !== null;
    let mode: DropMode = 'child';
    if (hasParent) {
      const rel = (wy - (b.y - b.h / 2)) / b.h;
      if (rel < 0.3) mode = 'before';
      else if (rel > 0.7) mode = 'after';
    }
    if (!M.canMove(this.map, d.id, best.id, mode)) return null;
    return { kind: 'node', id: best.id, mode };
  }

  private drawOverlay() {
    const d = this.drag;
    this.gOverlay.replaceChildren();
    if (!d) return;
    const gx = d.wx - d.ox;
    const gy = d.wy - d.oy;
    const t = d.target;
    let label = '';

    if (t?.kind === 'node') {
      const tb = this.boxes[t.id];
      const tn = this.map.nodes[t.id];
      const tname = displayText(tn.text);
      if (t.mode === 'child') {
        svg('rect', {
          class: 'drop-hl', x: tb.x - tb.w / 2 - 5, y: tb.y - tb.h / 2 - 5,
          width: tb.w + 10, height: tb.h + 10, rx: tb.h / 2 + 5,
        }, this.gOverlay);
        this.dashedLink(tb.x, tb.y, gx, gy);
        label = `Unterknoten von „${tname}“`;
      } else {
        const by = t.mode === 'before' ? tb.y - tb.h / 2 - 6 : tb.y + tb.h / 2 + 6;
        svg('line', {
          class: 'drop-bar', x1: tb.x - tb.w / 2 - 4, x2: tb.x + tb.w / 2 + 4, y1: by, y2: by,
        }, this.gOverlay);
        const pb = this.boxes[tn.parent!];
        this.dashedLink(pb.x, pb.y, tb.x, by);
        this.dashedLink(tb.x, by, gx, gy);
        label = (t.mode === 'before' ? 'Vor „' : 'Nach „') + tname + '“ einfügen';
      }
    } else if (t?.kind === 'free') {
      label = this.map.nodes[d.id].parent === null ? '' : 'Als freien Knoten ablegen';
    } else {
      label = 'Hier nicht möglich';
    }

    // Geist des gezogenen Knotens
    const gg = svg('g', { class: 'ghost' + (t === null ? ' invalid' : '') }, this.gOverlay);
    this.drawNode(d.id, false, gg, { x: gx, y: gy });
    const count = d.dim.size - 1;
    if (count > 0) {
      const b = this.boxes[d.id];
      const badge = svg('g', { transform: `translate(${gx + b.w / 2 - 6} ${gy - b.h / 2 - 4})`, class: 'badge' }, gg);
      svg('circle', { r: 11 }, badge);
      svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, badge).textContent = `+${count}`;
    }
    if (label) {
      const b = this.boxes[d.id];
      const ty = gy - b.h / 2 - 22;
      const w = label.length * 7 + 18;
      const lg = svg('g', { class: 'drop-label', transform: `translate(${gx} ${ty})` }, this.gOverlay);
      svg('rect', { x: -w / 2, y: -12, width: w, height: 24, rx: 12 }, lg);
      svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, lg).textContent = label;
    }
  }

  private dashedLink(x1: number, y1: number, x2: number, y2: number) {
    svg('line', { class: 'drop-link', x1, y1, x2, y2 }, this.gOverlay);
    svg('circle', { class: 'drop-dot', cx: x1, cy: y1, r: 5 }, this.gOverlay);
  }

  private endDrag(apply: boolean) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const t = d.target;
    if (apply && t) {
      const id = d.id;
      const gx = d.wx - d.ox;
      const gy = d.wy - d.oy;
      if (t.kind === 'node') {
        this.commit((m) => M.moveNode(m, id, t.id, t.mode));
        this.ensureVisible(id);
        return;
      }
      // freier Knoten: Wurzel verschieben bzw. Knoten lösen
      this.commit((m) => M.detachToFree(m, id, gx, gy));
      return;
    }
    this.render();
  }

  // ───────────────────────── Tastatur ─────────────────────────

  private onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      return e.shiftKey ? this.redo() : this.undo();
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      return this.redo();
    }
    if (e.key === 'Escape') {
      if (this.drag) { this.cancelGesture(); return; }
      this.sel = null;
      return this.render();
    }
    if (!this.sel || mod) return;
    const n = this.map.nodes[this.sel];
    const siblings = n.parent ? this.map.nodes[n.parent].children : this.map.roots;
    const idx = siblings.indexOf(n.id);
    const go = (id: string | undefined) => {
      if (!id) return;
      this.sel = id;
      this.render();
      this.ensureVisible(id);
    };
    switch (e.key) {
      case 'Enter': e.preventDefault(); return this.addSiblingNode();
      case 'Tab': e.preventDefault(); return this.addChildNode();
      case 'F2':
      case ' ': e.preventDefault(); return this.startEdit(n.id);
      case 'Delete':
      case 'Backspace': e.preventDefault(); return this.deleteSel();
      case 'ArrowUp': e.preventDefault(); return go(siblings[idx - 1]);
      case 'ArrowDown': e.preventDefault(); return go(siblings[idx + 1]);
      case 'ArrowLeft': e.preventDefault(); return go(n.parent ?? undefined);
      case 'ArrowRight': e.preventDefault(); return go(n.children[0]);
    }
  }
}
