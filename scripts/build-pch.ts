// Builds the precompiled <bits/stdc++.h> for every standard/optimization choice in the UI into
// public/pch/, plus manifest.json mapping flags to files. Run before `vite build` (the deploy
// workflow does); takes ~10-15 s per file. Files that already exist are reused.
// Run with: npm run build:pch
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { buildPch, pchFileName } from '../src/cpp/compile.ts'

const STANDARDS = ['c++17', 'c++20', 'c++23']
const OPTIMIZATIONS = ['-O2', '-O0']
const dir = new URL('../public/pch/', import.meta.url)

await mkdir(dir, { recursive: true })
const manifest: Record<string, string> = {}
for (const std of STANDARDS) {
  for (const opt of OPTIMIZATIONS) {
    const flags = [`-std=${std}`, opt]
    const name = await pchFileName(flags)
    manifest[flags.join(' ')] = name
    const file = new URL(name, dir)
    if (await stat(file).catch(() => null)) {
      console.log(`${flags.join(' ')}: ${name} (already built)`)
      continue
    }
    const start = performance.now()
    const pch = await buildPch(flags)
    await writeFile(file, pch)
    const seconds = ((performance.now() - start) / 1000).toFixed(1)
    console.log(`${flags.join(' ')}: ${name}, ${(pch.length / 1048576).toFixed(1)} MB in ${seconds} s`)
  }
}

// Drop files from older compilers or headers.
const keep = new Set([...Object.values(manifest), 'manifest.json'])
for (const name of await readdir(dir)) {
  if (!keep.has(name)) await rm(new URL(name, dir))
}
await writeFile(new URL('manifest.json', dir), JSON.stringify(manifest, null, 2) + '\n')
