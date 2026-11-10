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
    listeners.forEach((f) => f());
  } catch (e) {
    console.error('Speichern fehlgeschlagen', e);
    alert('Speichern fehlgeschlagen (Speicher voll?). Bitte die Mindmap exportieren.');
  }
}

const listeners: Array<() => void> = [];
/** Wird nach jeder Änderung der gespeicherten Mindmaps aufgerufen (z. B. für Auto-Backup). */
export function onStorageChange(fn: () => void): void {
  listeners.push(fn);
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

export function downloadFile(name: string, content: string | Blob, type = 'application/json'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function safeName(title: string): string {
  return title.replace(/[^\w\- äöüÄÖÜß]+/g, '_').trim() || 'mindmap';
}

export function exportMap(map: MindMap): void {
  downloadFile(`${safeName(map.title)}.meinmap.json`, JSON.stringify(map, null, 2));
}

/** Ersetzt/ergänzt mehrere Mindmaps (Restore). Gleiche IDs werden überschrieben. */
export function restoreMaps(maps: MindMap[]): number {
  const all = readAll();
  for (const raw of maps) {
    const m = sanitizeMap(raw);
    const i = all.findIndex((x) => x.id === m.id);
    if (i >= 0) all[i] = m;
    else all.push(m);
  }
  writeAll(all);
  return maps.length;
}
