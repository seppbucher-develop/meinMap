import './style.css';
import { Editor } from './editor';
import { createMap, type MindMap } from './model';
import { startAutoBackup } from './backup';
import { esc } from './dialogs';
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
