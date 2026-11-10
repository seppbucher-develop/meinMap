export type NodeType = 'none' | 'checkbox' | 'info';
export type LayoutMode = 'sides' | 'tree' | 'radial';
export type DropMode = 'child' | 'before' | 'after';

export interface MindNode {
  id: string;
  text: string;
  type: NodeType;
  /** Eigener Haken – nur relevant für Checkbox-Knoten ohne zählende Kinder. */
  done: boolean;
  parent: string | null;
  children: string[];
  /** Nur bei Wurzelknoten (parent === null): Position auf der Zeichenfläche. */
  x?: number;
  y?: number;
  /**
   * Nur bei Knoten mit Elternknoten: manuelle grafische Verschiebung gegenüber der automatischen
   * Position. Sie gilt auch für den ganzen Teilbaum. Die Beziehung zum Elternknoten bleibt unverändert.
   */
  dx?: number;
  dy?: number;
}

export interface MindMap {
  id: string;
  title: string;
  layout: LayoutMode;
  nodes: Record<string, MindNode>;
  /** Alle Wurzelknoten (der Hauptknoten und freie Knoten), in Reihenfolge. */
  roots: string[];
  updatedAt: number;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'n' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function createMap(title: string): MindMap {
  const map: MindMap = {
    id: newId(),
    title,
    layout: 'sides',
    nodes: {},
    roots: [],
    updatedAt: Date.now(),
  };
  addFree(map, 0, 0, title);
  return map;
}

function makeNode(text: string, parent: string | null): MindNode {
  return { id: newId(), text, type: 'none', done: false, parent, children: [] };
}

/** Neuer freier Wurzelknoten an Position (x, y). */
export function addFree(map: MindMap, x: number, y: number, text = 'Neuer Knoten'): string {
  const n = makeNode(text, null);
  n.x = x;
  n.y = y;
  map.nodes[n.id] = n;
  map.roots.push(n.id);
  return n.id;
}

export function addChild(map: MindMap, parentId: string, text = 'Neuer Knoten'): string {
  const parent = map.nodes[parentId];
  const n = makeNode(text, parentId);
  map.nodes[n.id] = n;
  parent.children.push(n.id);
  return n.id;
}

/** Geschwisterknoten direkt hinter `id`. Bei Wurzelknoten: neuer freier Knoten daneben. */
export function addSibling(map: MindMap, id: string, text = 'Neuer Knoten'): string {
  const node = map.nodes[id];
  if (node.parent === null) {
    return addFree(map, (node.x ?? 0) + 260, (node.y ?? 0) + 40, text);
  }
  const parent = map.nodes[node.parent];
  const n = makeNode(text, parent.id);
  map.nodes[n.id] = n;
  parent.children.splice(parent.children.indexOf(id) + 1, 0, n.id);
  return n.id;
}

export function subtreeIds(map: MindMap, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    stack.push(...map.nodes[cur].children);
  }
  return out;
}

export function deleteNode(map: MindMap, id: string): void {
  unlink(map, id);
  for (const sid of subtreeIds(map, id)) delete map.nodes[sid];
}

export function setText(map: MindMap, id: string, text: string): void {
  map.nodes[id].text = text;
}

export function setType(map: MindMap, id: string, type: NodeType): void {
  map.nodes[id].type = type;
}

export function toggleDone(map: MindMap, id: string): void {
  map.nodes[id].done = !map.nodes[id].done;
}

/** Ist `id` gleich `ancestorId` oder ein Nachfahre davon? */
export function isInSubtree(map: MindMap, id: string, ancestorId: string): boolean {
  let cur: string | null = id;
  while (cur) {
    if (cur === ancestorId) return true;
    cur = map.nodes[cur].parent;
  }
  return false;
}

/** Verschiebt einen Knoten (samt Teilbaum) nur grafisch; die Beziehungen bleiben bestehen. */
export function shiftNode(map: MindMap, id: string, ddx: number, ddy: number): void {
  const n = map.nodes[id];
  if (n.parent === null) {
    n.x = (n.x ?? 0) + ddx;
    n.y = (n.y ?? 0) + ddy;
  } else {
    n.dx = (n.dx ?? 0) + ddx;
    n.dy = (n.dy ?? 0) + ddy;
  }
}

export function hasOffset(map: MindMap, id: string): boolean {
  const n = map.nodes[id];
  return !!(n && (n.dx || n.dy));
}

export function resetOffset(map: MindMap, id: string): void {
  delete map.nodes[id].dx;
  delete map.nodes[id].dy;
}

export function resetAllOffsets(map: MindMap): void {
  for (const n of Object.values(map.nodes)) {
    delete n.dx;
    delete n.dy;
  }
}

export function canMove(map: MindMap, id: string, targetId: string, mode: DropMode): boolean {
  if (!map.nodes[id] || !map.nodes[targetId]) return false;
  if (isInSubtree(map, targetId, id)) return false; // nicht in sich selbst / den eigenen Teilbaum
  if (mode !== 'child' && map.nodes[targetId].parent === null) return false; // Wurzeln haben keine Geschwister
  return true;
}

/** Entfernt den Knoten aus Elternliste bzw. Wurzelliste (Knoten bleibt in map.nodes). */
function unlink(map: MindMap, id: string): void {
  const node = map.nodes[id];
  if (node.parent === null) {
    map.roots = map.roots.filter((r) => r !== id);
  } else {
    const p = map.nodes[node.parent];
    p.children = p.children.filter((c) => c !== id);
  }
}

