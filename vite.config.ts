import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

// base './' damit die App auch unter einem Unterpfad (z. B. GitHub Pages) läuft.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
