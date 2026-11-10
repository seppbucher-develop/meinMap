// Notizen/Gedanken zur App (mit Checkbox) – unabhängig von den Mindmaps.
export interface Note {
  id: string;
  text: string;
  done: boolean;
  created: number;
}

const KEY = 'meinmap:notes';

export function listNotes(): Note[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Note[];
    return Array.isArray(arr) ? arr.filter((n) => n && typeof n.text === 'string') : [];
  } catch {
    return [];
  }
}

export function saveNotes(notes: Note[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch { /* ignore */ }
}

export function addNote(text: string): Note[] {
  const notes = listNotes();
  notes.push({ id: crypto.randomUUID(), text, done: false, created: Date.now() });
  saveNotes(notes);
  return notes;
}

/** Fügt Notizen aus einem Backup hinzu bzw. überschreibt gleiche IDs. */
export function restoreNotes(incoming: unknown): void {
  if (!Array.isArray(incoming)) return;
  const all = listNotes();
  for (const n of incoming as Note[]) {
    if (!n || typeof n.id !== 'string' || typeof n.text !== 'string') continue;
    const clean: Note = { id: n.id, text: n.text, done: !!n.done, created: Number(n.created) || Date.now() };
    const i = all.findIndex((x) => x.id === n.id);
    if (i >= 0) all[i] = clean;
    else all.push(clean);
  }
  saveNotes(all);
}
