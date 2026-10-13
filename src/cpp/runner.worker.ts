// Runs one compiled program at a time. The main thread terminates this worker on a time limit,
// which is the only way to stop a busy wasm loop.
import { run } from './run.ts'

export type RunRequest = { wasm: Uint8Array<ArrayBuffer>; stdin: string }
export type RunnerMessage =
  | { type: 'started' }
  | { type: 'output'; stream: 'stdout' | 'stderr'; bytes: Uint8Array<ArrayBuffer> }
  | { type: 'finished'; exitCode: number; timeMs: number; error?: string }

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

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const stdout = makeSink('stdout')
  const stderr = makeSink('stderr')
  const result = await run(e.data.wasm, e.data.stdin, {
    onStart: () => post({ type: 'started' }),
    onStdout: stdout.write,
    onStderr: stderr.write,
  })
  stdout.flush()
  stderr.flush()
  post({ type: 'finished', exitCode: result.exitCode, timeMs: result.timeMs, error: result.error })
}
