import './style.css';
import { Editor } from './editor';
import { createMap, type MindMap } from './model';
import { startAutoBackup } from './backup';
import { esc } from './dialogs';
import { addNote, listNotes, saveNotes } from './notes';
import { backupDialog, importDialog } from './panels';
import { deleteMap, getMap, listMaps, saveMap } from './storage';

const app = document.getElementById('app')!;
let editor: Editor | null = null;

function route() {
  editor?.destroy();
  editor = null;
  const m = location.hash.match(/^#\/m\/(.+)$/);
  const map = m ? getMap(decodeURIComponent(m[1])) : undefined;
  if (map) showEditor(map);
  else showList();
}

function showEditor(map: MindMap) {
  app.className = 'editor-view';
  editor = new Editor(app, map, saveMap, () => {
    location.hash = '#/';
  });
}

function showList() {
  app.className = 'list-view';
  const maps = listMaps();
  app.innerHTML = `
    <main class="list">
      <h1>meinMap</h1>
      <form class="new" autocomplete="off">
        <input name="title" placeholder="Titel der neuen Mindmap" maxlength="80" aria-label="Titel">
        <button class="btn primary" type="submit">＋ Neue Mindmap</button>
      </form>
      <ul>
        ${maps
          .map(
            (m) => `<li data-id="${esc(m.id)}">
              <a class="card" href="#/m/${encodeURIComponent(m.id)}">
                <strong>${esc(m.title || 'Ohne Titel')}</strong>
                <span>${Object.keys(m.nodes).length} Knoten · ${new Date(m.updatedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </a>
              <button class="btn danger" data-del="${esc(m.id)}" aria-label="Löschen">🗑</button>
            </li>`,
          )
          .join('')}
      </ul>
      ${maps.length ? '' : '<p class="muted">Noch keine Mindmaps – lege oben die erste an.</p>'}
      <div class="row">
        <button class="btn" data-import>⤒ Importieren (Datei, Text, Screenshot)</button>
        <button class="btn" data-backup>💾 Backup &amp; Wiederherstellen</button>
      </div>
      <section class="notes">
        <h2>Gedanken zur App</h2>
        <form class="note-new" autocomplete="off">
          <input name="note" placeholder="Idee, Fehler oder Wunsch notieren …" maxlength="300" aria-label="Neue Notiz">
          <button class="btn" type="submit">＋</button>
        </form>
        <ul class="note-list">
          ${listNotes()
            .map(
              (n) => `<li class="${n.done ? 'done' : ''}">
                <label><input type="checkbox" data-note="${esc(n.id)}" ${n.done ? 'checked' : ''}><span>${esc(n.text)}</span></label>
                <button class="btn small" data-note-del="${esc(n.id)}" aria-label="Notiz löschen">×</button>
              </li>`,
            )
            .join('')}
        </ul>
      </section>
      <footer class="version">meinMap v${__APP_VERSION__} · Stand ${__BUILD_DATE__}</footer>
    </main>`;

  app.querySelector<HTMLFormElement>('form.new')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = new FormData(e.target as HTMLFormElement).get('title')?.toString().trim() || 'Neue Mindmap';
    const map = createMap(title);
    saveMap(map);
    location.hash = `#/m/${encodeURIComponent(map.id)}`;
  });
  app.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      const m = maps.find((x) => x.id === b.dataset.del)!;
      if (confirm(`„${m.title}“ wirklich löschen?`)) {
        deleteMap(m.id);
        showList();
      }
    }),
  );
  app.querySelector<HTMLFormElement>('form.note-new')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem('note') as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    addNote(text);
    showList();
  });
  app.querySelectorAll<HTMLInputElement>('[data-note]').forEach((c) =>
    c.addEventListener('change', () => {
      saveNotes(listNotes().map((n) => (n.id === c.dataset.note ? { ...n, done: c.checked } : n)));
      c.closest('li')!.classList.toggle('done', c.checked);
    }),
  );
  app.querySelectorAll<HTMLButtonElement>('[data-note-del]').forEach((b) =>
    b.addEventListener('click', () => {
      saveNotes(listNotes().filter((n) => n.id !== b.dataset.noteDel));
      showList();
    }),
  );
  app.querySelector('[data-import]')!.addEventListener('click', () =>
    importDialog((id) => {
      if (id) location.hash = `#/m/${encodeURIComponent(id)}`;
      else showList();
    }),
  );
  app.querySelector('[data-backup]')!.addEventListener('click', () => backupDialog(showList));
}

startAutoBackup();
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
