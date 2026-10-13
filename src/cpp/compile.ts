import { commands, Exit } from '@yowasp/clang'
import { BITS_STDCXX_H } from './stdcxx.ts'

export type CompileResult =
  | { ok: true; wasm: Uint8Array; log: string }
  | { ok: false; log: string }

export type DownloadProgress = { done: number; total: number }

// Flags the user may change (standard, optimization level).
export const DEFAULT_FLAGS = ['-std=c++20', '-O2']

// Flags every compile needs:
// - the bundled libc++ has no exception support, so `throw` can't link; library errors abort instead
// - `include/` holds our <bits/stdc++.h>
// - 256 MB stack like Codeforces; the wasm default (64 KB) overflows on big local arrays.
//   (This is the stack for locals in memory; call depth is limited separately by the browser.)
const FIXED_FLAGS = ['-fno-exceptions', '-isystem', 'include', '-Wl,-z,stack-size=268435456']

// Compiles one C++ source file to a wasm32-wasi program with Clang running as WebAssembly.
// The first call downloads and compiles the toolchain; later calls reuse it.
export async function compile(
  source: string,
  flags: string[] = DEFAULT_FLAGS,
  onDownload?: (progress: DownloadProgress) => void,
): Promise<CompileResult> {
  const decoder = new TextDecoder()
  let log = ''
  const collect = (bytes: Uint8Array | null) => {
    if (bytes) log += decoder.decode(bytes, { stream: true })
  }

  try {
    const files = await commands['clang++'](
      [...flags, ...FIXED_FLAGS, 'main.cpp', '-o', 'main.wasm'],
      { 'main.cpp': source, include: { bits: { 'stdc++.h': BITS_STDCXX_H } } },
      {
        stdout: collect,
        stderr: collect,
        decodeASCII: false,
        fetchProgress: onDownload && ((e) => onDownload({ done: e.doneLength, total: e.totalLength })),
      },
    )
    const wasm = files?.['main.wasm']
    if (!(wasm instanceof Uint8Array)) return { ok: false, log: log || 'Compiler produced no output.' }
    return { ok: true, wasm, log }
  } catch (e) {
    if (e instanceof Exit) return { ok: false, log }
    throw e
  }
}
