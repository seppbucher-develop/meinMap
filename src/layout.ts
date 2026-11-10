import type { MindMap } from './model';

export interface Box {
  /** Mittelpunkt */
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** Index des Hauptastes (Kind der Wurzel). -1 für Wurzeln. */
  branch: number;
  /** Seite relativ zur Wurzel: 1 = rechts, -1 = links, 0 = Wurzel/radial */
  side: 1 | -1 | 0;
  /** Umgebrochene Textzeilen */
  lines: string[];
  fs: number;
  lh: number;
  padX: number;
  padY: number;
}

interface Style {
  fs: number;
  padX: number;
  padY: number;
  maxText: number;
  minW: number;
}

const STYLES: Record<'root' | 'l1' | 'deep', Style> = {
  root: { fs: 20, padX: 18, padY: 12, maxText: 270, minW: 150 },
  l1: { fs: 15, padX: 12, padY: 8, maxText: 330, minW: 60 },
  deep: { fs: 13, padX: 9, padY: 6, maxText: 300, minW: 36 },
};
const CHAR_W = 0.56; // mittlere Zeichenbreite relativ zur Schriftgröße
const ICON_W = 26;
const MAX_LINES = 8;

/** Bricht Text wortweise in Zeilen um (zu lange Wörter werden hart getrennt). */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['…'];
  const lines: string[] = [];
  let cur = '';
  const push = () => {
    if (cur) lines.push(cur);
    cur = '';
  };
  for (let word of words) {
    while (word.length > maxChars) {
      push();
      // bevorzugt nach "-" oder "/" trennen, sonst hart
      const cut = Math.max(word.lastIndexOf('-', maxChars - 1), word.lastIndexOf('/', maxChars - 1));
      if (cut > 2) {
        lines.push(word.slice(0, cut + 1));
        word = word.slice(cut + 1);
      } else {
        lines.push(word.slice(0, maxChars - 1) + '-');
        word = word.slice(maxChars - 1);
      }
    }
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= maxChars) cur += ' ' + word;
    else {
      push();
      cur = word;
    }
  }
  push();
  if (lines.length > MAX_LINES) {
    lines.length = MAX_LINES;
    lines[MAX_LINES - 1] = lines[MAX_LINES - 1].replace(/.?$/, '…');
  }
  return lines;
}

type Measured = Pick<Box, 'w' | 'h' | 'lines' | 'fs' | 'lh' | 'padX' | 'padY'>;

export function measure(text: string, depth: number, hasIcon: boolean): Measured {
  const st = depth === 0 ? STYLES.root : depth === 1 ? STYLES.l1 : STYLES.deep;
  const iconW = hasIcon ? ICON_W : 0;
  const maxChars = Math.max(6, Math.floor((st.maxText - iconW) / (st.fs * CHAR_W)));
  const lines = wrapText(text, maxChars);
  const longest = Math.max(...lines.map((l) => l.length));
  const lh = Math.round(st.fs * 1.3);
  return {
    lines,
    fs: st.fs,
    lh,
    padX: st.padX,
    padY: st.padY,
    w: Math.max(st.minW, Math.ceil(longest * st.fs * CHAR_W) + 2 * st.padX + iconW),
    h: lines.length * lh + 2 * st.padY,
  };
}

const GAP_ROOT = 80; // Abstand Wurzel → Hauptast
const GAP_X = 38; // Abstand zwischen weiteren Ebenen
const GAP_Y = 8; // Abstand zwischen Geschwistern
const GAP_Y1 = 22; // Abstand zwischen Hauptästen
const RING_STEP = 280;
const ARC_PER_LEAF = 80;

export function layoutMap(map: MindMap): Record<string, Box> {
  const boxes: Record<string, Box> = {};
  const sizeOf = (id: string, depth: number): Measured => {
    const n = map.nodes[id];
    return measure(n.text, depth, n.type !== 'none');
  };

  for (const rootId of map.roots) {
    const root = map.nodes[rootId];
    const rx = root.x ?? 0;
    const ry = root.y ?? 0;
    if (map.layout === 'radial') layoutRadial(map, rootId, rx, ry, boxes, sizeOf);
    else layoutSides(map, rootId, rx, ry, boxes, sizeOf, map.layout === 'tree');
    applyOffsets(map, rootId, 0, 0, boxes);
  }
  return boxes;
}

/** Manuelle Verschiebungen (dx/dy) wirken kumulativ auf den Knoten und seinen ganzen Teilbaum. */
function applyOffsets(map: MindMap, id: string, cx: number, cy: number, boxes: Record<string, Box>) {
  const n = map.nodes[id];
  const ox = cx + (n.parent === null ? 0 : n.dx ?? 0);
  const oy = cy + (n.parent === null ? 0 : n.dy ?? 0);
  boxes[id].x += ox;
  boxes[id].y += oy;
  for (const c of n.children) applyOffsets(map, c, ox, oy, boxes);
}

type SizeFn = (id: string, depth: number) => Measured;

