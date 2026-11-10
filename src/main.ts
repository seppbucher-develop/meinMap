import './style.css';
import { Editor } from './editor';
import { createMap, type MindMap } from './model';
import { deleteMap, getMap, importMap, listMaps, saveMap } from './storage';

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

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
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
      <label class="btn import">⤒ Importieren<input type="file" accept=".json,application/json" hidden></label>
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
  app.querySelector<HTMLInputElement>('input[type=file]')!.addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const map = importMap(await f.text());
      location.hash = `#/m/${encodeURIComponent(map.id)}`;
    } catch (err) {
      alert('Import fehlgeschlagen: ' + (err as Error).message);
    }
  });
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
