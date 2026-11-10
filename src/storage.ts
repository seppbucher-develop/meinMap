import { type MindMap, sanitizeMap } from './model';

// Alle Mindmaps liegen unter einem Schlüssel im localStorage (JSON).
// Die Schnittstelle ist bewusst klein, damit später IndexedDB/Cloud-Sync austauschbar ist.
const KEY = 'meinmap:v1';

function readAll(): MindMap[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown[];
    return arr.map((m) => sanitizeMap(m));
  } catch (e) {
    console.warn('Speicher konnte nicht gelesen werden', e);
    return [];
  }
}

function writeAll(maps: MindMap[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(maps));
  } catch (e) {
    console.error('Speichern fehlgeschlagen', e);
    alert('Speichern fehlgeschlagen (Speicher voll?). Bitte die Mindmap exportieren.');
  }
}

export function listMaps(): MindMap[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getMap(id: string): MindMap | undefined {
  return readAll().find((m) => m.id === id);
}

export function saveMap(map: MindMap): void {
  const all = readAll();
  const i = all.findIndex((m) => m.id === map.id);
  if (i >= 0) all[i] = map;
  else all.push(map);
  writeAll(all);
}

export function deleteMap(id: string): void {
  writeAll(readAll().filter((m) => m.id !== id));
}

/** Importiert JSON-Text; vergibt bei Kollision eine neue ID. */
export function importMap(text: string): MindMap {
  const map = sanitizeMap(JSON.parse(text));
  if (getMap(map.id)) map.id = crypto.randomUUID();
  map.updatedAt = Date.now();
  saveMap(map);
  return map;
}

export function exportMap(map: MindMap): void {
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${map.title.replace(/[^\w\- äöüÄÖÜß]+/g, '_') || 'mindmap'}.meinmap.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
