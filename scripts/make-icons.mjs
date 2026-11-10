// Erzeugt die PNG-Icons aus public/icons/icon.svg (benötigt Playwright).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icons/icon.svg', 'utf8');
const b = await chromium.launch();
for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable-512', 512, 0.18]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const inner = size * (1 - 2 * pad);
  await p.setContent(`<body style="margin:0;background:#2b6cb0;display:grid;place-items:center;height:100vh">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`);
  await p.screenshot({ path: `public/icons/${name}.png` });
}
await b.close();
