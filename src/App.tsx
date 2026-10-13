import { useEffect, useMemo, useRef, useState } from 'react'
import { Editor } from './Editor.tsx'
import { Judge, type JudgeStatus, type Verdict } from './cpp/judge.ts'
import { DEFAULT_FLAGS } from './cpp/compile.ts'
import { parseDiagnostics } from './cpp/diagnostics.ts'
import { load, save } from './storage.ts'
import './App.css'

const TIME_LIMIT_MS = 2000

const TEMPLATE = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    long long a, b;
    cin >> a >> b;
    cout << a + b << "\\n";
}
`

export default function App() {
  const [initialCode] = useState(() => load('code') ?? TEMPLATE)
  const code = useRef(initialCode)
  const [input, setInput] = useState(() => load('input') ?? '3 4\n')
  const [status, setStatus] = useState<JudgeStatus>({ kind: 'idle' })
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const judge = useRef<Judge | null>(null)

  useEffect(() => {
    const j = new Judge(setStatus)
    judge.current = j
    j.warmUp().then(() => setReady(true))
    return () => j.dispose()
  }, [])

  const diagnostics = useMemo(
    () => (verdict && 'log' in verdict ? parseDiagnostics(verdict.log) : []),
    [verdict],
  )

  async function runCode() {
    if (!judge.current || busy) return
    setBusy(true)
    try {
      setVerdict(await judge.current.run(code.current, input, DEFAULT_FLAGS, TIME_LIMIT_MS))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="toolbar">
        <h1>cp-site</h1>
        <span className="status" aria-live="polite">
          {statusText(status, ready)}
        </span>
        {busy && status.kind === 'running' ? (
          <button className="stop" onClick={() => judge.current?.stop()}>
            Stop
          </button>
        ) : (
          <button className="run" onClick={runCode} disabled={busy} title="Run (Ctrl/Cmd+Enter)">
            ▶ Run
          </button>
        )}
      </header>

      <main className="workspace">
        <section className="pane code-pane" aria-label="Code">
          <Editor
            initialCode={initialCode}
            diagnostics={diagnostics}
            onChange={(c) => {
              code.current = c
              save('code', c)
            }}
            onRun={runCode}
          />
        </section>

        <section className="pane io-pane">
          <label className="pane-title" htmlFor="stdin">
            Input
          </label>
          <textarea
            id="stdin"
            spellCheck={false}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              save('input', e.target.value)
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                runCode()
              }
            }}
          />
          <div className="pane-title">Output</div>
          <Output verdict={verdict} />
        </section>
      </main>
    </div>
  )
}

function statusText(status: JudgeStatus, ready: boolean): string {
  switch (status.kind) {
    case 'downloading': {
      const pct = status.total ? Math.floor((status.done / status.total) * 100) : 0
      return `Loading compiler… ${pct}%`
    }
    case 'compiling':
      return 'Compiling…'
    case 'running':
      return 'Running…'
    case 'idle':
      return ready ? 'Ready' : 'Loading compiler…'
  }
}

function Output({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return <div className="output empty">Press Run to compile and run your code.</div>

  if (verdict.kind === 'compile-error') {
    return (
      <div className="output">
        <div className="verdict bad">Compilation error</div>
        <pre>{verdict.log}</pre>
      </div>
    )
  }

  let head: { text: string; tone: 'good' | 'bad' | 'warn' }
  let detail: string | undefined
  switch (verdict.kind) {
    case 'ok':
      head = { text: `Finished in ${formatMs(verdict.timeMs)}`, tone: 'good' }
      break
    case 'runtime-error':
      head = { text: `Runtime error after ${formatMs(verdict.timeMs)}`, tone: 'bad' }
      detail = verdict.message
      break
    case 'time-limit':
      head = { text: `Time limit exceeded (${TIME_LIMIT_MS / 1000} s)`, tone: 'warn' }
      detail = 'Stopped the program. Output so far is shown below.'
      break
    case 'stopped':
      head = { text: 'Stopped', tone: 'warn' }
      break
  }

  return (
    <div className="output">
      <div className={`verdict ${head.tone}`}>{head.text}</div>
      {detail && <p className="detail">{detail}</p>}
      <StreamText text={verdict.stdout} empty="(no output)" />
      {verdict.stderr && (
        <>
          <div className="stream-label">stderr</div>
          <StreamText text={verdict.stderr} className="stderr" />
        </>
      )}
    </div>
  )
}

// Rendering megabytes of text makes the page freeze on every layout, so only the start is shown.
const DISPLAY_LIMIT = 100 * 1024

function StreamText({ text, className, empty }: { text: string; className?: string; empty?: string }) {
  if (!text) return empty ? <pre className="muted">{empty}</pre> : null
  const cut = text.length > DISPLAY_LIMIT
  return (
    <>
      <pre className={className}>{cut ? text.slice(0, DISPLAY_LIMIT) : text}</pre>
      {cut && (
        <p className="truncated">
          Showing the first 100 KB of {formatSize(text.length)}.{' '}
          <button onClick={() => navigator.clipboard?.writeText(text)}>Copy all</button>
        </p>
      )}
    </>
  )
}

function formatSize(chars: number) {
  return chars < 1024 * 1024 ? `${Math.round(chars / 1024)} KB` : `${(chars / 1024 / 1024).toFixed(1)} MB`
}

function formatMs(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}
