// Long-lived worker that keeps Clang loaded between compiles.
import { compile, pchFileName } from './compile.ts'
import { fetchBytes } from './assets.ts'

export type CompilerRequest =
  | { type: 'compile'; id: number; source: string; flags: string[] }
  // Start downloading the precompiled header for these flags, so it's ready for the next Run.
  | { type: 'prefetch'; flags: string[] }
export type CompilerMessage =
  | { type: 'download'; done: number; total: number }
  | { type: 'compiled'; id: number; ok: true; wasm: Uint8Array<ArrayBuffer>; log: string; usedPch: boolean }
  | { type: 'compiled'; id: number; ok: false; log: string; usedPch: boolean }
  | { type: 'crashed'; id: number; message: string }

const post = (msg: CompilerMessage, transfer: Transferable[] = []) => self.postMessage(msg, { transfer })

// Precompiled <bits/stdc++.h> files are built at deploy time (scripts/build-pch.ts) and listed in
// pch/manifest.json by flags. One is downloaded in the background the first time its flags are
// used (~17 MB); compiles run without it until it arrives, or if there is none (dev server).
type Pch = { bytes?: Uint8Array; unavailable?: boolean }
const pchs = new Map<string, Pch>()
const pchDir = new URL(`${import.meta.env.BASE_URL}pch/`, self.location.origin)
let manifest: Promise<Record<string, string>> | null = null

function pchFor(flags: string[]): Pch {
  const key = flags.join(' ')
  const existing = pchs.get(key)
  if (existing) return existing
  const pch: Pch = {}
  pchs.set(key, pch)
  manifest ??= fetch(new URL('manifest.json', pchDir))
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
  manifest
    .then(async (files) => {
      const expected = await pchFileName(flags)
      if (files[key] !== expected) throw new Error(`no PCH for ${key}`)
      pch.bytes = await fetchBytes(new URL(expected, pchDir))
    })
    .catch(() => (pch.unavailable = true))
  return pch
}

self.onmessage = async (e: MessageEvent<CompilerRequest>) => {
  const request = e.data
  if (request.type === 'prefetch') {
    pchFor(request.flags)
    return
  }
  const { id, source, flags } = request
  try {
    const onDownload = (p: { done: number; total: number }) => post({ type: 'download', ...p })
    const pch = pchFor(flags)
    let result = await compile(source, flags, { onDownload, pch: pch.unavailable ? undefined : pch.bytes })
    if (!result.ok && result.usedPch && /precompiled|\.pch\b/i.test(result.log)) {
      // The PCH doesn't fit after all; stop using it and compile normally.
      pch.unavailable = true
      pch.bytes = undefined
      result = await compile(source, flags, { onDownload })
    }
    if (result.ok) {
      const wasm = result.wasm.slice() // own buffer, so it can be transferred
      post({ type: 'compiled', id, ok: true, wasm, log: result.log, usedPch: result.usedPch }, [wasm.buffer])
    } else {
      post({ type: 'compiled', id, ok: false, log: result.log, usedPch: result.usedPch })
    }
  } catch (err) {
    post({ type: 'crashed', id, message: err instanceof Error ? err.message : String(err) })
  }
}
