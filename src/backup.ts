import { type MindMap, sanitizeMap } from './model';
import { type Note, listNotes, restoreNotes } from './notes';
import { downloadFile, listMaps, onStorageChange, restoreMaps } from './storage';

// Backup/Restore in ein vom Nutzer gewähltes Verzeichnis (File System Access API, Chrome/Edge am PC).
// Auf Android/Firefox gibt es das nicht → Fallback über Download/Teilen bzw. Dateiauswahl.

interface DirHandle {
  name: string;
  kind: 'directory';
  queryPermission(d: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(d: { mode: 'readwrite' }): Promise<PermissionState>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterable<[string, FileHandle | DirHandle]>;
}
interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>;
}

export const dirPickerSupported = (): boolean => 'showDirectoryPicker' in window;

// ── Handle-Speicher (IndexedDB) ──
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('meinmap', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => res(q.result as T | undefined);
    q.onerror = () => rej(q.error);
  });
}
async function kvSet(key: string, val: unknown): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

let cachedDir: DirHandle | null = null;
export const getDir = async (): Promise<DirHandle | null> => {
  if (cachedDir) return cachedDir;
  try { return (cachedDir = (await kvGet<DirHandle>('backupDir')) ?? null); } catch { return null; }
};

export async function chooseDir(): Promise<DirHandle> {
  const h = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({
    id: 'meinmap-backup',
    mode: 'readwrite',
  });
  cachedDir = h;
  await kvSet('backupDir', h);
  return h;
}

export async function hasPermission(h: DirHandle, request = false): Promise<boolean> {
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return request && (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

// ── Backup-Format ──
export interface BackupFile {
  format: 'meinmap-backup';
  version: 1;
  createdAt: number;
  maps: MindMap[];
  notes?: Note[];
}

export function makeBackup(): BackupFile {
  return { format: 'meinmap-backup', version: 1, createdAt: Date.now(), maps: listMaps(), notes: listNotes() };
}

export function parseBackup(text: string): MindMap[] {
  const j = JSON.parse(text) as Partial<BackupFile> & Record<string, unknown>;
  if (j.format === 'meinmap-backup' && Array.isArray(j.maps)) return j.maps.map((m) => sanitizeMap(m));
  if (j.nodes && j.roots) return [sanitizeMap(j)]; // einzelne exportierte Mindmap
  throw new Error('Keine meinMap-Sicherung');
}

/** Spielt ein Backup (Text) ein: Mindmaps + Notizen. Gibt die Anzahl Mindmaps zurück. */
export function applyBackupText(text: string): number {
  const maps = parseBackup(text);
  const n = restoreMaps(maps);
  try { restoreNotes((JSON.parse(text) as Partial<BackupFile>).notes); } catch { /* ignore */ }
  return n;
}

const stamp = (d = new Date()) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-` +
  `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

const KEEP = 20;

async function write(dir: DirHandle, name: string, text: string) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}

export async function listBackups(dir: DirHandle): Promise<Array<{ name: string; modified: number; size: number }>> {
  const out: Array<{ name: string; modified: number; size: number }> = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file' && /^meinmap-.*\.json$/.test(name)) {
      const f = await (h as FileHandle).getFile();
      out.push({ name, modified: f.lastModified, size: f.size });
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/** Schreibt eine neue, datierte Sicherung ins Verzeichnis und räumt alte auf (die letzten 20 bleiben). */
export async function backupToDir(dir: DirHandle): Promise<string> {
  const name = `meinmap-backup-${stamp()}.json`;
  await write(dir, name, JSON.stringify(makeBackup(), null, 2));
  const dated = (await listBackups(dir)).filter((f) => /^meinmap-backup-\d{8}-\d{6}\.json$/.test(f.name));
  for (const old of dated.slice(KEEP)) await dir.removeEntry(old.name).catch(() => {});
  return name;
}

export async function restoreFromDir(dir: DirHandle, name: string): Promise<number> {
  const f = await (await dir.getFileHandle(name)).getFile();
  return applyBackupText(await f.text());
}

export async function restoreFromFile(file: File): Promise<number> {
  return applyBackupText(await file.text());
}

/** Fallback ohne Verzeichniswahl: Teilen-Dialog (Android) oder Download. */
export async function backupAsFile(): Promise<'shared' | 'downloaded'> {
  const name = `meinmap-backup-${stamp()}.json`;
  const text = JSON.stringify(makeBackup(), null, 2);
  const file = new File([text], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'meinMap-Backup' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }
  downloadFile(name, text);
  return 'downloaded';
}

// ── Auto-Backup ──
const AUTO = 'meinmap:autobackup';
export const isAutoBackup = (): boolean => {
  try { return localStorage.getItem(AUTO) === '1'; } catch { return false; }
};
export const setAutoBackup = (on: boolean): void => {
  try { on ? localStorage.setItem(AUTO, '1') : localStorage.removeItem(AUTO); } catch { /* ignore */ }
};

let autoTimer: number | undefined;
/** Schreibt bei Änderungen (gebündelt, nach 20 s Ruhe) `meinmap-latest.json`, sofern der Zugriff noch erlaubt ist. */
export function startAutoBackup(): void {
  onStorageChange(() => {
    if (!isAutoBackup() || !dirPickerSupported()) return;
    clearTimeout(autoTimer);
    autoTimer = window.setTimeout(async () => {
      const dir = await getDir();
      if (!dir || !(await hasPermission(dir))) return; // ohne Nutzeraktion keine neue Rückfrage
      write(dir, 'meinmap-latest.json', JSON.stringify(makeBackup(), null, 2)).catch(() => {});
    }, 20000);
  });
}
