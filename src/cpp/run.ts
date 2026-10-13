import { WASI, WASIProcExit, File, OpenFile, ConsoleStdout } from '@bjorn3/browser_wasi_shim'

export type RunResult = {
  exitCode: number
  stdout: string
  stderr: string
  timeMs: number
  // Set when the program crashed (e.g. out-of-bounds access, abort) instead of exiting.
  error?: string
}

// Runs a compiled wasm32-wasi program with `stdin` as its standard input.
// Runs synchronously on the calling thread, so call it from a Web Worker in the browser.
export async function run(
  wasm: Uint8Array<ArrayBuffer>,
  stdin: string,
  options: { jspi?: boolean } = {},
): Promise<RunResult> {
  const out: Uint8Array[] = []
  const err: Uint8Array[] = []
  const wasi = new WASI(['main'], [], [
    new OpenFile(new File(new TextEncoder().encode(stdin))),
    new ConsoleStdout((bytes) => out.push(bytes)),
    new ConsoleStdout((bytes) => err.push(bytes)),
  ])

  const module = await WebAssembly.compile(wasm)
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport })

  const start = performance.now()
  let exitCode = 0
  let error: string | undefined
  try {
    if (options.jspi) {
      // Experiment: WebAssembly.promising runs the export on a separate, engine-managed stack.
      const promising = (WebAssembly as unknown as { promising: (f: unknown) => () => Promise<void> }).promising
      wasi.inst = instance as Parameters<WASI['start']>[0]
      await promising(instance.exports._start)()
    } else {
      exitCode = wasi.start(instance as Parameters<WASI['start']>[0])
    }
  } catch (e) {
    if (e instanceof WASIProcExit) {
      exitCode = e.code
    } else {
      exitCode = 1
      error = e instanceof Error ? e.message : String(e)
    }
  }
  const timeMs = performance.now() - start

  return { exitCode, stdout: decode(out), stderr: decode(err), timeMs, error }
}

function decode(chunks: Uint8Array[]): string {
  const decoder = new TextDecoder()
  return chunks.map((c) => decoder.decode(c, { stream: true })).join('') + decoder.decode()
}