/** Hängt `id` samt Teilbaum um. Gibt false zurück, wenn der Zug unzulässig ist. */
export function moveNode(map: MindMap, id: string, targetId: string, mode: DropMode): boolean {
  if (!canMove(map, id, targetId, mode)) return false;
  const node = map.nodes[id];
  const target = map.nodes[targetId];
  if (mode === 'child' && node.parent === targetId) {
    resetOffset(map, id); // schon dort: nur wieder an den automatischen Platz andocken
    return true;
  }
  unlink(map, id);
  delete node.x;
  delete node.y;
  resetOffset(map, id);
  if (mode === 'child') {
    target.children.push(id);
    node.parent = targetId;
  } else {
    const parent = map.nodes[target.parent!];
    const idx = parent.children.indexOf(targetId) + (mode === 'after' ? 1 : 0);
    parent.children.splice(idx, 0, id);
    node.parent = parent.id;
  }
  return true;
}

/** Löst den Knoten (mit Teilbaum) vom Elternknoten und macht ihn zum freien Knoten bei (x, y). */
export function detachToFree(map: MindMap, id: string, x: number, y: number): void {
  const node = map.nodes[id];
  if (node.parent !== null) {
    unlink(map, id);
    node.parent = null;
    map.roots.push(id);
  }
  node.x = x;
  node.y = y;
  resetOffset(map, id);
}

/**
 * Done-Logik. Liefert pro Knoten true/false, bzw. null für Knoten vom Typ "kein":
 *  - info                → immer true
 *  - none                → nimmt nicht teil (null); seine Kinder zählen für den nächsten teilnehmenden Vorfahren
 *  - checkbox            → hat zählende Kinder: true, wenn alle zählenden Kinder true sind;
 *                          sonst eigener Haken
 */
export function computeDone(map: MindMap): Record<string, boolean | null> {
  const memo: Record<string, boolean | null> = {};

  const items = (id: string): string[] => {
    const out: string[] = [];
    for (const c of map.nodes[id].children) {
      if (map.nodes[c].type === 'none') out.push(...items(c));
      else out.push(c);
    }
    return out;
  };

  const calc = (id: string): boolean | null => {
    if (id in memo) return memo[id];
    const n = map.nodes[id];
    let res: boolean | null;
    if (n.type === 'info') res = true;
    else if (n.type === 'none') {
      res = null;
      for (const c of n.children) calc(c); // Kinder trotzdem berechnen
    } else {
      const its = items(id);
      res = its.length === 0 ? n.done : its.every((c) => calc(c) === true);
    }
    memo[id] = res;
    return res;
  };

  for (const id of Object.keys(map.nodes)) calc(id);
  return memo;
}

/** Ob der Haken eines Checkbox-Knotens abgeleitet (nicht manuell klickbar) ist. */
export function isDerived(map: MindMap, id: string): boolean {
  const walk = (cid: string): boolean =>
    map.nodes[cid].children.some((c) => (map.nodes[c].type === 'none' ? walk(c) : true));
  return map.nodes[id].type === 'checkbox' && walk(id);
}

export function cloneMap(map: MindMap): MindMap {
  return JSON.parse(JSON.stringify(map)) as MindMap;
}

/** Prüft und bereinigt importierte Daten. Wirft bei unbrauchbarer Struktur. */
export function sanitizeMap(raw: unknown): MindMap {
  const r = raw as Partial<MindMap> | null;
  if (!r || typeof r !== 'object' || typeof r.nodes !== 'object' || !r.nodes || !Array.isArray(r.roots)) {
    throw new Error('Ungültige Mindmap-Datei');
  }
  const nodes: Record<string, MindNode> = {};
  for (const [id, n] of Object.entries(r.nodes)) {
    const x = n as Partial<MindNode>;
    nodes[id] = {
      id,
      text: String(x.text ?? ''),
      type: x.type === 'checkbox' || x.type === 'info' ? x.type : 'none',
      done: !!x.done,
      parent: typeof x.parent === 'string' && x.parent in r.nodes ? x.parent : null,
      children: Array.isArray(x.children) ? x.children.filter((c) => typeof c === 'string' && c in r.nodes!) : [],
      ...(typeof x.x === 'number' ? { x: x.x } : {}),
      ...(typeof x.y === 'number' ? { y: x.y } : {}),
      ...(typeof x.dx === 'number' ? { dx: x.dx } : {}),
      ...(typeof x.dy === 'number' ? { dy: x.dy } : {}),
    };
  }
  // Zyklen in der Elternkette auflösen
  const total = Object.keys(nodes).length;
  for (const n of Object.values(nodes)) {
    let cur: string | null = n.id;
    for (let i = 0; cur && i <= total; i++) cur = nodes[cur].parent;
    if (cur) n.parent = null;
  }
  // Konsistenz: parent ↔ children, Wurzeln neu bestimmen
  for (const n of Object.values(nodes)) {
    n.children = n.children.filter((c) => nodes[c].parent === n.id);
  }
  const roots = Object.values(nodes)
    .filter((n) => n.parent === null)
    .map((n) => n.id);
  for (const id of roots) {
    nodes[id].x ??= 0;
    nodes[id].y ??= 0;
  }
  return {
    id: typeof r.id === 'string' ? r.id : newId(),
    title: String(r.title ?? 'Importiert'),
    layout: r.layout === 'tree' || r.layout === 'radial' ? r.layout : 'sides',
    nodes,
    roots,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
  };
}
