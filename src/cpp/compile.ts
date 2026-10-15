import * as yowasp from '@yowasp/clang'
import { commands, Exit } from '@yowasp/clang'
import { BITS_STDCXX_H } from './stdcxx.ts'
import { fetchBytes } from './assets.ts'

export type CompileResult =
  | { ok: true; wasm: Uint8Array; log: string; usedPch: boolean }
  | { ok: false; log: string; usedPch: boolean }

export type DownloadProgress = { done: number; total: number }

// Flags the user may change (standard, optimization level).
export const DEFAULT_FLAGS = ['-std=c++20', '-O2']

// Reserved for the stack in every program's memory (like Codeforces' 256 MB stack). Memory use
// is reported without it, since the reservation is the same whether the program uses it or not.
export const STACK_BYTES = 256 * 1024 * 1024

// Flags that affect how code is parsed. A precompiled header only works with exactly the flags
// it was built with, so the PCH build uses these too.
// - the bundled libc++ has no exception support, so `throw` can't link; library errors abort instead
// - `include/` holds our <bits/stdc++.h>
// - clock() isn't in WASI; the emulation measures wall time, which is what CP time checks want
const LANGUAGE_FLAGS = ['-fno-exceptions', '-isystem', 'include', '-D_WASI_EMULATED_PROCESS_CLOCKS']

// Flags for linking:
// - 256 MB stack like Codeforces; the wasm default (64 KB) overflows on big local arrays.
//   (This is the stack for locals in memory; call depth is limited separately by the browser.)
// - our optimized libc++ (see libcxx/build.sh) instead of the bundled, unoptimized one
const LINK_FLAGS = [
  `-Wl,-z,stack-size=${STACK_BYTES}`,
  '-lwasi-emulated-process-clocks',
  '-nostdlib++',
  'libcxx/libc++.a',
  'libcxx/libc++abi.a',
]

const INCLUDE_DIR = { bits: { 'stdc++.h': BITS_STDCXX_H } }

// Same source and configuration as the libc++ in @yowasp/clang (headers are identical), but
// built with -O2: cin/cout/to_string run 5-20x faster.
let libcxx: Promise<{ 'libc++.a': Uint8Array; 'libc++abi.a': Uint8Array }> | null = null
function loadLibcxx() {
  return (libcxx ??= Promise.all([
    fetchBytes(new URL('./libcxx/libc++.a', import.meta.url)),
    fetchBytes(new URL('./libcxx/libc++abi.a', import.meta.url)),
  ]).then(([cxx, cxxabi]) => ({ 'libc++.a': cxx, 'libc++abi.a': cxxabi })))
}

// A precompiled <bits/stdc++.h> cuts a typical compile from ~1.4 s to ~0.3 s. It is used only
// when that include is the first #include/#define in the file, so macros defined before it
// still affect the headers the way they would without it.
export function canUsePch(source: string): boolean {
  let inBlockComment = false
  for (const raw of source.split('\n')) {
    let line = raw.trim()
    if (inBlockComment) {
      const end = line.indexOf('*/')
      if (end === -1) continue
      inBlockComment = false
      line = line.slice(end + 2).trim()
    }
    if (line.startsWith('/*')) {
      const end = line.indexOf('*/', 2)
      if (end === -1) {
        inBlockComment = true
        continue
      }
      line = line.slice(end + 2).trim()
    }
    if (line === '' || line.startsWith('//') || /^#\s*pragma\b/.test(line)) continue
    return /^#\s*include\s*<bits\/stdc\+\+\.h>/.test(line)
  }
  return false
}

// Identifies a PCH build: it must change whenever anything that goes into the PCH changes.
function pchKey(flags: string[]): string {
  // `version` is exported by the package but missing from its type definitions.
  const clangVersion = (yowasp as unknown as { version: string }).version
  return [clangVersion, ...flags, ...LANGUAGE_FLAGS, BITS_STDCXX_H].join('\n')
}

// File name for the PCH built with these flags: a hash of its key, so a PCH built from a
// different compiler, flags or header is never used by mistake.
export async function pchFileName(flags: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pchKey(flags)))
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
  return `bits-${hex}.pch`
}

// Builds the precompiled header for these user flags (run by scripts/build-pch.ts at deploy time;
// it takes 10-15 s, too long to do in a visitor's browser).
export async function buildPch(flags: string[]): Promise<Uint8Array> {
  const { files, log } = await clang(
    [...flags, ...LANGUAGE_FLAGS, '-x', 'c++-header', 'include/bits/stdc++.h', '-o', 'bits.pch', '-Xclang', '-fno-pch-timestamp'],
    { include: INCLUDE_DIR },
  )
  const pch = files?.['bits.pch']
  if (!(pch instanceof Uint8Array)) throw new Error(`Building the PCH failed:\n${log}`)
  return pch
}

// Compiles one C++ source file to a wasm32-wasi program with Clang running as WebAssembly.
// The first call downloads and compiles the toolchain; later calls reuse it.
export async function compile(
  source: string,
  flags: string[] = DEFAULT_FLAGS,
  options: { onDownload?: (progress: DownloadProgress) => void; pch?: Uint8Array } = {},
): Promise<CompileResult> {
  const usePch = options.pch !== undefined && canUsePch(source)
  const { files, log } = await clang(
    [
      ...flags,
      ...LANGUAGE_FLAGS,
      ...(usePch ? ['-include-pch', 'bits.pch'] : []),
      'main.cpp',
      '-o',
      'main.wasm',
      ...LINK_FLAGS,
    ],
    {
      'main.cpp': source,
      include: INCLUDE_DIR,
      libcxx: await loadLibcxx(),
      ...(usePch ? { 'bits.pch': options.pch } : {}),
    },
    options.onDownload,
  )
  const wasm = files?.['main.wasm']
  if (!(wasm instanceof Uint8Array)) return { ok: false, log: log || 'Compiler produced no output.', usedPch: usePch }
  return { ok: true, wasm, log, usedPch: usePch }
}

async function clang(
  args: string[],
  files: Parameters<(typeof commands)['clang++']>[1],
  onDownload?: (progress: DownloadProgress) => void,
): Promise<{ files: Awaited<ReturnType<(typeof commands)['clang++']>> | null; log: string }> {
  const decoder = new TextDecoder()
  let log = ''
  const collect = (bytes: Uint8Array | null) => {
    if (bytes) log += decoder.decode(bytes, { stream: true })
  }
  try {
    const out = await commands['clang++'](args, files, {
      stdout: collect,
      stderr: collect,
      decodeASCII: false,
      fetchProgress: onDownload && ((e) => onDownload({ done: e.doneLength, total: e.totalLength })),
    })
    return { files: out ?? null, log }
  } catch (e) {
    if (e instanceof Exit) return { files: null, log }
    throw e
  }
}
