import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // @yowasp/clang loads its .wasm files with `new URL(..., import.meta.url)`;
  // pre-bundling would move the code away from those files.
  optimizeDeps: { exclude: ['@yowasp/clang'] },
  worker: { format: 'es' },
  build: {
    rollupOptions: { input: ['index.html', 'spike.html'] },
  },
})
