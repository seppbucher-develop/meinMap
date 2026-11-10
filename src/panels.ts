import {
  backupAsFile, backupToDir, chooseDir, dirPickerSupported, getDir, hasPermission, isAutoBackup,
  applyBackupText, listBackups, makeBackup, restoreFromDir, restoreFromFile, setAutoBackup,
} from './backup';
import { copyText, esc, modal, toast } from './dialogs';
import type { MindMap } from './model';
import { FORMAT_HELP, IMAGE_PROMPT, aiPackage, mapFromOutline, parseOutline, toOutline } from './outline';
import { downloadFile, exportMap, importMap, safeName, saveMap } from './storage';
import { getApiKey, imageToOutline, setApiKey } from './vision';

const q = <T extends Element>(root: Element, s: string) => root.querySelector(s) as T;

// ───────────────────────── Import ─────────────────────────

/** Import aus Datei (JSON/Backup/Text), eingefügtem Text oder Screenshot. `onDone` bekommt die neue Mindmap-ID. */
export function importDialog(onDone: (mapId: string | null) => void) {
  const m = modal('Importieren', `
    <section>
      <h3>Datei</h3>
      <p class="muted">meinMap-Datei (.json), Sicherung, Gliederung (.md/.txt) oder Screenshot (Bild).</p>
      <label class="btn">Datei wählen<input type="file" data-file accept=".json,.md,.txt,.markdown,text/*,application/json,image/*" hidden></label>
    </section>
    <section>
      <h3>Screenshot einer Mindmap</h3>
      <p class="muted">Bild hier mit <kbd>Strg</kbd>+<kbd>V</kbd> einfügen oder über „Datei wählen“. Die Erkennung läuft über die
        Claude-API; dein API-Schlüssel wird nur in diesem Browser gespeichert, das Bild geht direkt an Anthropic.</p>
      <input type="password" data-key placeholder="Anthropic-API-Schlüssel (sk-ant-…)" autocomplete="off" value="${esc(getApiKey())}">
      <p class="muted">Ohne Schlüssel: Prompt kopieren, mit dem Screenshot in Claude.ai senden und die Antwort unten einfügen.
        <button class="btn small" data-prompt>Prompt kopieren</button></p>
    </section>
    <section>
      <h3>Text / Gliederung</h3>
      <textarea data-text rows="9" placeholder="# Titel&#10;- Wurzel&#10;  - [ ] Aufgabe&#10;  - [i] Info"></textarea>
      <pre class="format">${esc(FORMAT_HELP)}</pre>
      <button class="btn primary" data-go>Als neue Mindmap importieren</button>
      <span class="status muted" data-status></span>
    </section>`);
  const ta = q<HTMLTextAreaElement>(m.el, '[data-text]');
  const status = q<HTMLElement>(m.el, '[data-status]');
  const keyIn = q<HTMLInputElement>(m.el, '[data-key]');
  keyIn.addEventListener('change', () => setApiKey(keyIn.value.trim()));

  const finish = (id: string | null) => { document.removeEventListener('paste', onPaste); m.close(); onDone(id); };

  const recognize = async (blob: Blob) => {
    const key = keyIn.value.trim();
    if (!key) { status.textContent = ''; toast('Bitte zuerst den API-Schlüssel eintragen (oder den Prompt-Weg nutzen).'); keyIn.focus(); return; }
    setApiKey(key);
    status.textContent = 'Erkenne Mindmap …';
    try {
      ta.value = await imageToOutline(blob, key);
      status.textContent = 'Erkannt – bitte prüfen/korrigieren und dann importieren.';
    } catch (e) {
      status.textContent = '';
      toast('Erkennung fehlgeschlagen: ' + (e as Error).message);
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) { e.preventDefault(); void recognize(f); }
  };
  document.addEventListener('paste', onPaste);
  new MutationObserver((_, o) => { if (!document.body.contains(m.el)) { document.removeEventListener('paste', onPaste); o.disconnect(); } })
    .observe(document.body, { childList: true });

  q<HTMLInputElement>(m.el, '[data-file]').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.type.startsWith('image/')) return void recognize(f);
    const text = await f.text();
    try {
      if (text.trimStart().startsWith('{')) {
        const j = JSON.parse(text);
        if (j.format === 'meinmap-backup') {
          const n = applyBackupText(text);
          toast(`${n} Mindmap(s) aus der Sicherung wiederhergestellt`);
          return finish(null);
        }
        return finish(importMap(text).id);
      }
      ta.value = text; // Gliederung: erst anzeigen
      status.textContent = 'Datei geladen – prüfen und importieren.';
    } catch (err) {
      toast('Import fehlgeschlagen: ' + (err as Error).message);
    }
  });

  q<HTMLButtonElement>(m.el, '[data-prompt]').addEventListener('click', async () =>
    toast((await copyText(IMAGE_PROMPT)) ? 'Prompt kopiert' : 'Kopieren nicht möglich'));

  q<HTMLButtonElement>(m.el, '[data-go]').addEventListener('click', () => {
    try {
      const map = mapFromOutline(ta.value);
      saveMap(map);
      finish(map.id);
    } catch (err) {
      toast('Import fehlgeschlagen: ' + (err as Error).message);
    }
  });
}

