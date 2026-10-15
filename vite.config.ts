import react from '@vitejs/plugin-react'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => ({
  plugins: [react(), serviceWorker()],
  // GitHub Pages serves the site at https://fooaad.github.io/cp-site/ (`vite preview` mirrors that).
  base: command === 'build' || isPreview ? '/cp-site/' : '/',
  // @yowasp/clang loads its .wasm files with `new URL(..., import.meta.url)`;
  // pre-bundling would move the code away from those files.
  optimizeDeps: { exclude: ['@yowasp/clang'] },
  worker: { format: 'es' },
  // spike.html (the Phase 0 checks) is only served by the dev server, not built.
}))

// Writes dist/sw.js: sw/sw.js preceded by the list of every file in the build, so the service
// worker can drop cached files from older deploys.
function serviceWorker(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'cp-site:service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved
    },
    async closeBundle() {
      const outDir = resolve(config.root, config.build.outDir)
      const files = (await listFiles(outDir)).map((f) => config.base + relative(outDir, f).split('\\').join('/'))
      files.push(config.base) // the page itself, requested as the directory
      const template = await readFile(resolve(config.root, 'sw/sw.js'), 'utf8')
      const header = `const BASE = ${JSON.stringify(config.base)}\nconst FILES = ${JSON.stringify(files.sort())}\n\n`
      await writeFile(join(outDir, 'sw.js'), header + template)
    },
  }
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))),
  )
  return nested.flat()
}
