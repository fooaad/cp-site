import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  // GitHub Pages serves the site at https://fooaad.github.io/cp-site/ (`vite preview` mirrors that).
  base: command === 'build' || isPreview ? '/cp-site/' : '/',
  // @yowasp/clang loads its .wasm files with `new URL(..., import.meta.url)`;
  // pre-bundling would move the code away from those files.
  optimizeDeps: { exclude: ['@yowasp/clang'] },
  worker: { format: 'es' },
  // spike.html (the Phase 0 checks) is only served by the dev server, not built.
}))