// ───────────────────────── Export / KI ─────────────────────────

/** Export-Dialog. `getMap` liefert die aktuelle Mindmap, `apply` übernimmt Änderungen aus Text. */
export function shareDialog(getMap: () => MindMap, apply: (text: string) => void) {
  const m = modal('Export & KI', `
    <section>
      <h3>Sicherung dieser Mindmap</h3>
      <button class="btn" data-json>⤓ meinMap-Datei (.json)</button>
    </section>
    <section>
      <h3>Für Claude-Projekt oder Gem</h3>
      <p class="muted">Das KI-Paket enthält Regeln und die Mindmap als Gliederung. Als Projekt-Wissen (Claude) bzw. Wissen/Anweisung (Gem) hochladen –
        oder direkt in einen Chat kopieren. Antwortet die KI mit der geänderten Gliederung, unten einfügen und übernehmen.</p>
      <div class="row">
        <button class="btn" data-pkg-file>⤓ KI-Paket (.md)</button>
        <button class="btn" data-pkg-copy>⧉ KI-Paket kopieren</button>
        <button class="btn" data-outline-copy>⧉ Nur Gliederung kopieren</button>
      </div>
    </section>
    <section>
      <h3>Änderungen aus Text übernehmen</h3>
      <p class="muted">Ersetzt den Inhalt dieser Mindmap (Layout bleibt, Rückgängig möglich).</p>
      <textarea data-text rows="8" placeholder="Gliederung bzw. Antwort der KI hier einfügen"></textarea>
      <button class="btn primary" data-apply>Übernehmen</button>
    </section>`);
  const done = (msg: string) => toast(msg);
  q<HTMLButtonElement>(m.el, '[data-json]').addEventListener('click', () => exportMap(getMap()));
  q<HTMLButtonElement>(m.el, '[data-pkg-file]').addEventListener('click', () => {
    const map = getMap();
    downloadFile(`${safeName(map.title)}.meinmap-ki.md`, aiPackage(map), 'text/markdown');
  });
  q<HTMLButtonElement>(m.el, '[data-pkg-copy]').addEventListener('click', async () =>
    done((await copyText(aiPackage(getMap()))) ? 'KI-Paket kopiert' : 'Kopieren nicht möglich'));
  q<HTMLButtonElement>(m.el, '[data-outline-copy]').addEventListener('click', async () =>
    done((await copyText(toOutline(getMap()))) ? 'Gliederung kopiert' : 'Kopieren nicht möglich'));
  q<HTMLButtonElement>(m.el, '[data-apply]').addEventListener('click', () => {
    const text = q<HTMLTextAreaElement>(m.el, '[data-text]').value;
    try {
      parseOutline(text); // früh prüfen
      apply(text);
      m.close();
      done('Änderungen übernommen');
    } catch (e) {
      done('Übernehmen fehlgeschlagen: ' + (e as Error).message);
    }
  });
}

// ───────────────────────── Backup / Restore ─────────────────────────

