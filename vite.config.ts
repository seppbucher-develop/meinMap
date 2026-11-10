import { defineConfig } from 'vite';

// base './' damit die App auch unter einem Unterpfad (z. B. GitHub Pages) läuft.
export default defineConfig({
  base: './',
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
