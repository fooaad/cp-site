// Long-lived worker that keeps Clang loaded between compiles.
import { compile } from './compile.ts'

export type CompileRequest = { id: number; source: string; flags?: string[] }
export type CompilerMessage =
  | { type: 'download'; done: number; total: number }
  | { type: 'compiled'; id: number; ok: true; wasm: Uint8Array<ArrayBuffer>; log: string }
  | { type: 'compiled'; id: number; ok: false; log: string }
  | { type: 'crashed'; id: number; message: string }

const post = (msg: CompilerMessage, transfer: Transferable[] = []) => self.postMessage(msg, { transfer })

self.onmessage = async (e: MessageEvent<CompileRequest>) => {
  const { id, source, flags } = e.data
  try {
    const result = await compile(source, flags, (p) => post({ type: 'download', ...p }))
    if (result.ok) {
      const wasm = result.wasm.slice() // own buffer, so it can be transferred
      post({ type: 'compiled', id, ok: true, wasm, log: result.log }, [wasm.buffer])
    } else {
      post({ type: 'compiled', id, ok: false, log: result.log })
    }
  } catch (err) {
    post({ type: 'crashed', id, message: err instanceof Error ? err.message : String(err) })
  }
}
