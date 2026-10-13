// Runs one compiled program at a time. The main thread terminates this worker on a time limit,
// which is the only way to stop a busy wasm loop.
//
// If the program overflows the browser's native stack (deep recursion), it is run again in the
// wasmi interpreter, whose call stack lives in memory ("slow mode").
import { run } from './run.ts'
import { runInterpreted } from './interp.ts'
import { isStackOverflow } from './errors.ts'

export type RunRequest = { wasm: Uint8Array<ArrayBuffer>; stdin: string }
export type RunnerMessage =
  | { type: 'started' }
  | { type: 'output'; stream: 'stdout' | 'stderr'; bytes: Uint8Array<ArrayBuffer> }
  // The fast run overflowed the stack; its output is void and a slow-mode run follows.
  | { type: 'retrying-slow' }
  | { type: 'finished'; exitCode: number; timeMs: number; memoryBytes: number; error?: string; slow: boolean }

const post = (msg: RunnerMessage, transfer: Transferable[] = []) => self.postMessage(msg, { transfer })

// Output is sent in batches so a program printing line by line doesn't flood the main thread.
// The worker can't run timers while the program is busy, so a batch is only sent from inside a
// write: the first write after a quiet period goes out at once (so "print, then hang forever"
// still shows the print on a time limit), and later ones at most every FLUSH_MS.
const FLUSH_BYTES = 64 * 1024
const FLUSH_MS = 20

function makeSink(stream: 'stdout' | 'stderr') {
  let chunks: Uint8Array[] = []
  let size = 0
  let lastFlush = -Infinity
  const flush = () => {
    if (size === 0) return
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const c of chunks) {
      bytes.set(c, offset)
      offset += c.length
    }
    chunks = []
    size = 0
    lastFlush = performance.now()
    post({ type: 'output', stream, bytes }, [bytes.buffer])
  }
  const write = (bytes: Uint8Array) => {
    chunks.push(bytes)
    size += bytes.length
    if (size >= FLUSH_BYTES || performance.now() - lastFlush >= FLUSH_MS) flush()
  }
  return { write, flush }
}

async function attempt(slow: boolean, wasm: Uint8Array<ArrayBuffer>, stdin: string) {
  const stdout = makeSink('stdout')
  const stderr = makeSink('stderr')
  const options = {
    onStart: () => post({ type: 'started' }),
    onStdout: stdout.write,
    onStderr: stderr.write,
  }
  const result = slow ? await runInterpreted(wasm, stdin, options) : await run(wasm, stdin, options)
  return { result, flush: () => (stdout.flush(), stderr.flush()) }
}

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { wasm, stdin } = e.data
  let slow = false
  let { result, flush } = await attempt(slow, wasm, stdin)
  if (result.error && isStackOverflow(result.error)) {
    // Output still buffered from the fast run is dropped along with what was already sent.
    post({ type: 'retrying-slow' })
    slow = true
    ;({ result, flush } = await attempt(slow, wasm, stdin))
  }
  flush()
  const { exitCode, timeMs, memoryBytes, error } = result
  post({ type: 'finished', exitCode, timeMs, memoryBytes, error, slow })
}
