export interface Modal {
  el: HTMLElement;
  close(): void;
}

/** Einfacher modaler Dialog. `body` ist HTML; Schließen per ×, Escape oder Klick daneben. */
export function modal(title: string, body: string): Modal {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="modal-head"><h2>${title}</h2><button class="btn icon" data-close aria-label="Schließen">×</button></div>
    <div class="modal-body">${body}</div></div>`;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('[data-close]')!.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  return { el: overlay.querySelector('.modal-body') as HTMLElement, close };
}

let toastTimer: number | undefined;
export function toast(msg: string): void {
  let t = document.querySelector<HTMLElement>('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t!.classList.remove('show'), 3200);
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
