import type { MindMap } from './model';

export interface Box {
  /** Mittelpunkt */
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** Index des Hauptastes (Kind der Wurzel) – bestimmt die Farbe. -1 für Wurzeln. */
  branch: number;
}

export const NODE_H = 38;
export const ROOT_H = 48;
const CHAR_W = 8.4;
const MAX_CHARS = 28;

export function displayText(text: string): string {
  const t = text.trim() || '…';
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS - 1) + '…' : t;
}

export function nodeSize(text: string, hasIcon: boolean, isRoot: boolean): { w: number; h: number } {
  const len = displayText(text).length;
  const w = Math.max(isRoot ? 110 : 72, len * CHAR_W + 28 + (hasIcon ? 26 : 0));
  return { w, h: isRoot ? ROOT_H : NODE_H };
}

const GAP_X = 56;
const GAP_Y = 12;
const RING_STEP = 210;
const ARC_PER_LEAF = 54;

export function layoutMap(map: MindMap): Record<string, Box> {
  const boxes: Record<string, Box> = {};
  const size = (id: string) => {
    const n = map.nodes[id];
    return nodeSize(n.text, n.type !== 'none', n.parent === null);
  };
  const leaves = (id: string): number => {
    const ch = map.nodes[id].children;
    return ch.length === 0 ? 1 : ch.reduce((s, c) => s + leaves(c), 0);
  };

  for (const rootId of map.roots) {
    const root = map.nodes[rootId];
    const rx = root.x ?? 0;
    const ry = root.y ?? 0;
    if (map.layout === 'radial') layoutRadial(map, rootId, rx, ry, boxes, size, leaves);
    else layoutTree(map, rootId, rx, ry, boxes, size);
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

function layoutRadial(
  map: MindMap,
  rootId: string,
  rx: number,
  ry: number,
  boxes: Record<string, Box>,
  size: (id: string) => { w: number; h: number },
  leaves: (id: string) => number,
) {
  const total = leaves(rootId);
  const r1 = Math.max(170, (total * ARC_PER_LEAF) / (2 * Math.PI));
  const place = (id: string, depth: number, a0: number, a1: number, branch: number) => {
    const s = size(id);
    const mid = (a0 + a1) / 2;
    const r = depth === 0 ? 0 : r1 + (depth - 1) * RING_STEP;
    boxes[id] = { x: rx + Math.cos(mid) * r, y: ry + Math.sin(mid) * r, ...s, depth, branch };
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

function layoutTree(
  map: MindMap,
  rootId: string,
  rx: number,
  ry: number,
  boxes: Record<string, Box>,
  size: (id: string) => { w: number; h: number },
) {
  const heightMemo: Record<string, number> = {};
  const subtreeH = (id: string): number => {
    if (id in heightMemo) return heightMemo[id];
    const ch = map.nodes[id].children;
    const own = size(id).h;
    const kids = ch.length ? ch.reduce((s, c) => s + subtreeH(c), 0) + GAP_Y * (ch.length - 1) : 0;
    return (heightMemo[id] = Math.max(own, kids));
  };
  const place = (id: string, cx: number, cy: number, depth: number, branch: number) => {
    const s = size(id);
    boxes[id] = { x: cx, y: cy, ...s, depth, branch };
    const ch = map.nodes[id].children;
    if (!ch.length) return;
    const blockH = ch.reduce((acc, c) => acc + subtreeH(c), 0) + GAP_Y * (ch.length - 1);
    let top = cy - blockH / 2;
    ch.forEach((c, i) => {
      const h = subtreeH(c);
      const cs = size(c);
      place(c, cx + s.w / 2 + GAP_X + cs.w / 2, top + h / 2, depth + 1, depth === 0 ? i : branch);
      top += h + GAP_Y;
    });
  };
  place(rootId, rx, ry, 0, -1);
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
