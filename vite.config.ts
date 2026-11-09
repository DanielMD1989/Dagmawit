import { defineConfig } from 'vite';

// base './' keeps every path relative, so the built "dist" folder works
// wherever it is uploaded (Netlify drag-and-drop, Vercel, a sub-folder…).
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' }
});
