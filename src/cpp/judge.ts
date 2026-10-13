// Main-thread side: compiles in a long-lived worker, runs in a separate worker that can be killed.
import type { CompileRequest, CompilerMessage } from './compiler.worker.ts'
import type { RunRequest, RunnerMessage } from './runner.worker.ts'
import { describeRuntimeError } from './errors.ts'
import { STACK_BYTES } from './compile.ts'

// `slow`: the program recursed too deep for the browser and was re-run in the interpreter.
// `memoryBytes`: peak memory without the stack reservation; unknown if the run was killed.
type Ran = { stdout: string; stderr: string; timeMs: number; memoryBytes?: number; log: string; slow: boolean }

export type Verdict =
  | { kind: 'compile-error'; log: string }
  | ({ kind: 'ok' } & Ran)
  | ({ kind: 'runtime-error'; message: string } & Ran)
  | ({ kind: 'time-limit'; timeLimitMs: number } & Ran)
  | { kind: 'stopped'; stdout: string; stderr: string; slow: boolean }

export type JudgeStatus =
  | { kind: 'idle' }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'compiling' }
  | { kind: 'running'; slow: boolean }

// The interpreter is ~25x slower, so slow mode gets a longer limit; its times are not
// comparable to a judge's anyway.
export const SLOW_MODE_FACTOR = 15

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
      this.onStatus({ kind: 'running', slow: false })
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
    let decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() }
    const text = { stdout: '', stderr: '' }
    let startedAt = 0
    let slow = false
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
      this.stopCurrent = () => kill({ kind: 'stopped', ...text, slow })

      runner.onmessage = (e: MessageEvent<RunnerMessage>) => {
        const msg = e.data
        if (msg.type === 'started') {
          startedAt = performance.now()
          const limit = slow ? timeLimitMs * SLOW_MODE_FACTOR : timeLimitMs
          timer = setTimeout(
            () => kill({ kind: 'time-limit', timeLimitMs: limit, ...text, timeMs: performance.now() - startedAt, log, slow }),
            limit,
          )
        } else if (msg.type === 'retrying-slow') {
          clearTimeout(timer)
          slow = true
          text.stdout = text.stderr = ''
          decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() }
          this.onStatus({ kind: 'running', slow: true })
        } else if (msg.type === 'output') {
          if (text[msg.stream].length < OUTPUT_LIMIT) {
            text[msg.stream] += decoders[msg.stream].decode(msg.bytes, { stream: true })
            if (text[msg.stream].length >= OUTPUT_LIMIT) text[msg.stream] += '\n… output truncated (over 4 MB)'
          }
        } else if (msg.type === 'finished') {
          const memoryBytes = Math.max(0, msg.memoryBytes - STACK_BYTES)
          const ran = { ...text, timeMs: msg.timeMs, memoryBytes, log, slow }
          if (msg.error) {
            finish({ kind: 'runtime-error', message: describeRuntimeError(msg.error, slow), ...ran })
          } else if (msg.exitCode !== 0) {
            finish({ kind: 'runtime-error', message: `The program exited with code ${msg.exitCode}.`, ...ran })
          } else {
            finish({ kind: 'ok', ...ran })
          }
        }
      }
      runner.postMessage({ wasm, stdin } satisfies RunRequest)
    })
  }
}
