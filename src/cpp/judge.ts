// Main-thread side: compiles in a long-lived worker, runs in a separate worker that can be killed.
import type { CompileRequest, CompilerMessage } from './compiler.worker.ts'
import type { RunRequest, RunnerMessage } from './runner.worker.ts'
import { describeRuntimeError } from './errors.ts'

export type Verdict =
  | { kind: 'compile-error'; log: string }
  | { kind: 'ok'; stdout: string; stderr: string; timeMs: number; log: string }
  | { kind: 'runtime-error'; message: string; stdout: string; stderr: string; timeMs: number; log: string }
  | { kind: 'time-limit'; stdout: string; stderr: string; timeMs: number; log: string }
  | { kind: 'stopped'; stdout: string; stderr: string }

export type JudgeStatus =
  | { kind: 'idle' }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'compiling' }
  | { kind: 'running' }

// Keep at most this much output; a runaway print loop would otherwise eat all memory.
const OUTPUT_LIMIT = 4 * 1024 * 1024

export class Judge {
  private compiler = new Worker(new URL('./compiler.worker.ts', import.meta.url), { type: 'module' })
  private runner: Worker | null = null
  private nextId = 1
  private pending = new Map<number, (msg: CompilerMessage) => void>()
  private lastBuild: { key: string; wasm: Uint8Array<ArrayBuffer>; log: string } | null = null
  private stopCurrent: (() => void) | null = null
  private onStatus: (status: JudgeStatus) => void

  constructor(onStatus: (status: JudgeStatus) => void) {
    this.onStatus = onStatus
    this.compiler.onmessage = (e: MessageEvent<CompilerMessage>) => {
      const msg = e.data
      if (msg.type === 'download') {
        this.onStatus({ kind: 'downloading', done: msg.done, total: msg.total })
        return
      }
      this.pending.get(msg.id)?.(msg)
      this.pending.delete(msg.id)
    }
  }

  // Loads the toolchain in the background so the first Run is fast.
  async warmUp() {
    await this.compile('int main() {}', [])
    this.onStatus({ kind: 'idle' })
  }

  async run(source: string, stdin: string, flags: string[], timeLimitMs: number): Promise<Verdict> {
    try {
      const key = JSON.stringify([source, flags])
      if (this.lastBuild?.key !== key) {
        this.onStatus({ kind: 'compiling' })
        const msg = await this.compile(source, flags)
        if (msg.type === 'crashed') return { kind: 'compile-error', log: `The compiler crashed: ${msg.message}` }
        if (msg.type !== 'compiled') throw new Error('unexpected compiler message')
        if (!msg.ok) return { kind: 'compile-error', log: msg.log }
        this.lastBuild = { key, wasm: msg.wasm, log: msg.log }
      }
      this.onStatus({ kind: 'running' })
      return await this.execute(this.lastBuild.wasm, this.lastBuild.log, stdin, timeLimitMs)
    } finally {
      this.onStatus({ kind: 'idle' })
    }
  }

  stop() {
    this.stopCurrent?.()
  }

  dispose() {
    this.stop()
    this.compiler.terminate()
    this.runner?.terminate()
  }

  private compile(source: string, flags: string[]): Promise<CompilerMessage> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.compiler.postMessage({ id, source, flags } satisfies CompileRequest)
    })
  }

  private execute(wasm: Uint8Array<ArrayBuffer>, log: string, stdin: string, timeLimitMs: number): Promise<Verdict> {
    const runner = (this.runner ??= new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module' }))
    const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() }
    const text = { stdout: '', stderr: '' }
    let startedAt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    return new Promise<Verdict>((resolve) => {
      const kill = (verdict: Verdict) => {
        clearTimeout(timer)
        runner.terminate()
        this.runner = null
        finish(verdict)
      }
      const finish = (verdict: Verdict) => {
        clearTimeout(timer)
        this.stopCurrent = null
        runner.onmessage = null
        resolve(verdict)
      }
      this.stopCurrent = () => kill({ kind: 'stopped', ...text })

      runner.onmessage = (e: MessageEvent<RunnerMessage>) => {
        const msg = e.data
        if (msg.type === 'started') {
          startedAt = performance.now()
          timer = setTimeout(
            () => kill({ kind: 'time-limit', ...text, timeMs: performance.now() - startedAt, log }),
            timeLimitMs,
          )
        } else if (msg.type === 'output') {
          if (text[msg.stream].length < OUTPUT_LIMIT) {
            text[msg.stream] += decoders[msg.stream].decode(msg.bytes, { stream: true })
            if (text[msg.stream].length >= OUTPUT_LIMIT) text[msg.stream] += '\n… output truncated (over 4 MB)'
          }
        } else if (msg.error) {
          finish({ kind: 'runtime-error', message: describeRuntimeError(msg.error), ...text, timeMs: msg.timeMs, log })
        } else if (msg.exitCode !== 0) {
          const message = `The program exited with code ${msg.exitCode}.`
          finish({ kind: 'runtime-error', message, ...text, timeMs: msg.timeMs, log })
        } else {
          finish({ kind: 'ok', ...text, timeMs: msg.timeMs, log })
        }
      }
      runner.postMessage({ wasm, stdin } satisfies RunRequest)
    })
  }
}
