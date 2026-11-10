import { IMAGE_PROMPT } from './outline';

const KEY = 'meinmap:anthropic-key';
const MODEL = 'claude-sonnet-5-5';

export const getApiKey = (): string => {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
};
export const setApiKey = (k: string): void => {
  try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch { /* ignore */ }
};

/** Verkleinert das Bild (max. 1568 px Kante) und liefert Base64-JPEG. */
async function toBase64Jpeg(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const out: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht gelesen werden'))), 'image/jpeg', 0.88));
  const buf = new Uint8Array(await out.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Erkennt eine Mindmap im Bild mit der Claude-API und liefert die Gliederung als Text. */
export async function imageToOutline(blob: Blob, apiKey: string): Promise<string> {
  const data = await toBase64Jpeg(blob);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Aufruf direkt aus dem Browser; der Schlüssel bleibt nur auf diesem Gerät.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
            { type: 'text', text: IMAGE_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message ?? ''; } catch { /* ignore */ }
    throw new Error(`API-Fehler ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const json = await res.json();
  const text = (json.content as Array<{ type: string; text?: string }>).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text.trim()) throw new Error('Leere Antwort der KI');
  return text;
}
