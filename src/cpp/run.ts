import { WASI, WASIProcExit, File, OpenFile, ConsoleStdout, wasi as defs } from '@bjorn3/browser_wasi_shim'

// stdout/stderr that wasi-libc doesn't take for a terminal. A terminal gets line buffering, which
// means one call into JavaScript per line: printing 1e6 lines took ~0.9 s. As a file, stdout is
// buffered in blocks like on a judge (and, like on a judge, unflushed output is lost on a time limit).
class OutputFd extends ConsoleStdout {
  fd_fdstat_get() {
    const fdstat = new defs.Fdstat(defs.FILETYPE_REGULAR_FILE, 0)
    fdstat.fs_rights_base = BigInt(defs.RIGHTS_FD_WRITE)
    return { ret: 0, fdstat }
  }
}

export type RunResult = {
  exitCode: number
  stdout: string
  stderr: string
  timeMs: number
  // Set when the program crashed (trap, abort, stack overflow) instead of exiting.
  error?: string
}

export type RunOptions = {
  // Experiment: run on a separate JSPI stack (Chrome only; gains little depth, see PLAN.md).
  jspi?: boolean
  // Called right before the program starts, after the module is compiled.
  onStart?: () => void
  // Receive output as it is written. Output passed here is not included in the result.
  onStdout?: (bytes: Uint8Array) => void
  onStderr?: (bytes: Uint8Array) => void
}

// Runs a compiled wasm32-wasi program with `stdin` as its standard input.
// Runs synchronously on the calling thread, so call it from a Web Worker in the browser.
export async function run(wasm: Uint8Array<ArrayBuffer>, stdin: string, options: RunOptions = {}): Promise<RunResult> {
  const out: Uint8Array[] = []
  const err: Uint8Array[] = []
  const wasi = new WASI(['main'], [], [
    new OpenFile(new File(new TextEncoder().encode(stdin))),
    new OutputFd(options.onStdout ?? ((bytes) => out.push(bytes))),
    new OutputFd(options.onStderr ?? ((bytes) => err.push(bytes))),
  ])

  const module = await WebAssembly.compile(wasm)
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport })

  options.onStart?.()
  const start = performance.now()
  let exitCode = 0
  let error: string | undefined
  try {
    if (options.jspi) {
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