/** Beidseitig um die Wurzel (Standard) oder nur nach rechts ("Baum"). */
function layoutSides(
  map: MindMap,
  rootId: string,
  rx: number,
  ry: number,
  boxes: Record<string, Box>,
  sizeOf: SizeFn,
  rightOnly: boolean,
) {
  const heightMemo: Record<string, number> = {};
  const subtreeH = (id: string, depth: number): number => {
    if (id in heightMemo) return heightMemo[id];
    const ch = map.nodes[id].children;
    const own = sizeOf(id, depth).h;
    const gap = depth === 0 ? GAP_Y1 : GAP_Y;
    const kids = ch.length ? ch.reduce((s, c) => s + subtreeH(c, depth + 1), 0) + gap * (ch.length - 1) : 0;
    return (heightMemo[id] = Math.max(own, kids));
  };

  const place = (id: string, side: 1 | -1, edgeX: number, cy: number, depth: number, branch: number) => {
    const m = sizeOf(id, depth);
    const cx = edgeX + side * ((depth === 1 ? GAP_ROOT : GAP_X) + m.w / 2);
    boxes[id] = { x: cx, y: cy, ...m, depth, branch, side };
    stack(map.nodes[id].children, side, cx + (side * m.w) / 2, cy, depth + 1, branch);
  };

  // Geschwister untereinander stapeln, als Block mittig um cy
  const stack = (ids: string[], side: 1 | -1, edgeX: number, cy: number, depth: number, branch: number, base = 0) => {
    if (!ids.length) return;
    const gap = depth === 1 ? GAP_Y1 : GAP_Y;
    const hs = ids.map((c) => subtreeH(c, depth));
    const block = hs.reduce((a, b) => a + b, 0) + gap * (ids.length - 1);
    let top = cy - block / 2;
    ids.forEach((c, i) => {
      place(c, side, edgeX, top + hs[i] / 2, depth, depth === 1 ? base + i : branch);
      top += hs[i] + gap;
    });
  };

  const rm = sizeOf(rootId, 0);
  boxes[rootId] = { x: rx, y: ry, ...rm, depth: 0, branch: -1, side: 0 };
  const kids = map.nodes[rootId].children;
  if (!kids.length) return;

  // Hauptäste auf rechte und linke Seite verteilen (nach Höhe ausgewogen, Reihenfolge bleibt erhalten)
  let right = kids;
  let left: string[] = [];
  if (!rightOnly && kids.length > 1) {
    const hs = kids.map((c) => subtreeH(c, 1));
    const total = hs.reduce((a, b) => a + b, 0);
    let acc = 0;
    let split = kids.length;
    for (let i = 0; i < kids.length; i++) {
      if (acc + hs[i] / 2 > total / 2) { split = i; break; }
      acc += hs[i];
    }
    split = Math.max(1, Math.min(split, kids.length - 1));
    right = kids.slice(0, split);
    left = kids.slice(split);
  }
  stack(right, 1, rx + rm.w / 2, ry, 1, -1, 0);
  stack(left, -1, rx - rm.w / 2, ry, 1, -1, right.length);
}

function layoutRadial(
  map: MindMap,
  rootId: string,
  rx: number,
  ry: number,
  boxes: Record<string, Box>,
  sizeOf: SizeFn,
) {
  const leafMemo: Record<string, number> = {};
  const leaves = (id: string): number => {
    if (id in leafMemo) return leafMemo[id];
    const ch = map.nodes[id].children;
    return (leafMemo[id] = ch.length === 0 ? 1 : ch.reduce((s, c) => s + leaves(c), 0));
  };
  const total = leaves(rootId);
  const r1 = Math.max(230, (total * ARC_PER_LEAF) / (2 * Math.PI));
  const place = (id: string, depth: number, a0: number, a1: number, branch: number) => {
    const m = sizeOf(id, depth);
    const mid = (a0 + a1) / 2;
    const r = depth === 0 ? 0 : r1 + (depth - 1) * RING_STEP;
    boxes[id] = { x: rx + Math.cos(mid) * r, y: ry + Math.sin(mid) * r, ...m, depth, branch, side: 0 };
    const ch = map.nodes[id].children;
    if (!ch.length) return;
    const sum = ch.reduce((acc, c) => acc + leaves(c), 0);
    let a = a0;
    ch.forEach((c, i) => {
      const span = ((a1 - a0) * leaves(c)) / sum;
      place(c, depth + 1, a, a + span, depth === 0 ? i : branch);
      a += span;
    });
  };
  // Start oben (−90°), im Uhrzeigersinn
  place(rootId, 0, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI, -1);
}

export function boundsOf(boxes: Record<string, Box>): { x0: number; y0: number; x1: number; y1: number } | null {
  const all = Object.values(boxes);
  if (!all.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of all) {
    x0 = Math.min(x0, b.x - b.w / 2);
    x1 = Math.max(x1, b.x + b.w / 2);
    y0 = Math.min(y0, b.y - b.h / 2);
    y1 = Math.max(y1, b.y + b.h / 2);
  }
  return { x0, y0, x1, y1 };
}
