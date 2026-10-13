// Runs a compiled program inside the wasmi interpreter (interp/, built to interp.wasm).
// Much slower than the browser's own engine, but the call stack lives in memory, so deep
// recursion works. Used as a fallback when a normal run overflows the stack.
import type { RunOptions, RunResult } from './run.ts'

type InterpExports = {
  memory: WebAssembly.Memory
  alloc(len: number): number
  run(wasmPtr: number, wasmLen: number, stdinPtr: number, stdinLen: number): number
  error_ptr(): number
  error_len(): number
}

let interpreter: Promise<WebAssembly.Module> | null = null

function loadInterpreter(): Promise<WebAssembly.Module> {
  const url = new URL('./interp.wasm', import.meta.url)
  if (url.protocol === 'file:') {
    // Node (scripts/spike.ts): fetch() can't read files. The module name is a variable so the
    // browser build doesn't try to bundle it.
    const fsModule = 'node:fs/promises'
    return import(/* @vite-ignore */ fsModule)
      .then((fs: { readFile(url: URL): Promise<Uint8Array<ArrayBuffer>> }) => fs.readFile(url))
      .then((bytes) => WebAssembly.compile(bytes))
  }
  return WebAssembly.compileStreaming(fetch(url))
}

export async function runInterpreted(
  wasm: Uint8Array<ArrayBuffer>,
  stdin: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const module = await (interpreter ??= loadInterpreter())
  const out: Uint8Array[] = []
  const err: Uint8Array[] = []
  const onStdout = options.onStdout ?? ((bytes: Uint8Array) => out.push(bytes))
  const onStderr = options.onStderr ?? ((bytes: Uint8Array) => err.push(bytes))

  let exports: InterpExports | null = null
  const memory = () => new Uint8Array(exports!.memory.buffer)
  const instance = await WebAssembly.instantiate(module, {
    host: {
      write(fd: number, ptr: number, len: number) {
        const bytes = memory().slice(ptr, ptr + len)
        if (fd === 1) onStdout(bytes)
        else onStderr(bytes)
      },
      monotonic_ns: () => BigInt(Math.round(performance.now() * 1e6)),
      realtime_ns: () => BigInt(Date.now()) * 1_000_000n,
      random_fill(ptr: number, len: number) {
        // getRandomValues fills at most 64 KB per call.
        for (let i = 0; i < len; i += 65536) {
          crypto.getRandomValues(memory().subarray(ptr + i, ptr + Math.min(len, i + 65536)))
        }
      },
    },
  })
  exports = instance.exports as unknown as InterpExports

  const input = new TextEncoder().encode(stdin)
  const wasmPtr = exports.alloc(wasm.length)
  memory().set(wasm, wasmPtr)
  const stdinPtr = exports.alloc(input.length)
  memory().set(input, stdinPtr)

  options.onStart?.()
  const start = performance.now()
  let exitCode: number
  let error: string | undefined
  try {
    exitCode = exports.run(wasmPtr, wasm.length, stdinPtr, input.length)
    if (exitCode === -1) {
      exitCode = 1
      const ptr = exports.error_ptr()
      error = new TextDecoder().decode(memory().slice(ptr, ptr + exports.error_len()))
    }
  } catch (e) {
    // The interpreter itself failed, most likely out of memory.
    exitCode = 1
    error = e instanceof Error ? e.message : String(e)
  }
  const timeMs = performance.now() - start

  const decode = (chunks: Uint8Array[]) => {
    const decoder = new TextDecoder()
    return chunks.map((c) => decoder.decode(c, { stream: true })).join('') + decoder.decode()
  }
  return { exitCode, stdout: decode(out), stderr: decode(err), timeMs, error }
}
