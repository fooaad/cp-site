import { commands, Exit } from '@yowasp/clang'
import { BITS_STDCXX_H } from './stdcxx.ts'
import { fetchBytes } from './assets.ts'

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
// - clock() isn't in WASI; the emulation measures wall time, which is what CP time checks want
// - our optimized libc++ (see libcxx/build.sh) instead of the bundled, unoptimized one
const FIXED_FLAGS = [
  '-fno-exceptions',
  '-isystem',
  'include',
  '-Wl,-z,stack-size=268435456',
  '-D_WASI_EMULATED_PROCESS_CLOCKS',
  '-lwasi-emulated-process-clocks',
  '-nostdlib++',
  'libcxx/libc++.a',
  'libcxx/libc++abi.a',
]

// Same source and configuration as the libc++ in @yowasp/clang (headers are identical), but
// built with -O2: cin/cout/to_string run 5-20x faster.
let libcxx: Promise<{ 'libc++.a': Uint8Array; 'libc++abi.a': Uint8Array }> | null = null
function loadLibcxx() {
  return (libcxx ??= Promise.all([
    fetchBytes(new URL('./libcxx/libc++.a', import.meta.url)),
    fetchBytes(new URL('./libcxx/libc++abi.a', import.meta.url)),
  ]).then(([cxx, cxxabi]) => ({ 'libc++.a': cxx, 'libc++abi.a': cxxabi })))
}

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
      [...flags, 'main.cpp', '-o', 'main.wasm', ...FIXED_FLAGS],
      { 'main.cpp': source, include: { bits: { 'stdc++.h': BITS_STDCXX_H } }, libcxx: await loadLibcxx() },
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