export function backupDialog(onChanged: () => void) {
  const m = modal('Backup & Wiederherstellen', '<div data-view>Lade …</div>');
  const view = q<HTMLElement>(m.el, '[data-view]');
  const fmt = (t: number) => new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' });

  async function render() {
    const supported = dirPickerSupported();
    const dir = supported ? await getDir() : null;
    const allowed = dir ? await hasPermission(dir) : false;
    const count = makeBackup().maps.length;
    view.innerHTML = `
      ${supported ? `
      <section>
        <h3>Backup-Verzeichnis</h3>
        <p>${dir ? `<strong>${esc(dir.name)}</strong>${allowed ? '' : ' <span class="muted">(Zugriff muss erneut erlaubt werden)</span>'}` : '<span class="muted">Noch keines gewählt.</span>'}</p>
        <div class="row">
          <button class="btn" data-choose>📁 ${dir ? 'Anderes Verzeichnis wählen' : 'Verzeichnis wählen'}</button>
          ${dir ? '<button class="btn primary" data-backup>💾 Backup jetzt</button><button class="btn" data-list>↺ Wiederherstellen …</button>' : ''}
        </div>
        ${dir ? `<label class="check"><input type="checkbox" data-auto ${isAutoBackup() ? 'checked' : ''}> Automatisch sichern (Datei <code>meinmap-latest.json</code>, solange der Zugriff erlaubt ist)</label>` : ''}
        <div data-backups></div>
      </section>` : `<p class="muted">Dieser Browser kann kein Verzeichnis auswählen (z. B. Chrome auf Android). Nutze unten die Sicherung als Datei –
        über „Teilen“ oder den Download-Ordner.</p>`}
      <section>
        <h3>Als Datei</h3>
        <p class="muted">${count} Mindmap(s) werden gesichert.</p>
        <div class="row">
          <button class="btn" data-file-backup>⤓ Backup-Datei erstellen / teilen</button>
          <label class="btn">⤒ Aus Datei wiederherstellen<input type="file" accept=".json,application/json" hidden data-restore-file></label>
        </div>
      </section>
      <p class="muted">Beim Wiederherstellen werden Mindmaps mit gleicher ID überschrieben, die übrigen bleiben bestehen.</p>`;
    wire(dir);
  }

  function wire(dir: Awaited<ReturnType<typeof getDir>>) {
    const on = (sel: string, fn: () => void | Promise<void>) =>
      view.querySelector(sel)?.addEventListener('click', async () => {
        try { await fn(); } catch (e) { if ((e as Error).name !== 'AbortError') toast('Fehler: ' + (e as Error).message); }
      });
    on('[data-choose]', async () => { await chooseDir(); await render(); });
    on('[data-backup]', async () => {
      if (!(await hasPermission(dir!, true))) return toast('Zugriff auf das Verzeichnis wurde nicht erlaubt');
      const name = await backupToDir(dir!);
      toast(`Gesichert: ${name}`);
    });
    on('[data-list]', async () => {
      if (!(await hasPermission(dir!, true))) return toast('Zugriff auf das Verzeichnis wurde nicht erlaubt');
      const files = await listBackups(dir!);
      const box = q<HTMLElement>(view, '[data-backups]');
      box.innerHTML = files.length
        ? `<ul class="backups">${files.map((f) => `<li><span>${esc(f.name)}<br><small class="muted">${fmt(f.modified)} · ${(f.size / 1024).toFixed(1)} KB</small></span>
            <button class="btn small" data-restore="${esc(f.name)}">Wiederherstellen</button></li>`).join('')}</ul>`
        : '<p class="muted">Keine Backups in diesem Verzeichnis.</p>';
      box.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm(`„${b.dataset.restore}“ wiederherstellen? Mindmaps mit gleicher ID werden überschrieben.`)) return;
          try {
            const n = await restoreFromDir(dir!, b.dataset.restore!);
            toast(`${n} Mindmap(s) wiederhergestellt`);
            onChanged();
            m.close();
          } catch (e) { toast('Fehler: ' + (e as Error).message); }
        }));
    });
    view.querySelector<HTMLInputElement>('[data-auto]')?.addEventListener('change', async (e) => {
      const on = (e.target as HTMLInputElement).checked;
      if (on && dir && !(await hasPermission(dir, true))) { (e.target as HTMLInputElement).checked = false; return toast('Zugriff nicht erlaubt'); }
      setAutoBackup(on);
    });
    on('[data-file-backup]', async () => {
      const r = await backupAsFile();
      toast(r === 'shared' ? 'Backup geteilt' : 'Backup-Datei heruntergeladen');
    });
    view.querySelector<HTMLInputElement>('[data-restore-file]')?.addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      if (!confirm('Backup wiederherstellen? Mindmaps mit gleicher ID werden überschrieben.')) return;
      try {
        toast(`${await restoreFromFile(f)} Mindmap(s) wiederhergestellt`);
        onChanged();
        m.close();
      } catch (err) { toast('Fehler: ' + (err as Error).message); }
    });
  }

  void render();
}
