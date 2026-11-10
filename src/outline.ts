import { type MindMap, type NodeType, addChild, addFree, computeDone, createMap, newId } from './model';

/**
 * Gliederungsformat ("Outline") – gut lesbar für Menschen und KI:
 *
 *   # Titel
 *   - Wurzelknoten
 *     - [ ] offene Aufgabe
 *     - [x] erledigte Aufgabe
 *     - [i] Info (zählt als erledigt)
 *     - Knoten ohne Typ
 *   - Freier Knoten (weitere Zeilen ganz links = zusätzliche freie Knoten)
 */

export function toOutline(map: MindMap): string {
  const done = computeDone(map);
  const lines: string[] = [`# ${map.title}`];
  const walk = (id: string, depth: number) => {
    const n = map.nodes[id];
    const marker = n.type === 'checkbox' ? (done[id] ? '[x] ' : '[ ] ') : n.type === 'info' ? '[i] ' : '';
    lines.push(`${'  '.repeat(depth)}- ${marker}${n.text.replace(/\s*\n\s*/g, ' ')}`);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  map.roots.forEach((r) => walk(r, 0));
  return lines.join('\n');
}

export interface ParsedOutline {
  title: string | null;
  /** Baum als verschachtelte Knoten */
  roots: ParsedNode[];
}
export interface ParsedNode {
  text: string;
  type: NodeType;
  done: boolean;
  children: ParsedNode[];
}

/** Nimmt, falls vorhanden, den ersten ```-Codeblock (so antwortet eine KI üblicherweise). */
function extractBlock(text: string): string {
  const m = text.match(/^```[^\n]*\n([\s\S]*?)^```/m);
  return m ? m[1] : text;
}

export function parseOutline(input: string): ParsedOutline {
  const lines = extractBlock(input).replace(/\r/g, '').split('\n');
  let title: string | null = null;
  const roots: ParsedNode[] = [];
  const stack: Array<{ indent: number; node: ParsedNode }> = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;
    const heading = raw.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      if (title === null && roots.length === 0) title = heading[1].trim();
      continue;
    }
    const m = raw.match(/^([ \t]*)(?:[-*+•]|\d+[.)])?\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].replace(/\t/g, '  ').length;
    let text = m[2].trim();
    if (!text) continue;
    let type: NodeType = 'none';
    let done = false;
    const mk = text.match(/^\[([ xXiI])\]\s*(.*)$/);
    if (mk) {
      const c = mk[1].toLowerCase();
      type = c === 'i' ? 'info' : 'checkbox';
      done = c === 'x';
      text = mk[2].trim();
    }
    const node: ParsedNode = { text, type, done, children: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ indent, node });
  }
  if (!roots.length) throw new Error('Keine Knoten im Text gefunden');
  return { title, roots };
}

/** Schreibt die geparsten Knoten in `map` (ersetzt alle bisherigen Knoten). Layout bleibt erhalten. */
export function applyParsed(map: MindMap, parsed: ParsedOutline): void {
  const oldPos = map.roots.map((r) => ({ x: map.nodes[r].x ?? 0, y: map.nodes[r].y ?? 0 }));
  map.nodes = {};
  map.roots = [];
  if (parsed.title) map.title = parsed.title;
  const build = (p: ParsedNode, parentId: string | null, rootIdx: number): string => {
    const id =
      parentId === null
        ? addFree(map, oldPos[rootIdx]?.x ?? rootIdx * 700, oldPos[rootIdx]?.y ?? 0, p.text)
        : addChild(map, parentId, p.text);
    map.nodes[id].type = p.type;
    map.nodes[id].done = p.done;
    p.children.forEach((c) => build(c, id, rootIdx));
    return id;
  };
  parsed.roots.forEach((r, i) => build(r, null, i));
  map.updatedAt = Date.now();
}

export function mapFromOutline(text: string, fallbackTitle = 'Importiert'): MindMap {
  const parsed = parseOutline(text);
  const map = createMap(parsed.title ?? fallbackTitle);
  map.id = newId();
  applyParsed(map, parsed);
  return map;
}

export const FORMAT_HELP = `Format der Gliederung (jede Zeile ein Knoten, Einrückung mit 2 Leerzeichen = Unterknoten):
- "- Text"        Knoten ohne Typ
- "- [ ] Text"    Aufgabe (offen)
- "- [x] Text"    Aufgabe (erledigt)
- "- [i] Text"    Info (zählt als erledigt)
- Die erste Zeile "# Titel" ist der Titel der Mindmap.
- Zeilen ganz links ohne Einrückung sind Wurzelknoten: der erste ist der Hauptknoten, weitere sind freie Knoten.
- Aufgaben mit Unterknoten sind automatisch erledigt, wenn alle ihre Unterknoten erledigt sind.`;

/** Datei für Claude-Projekte / Gems: Anleitung + aktuelle Mindmap. */
export function aiPackage(map: MindMap): string {
  return `# meinMap – Mindmap „${map.title}“

Dies ist eine Mindmap aus der App meinMap als Gliederung. Nutze sie als Wissensbasis oder Arbeitsgrundlage.

## Regeln für Änderungen
Wenn ich dich bitte, die Mindmap zu ändern oder zu erweitern, antworte mit der **vollständigen, aktualisierten
Gliederung** in genau einem Codeblock (Markdown mit drei Backticks), ohne weitere Kommentare im Block. Ich füge sie in meinMap wieder ein
(„Änderungen aus Text übernehmen“). Bestehende Knoten bleiben unverändert, sofern ich nichts anderes sage.

${FORMAT_HELP}

## Mindmap
\`\`\`
${toOutline(map)}
\`\`\`
`;
}

export const IMAGE_PROMPT = `Das Bild ist ein Screenshot einer Mindmap. Wandle sie in eine Gliederung um.
Regeln:
- Der zentrale Knoten ist die erste Zeile (ohne Einrückung); Äste darunter mit je 2 Leerzeichen mehr Einrückung.
- Hierarchie nach den Verbindungslinien; Text exakt übernehmen, nichts erfinden.
- Checkboxen: "[ ]" offen, "[x]" angehakt; Info-Symbole: "[i]". Sonst kein Marker.
- Nicht verbundene Knoten als weitere Zeilen ohne Einrückung.
- Beginne mit "# Titel" (passender Titel).
Antworte NUR mit der Gliederung in einem Codeblock.

${FORMAT_HELP}`;
