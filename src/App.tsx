import { useEffect, useMemo, useRef, useState } from 'react'
import { Editor } from './Editor.tsx'
import { Tests } from './Tests.tsx'
import { Result } from './Result.tsx'
import { outcomeOf, type Outcome } from './outcome.ts'
import { Judge, type JudgeStatus, type Verdict } from './cpp/judge.ts'
import { parseDiagnostics } from './cpp/diagnostics.ts'
import { load, save, loadJSON, saveJSON } from './storage.ts'
import { loadTests, newTest, saveTests, type TestCase } from './tests.ts'
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

const STANDARDS = ['c++17', 'c++20', 'c++23'] as const
const OPTIMIZATIONS = ['-O2', '-O0'] as const
// How far decimal answers may be off (absolute or relative error); 'exact' compares text only.
const TOLERANCES = ['1e-6', '1e-9', '1e-4', 'exact'] as const
type Options = {
  std: (typeof STANDARDS)[number]
  opt: (typeof OPTIMIZATIONS)[number]
  tolerance: (typeof TOLERANCES)[number]
}
const DEFAULT_OPTIONS: Options = { std: 'c++20', opt: '-O2', tolerance: '1e-6' }

// Fields missing from older saved options fall back to their defaults.
function parseOptions(value: unknown): Options {
  const v = value as Partial<Options> | null
  return {
    std: STANDARDS.find((s) => s === v?.std) ?? DEFAULT_OPTIONS.std,
    opt: OPTIMIZATIONS.find((o) => o === v?.opt) ?? DEFAULT_OPTIONS.opt,
    tolerance: TOLERANCES.find((t) => t === v?.tolerance) ?? DEFAULT_OPTIONS.tolerance,
  }
}

export default function App() {
  const [initialCode] = useState(() => load('code') ?? TEMPLATE)
  const code = useRef(initialCode)
  const [tests, setTests] = useState<TestCase[]>(loadTests)
  const [selectedId, setSelectedId] = useState(() => tests[0].id)
  const [options, setOptions] = useState<Options>(() => loadJSON('options', parseOptions) ?? DEFAULT_OPTIONS)
  const tolerance = options.tolerance === 'exact' ? null : Number(options.tolerance)
  const [results, setResults] = useState<Record<string, Verdict>>({})
  const [runningId, setRunningId] = useState<string | null>(null)
  const [status, setStatus] = useState<JudgeStatus>({ kind: 'idle' })
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const judge = useRef<Judge | null>(null)
  const stopRequested = useRef(false)

  const flags = useMemo(() => [`-std=${options.std}`, options.opt], [options.std, options.opt])
  const initialFlags = useRef(flags)

  useEffect(() => {
    const j = new Judge(setStatus)
    judge.current = j
    j.warmUp(initialFlags.current).then(() => setReady(true))
    return () => j.dispose()
  }, [])

  // Fetch the precompiled header for newly chosen options before the next Run.
  useEffect(() => {
    if (ready) judge.current?.prefetch(flags)
  }, [ready, flags])

  // Compiler messages are the same for every test; take them from any result.
  const compileLog = useMemo(() => {
    const v = Object.values(results)[0]
    return v && 'log' in v ? v.log : ''
  }, [results])
  const diagnostics = useMemo(() => parseDiagnostics(compileLog), [compileLog])

  const outcomes = useMemo(() => {
    const map: Record<string, Outcome | 'running'> = {}
    for (const t of tests) {
      if (t.id === runningId) map[t.id] = 'running'
      else if (results[t.id]) map[t.id] = outcomeOf(results[t.id], t.expected, tolerance)
    }
    return map
  }, [tests, results, runningId, tolerance])

  // "2 of 3 passed", counting only tests that have an expected output and ran to the end.
  const summary = useMemo(() => {
    if (busy || Object.values(results).some((v) => v.kind === 'compile-error')) return null
    const checked = tests.filter((t) => outcomes[t.id] && !['ran', 'stopped', 'running'].includes(outcomes[t.id]))
    if (checked.length === 0) return null
    const passed = checked.filter((t) => outcomes[t.id] === 'pass').length
    return { passed, total: checked.length }
  }, [tests, results, outcomes, busy])

  function updateTests(next: TestCase[]) {
    setTests(next)
    saveTests(next)
  }

  function updateOptions(next: Options) {
    setOptions(next)
    saveJSON('options', next)
  }

  async function runAll() {
    if (!judge.current || busy) return
    setBusy(true)
    stopRequested.current = false
    setResults({})
    const snapshot = tests
    const done: Record<string, Verdict> = {}
    try {
      for (const test of snapshot) {
        if (stopRequested.current) break
        setRunningId(test.id)
        const verdict = await judge.current.run(code.current, test.input, flags, TIME_LIMIT_MS)
        if (verdict.kind === 'compile-error') {
          // The same for every test: show it everywhere and stop.
          setResults(Object.fromEntries(snapshot.map((t) => [t.id, verdict])))
          return
        }
        done[test.id] = verdict
        setResults({ ...done })
      }
      // If the selected test passed but another didn't, show the first one that didn't.
      const notPassed = (t: TestCase) => {
        const o = done[t.id] && outcomeOf(done[t.id], t.expected, tolerance)
        return o !== undefined && o !== 'pass' && o !== 'ran'
      }
      const selected = snapshot.find((t) => t.id === selectedId)
      const firstFailing = snapshot.find(notPassed)
      if (firstFailing && selected && !notPassed(selected)) setSelectedId(firstFailing.id)
    } finally {
      setRunningId(null)
      setBusy(false)
    }
  }

  function stop() {
    stopRequested.current = true
    judge.current?.stop()
  }

  const selected = tests.find((t) => t.id === selectedId) ?? tests[0]
  const runningIndex = tests.findIndex((t) => t.id === runningId)

  return (
    <div className="app">
      <header className="toolbar">
        <h1>cp-site</h1>
        <select
          aria-label="C++ standard"
          value={options.std}
          onChange={(e) => updateOptions({ ...options, std: e.target.value as Options['std'] })}
        >
          {STANDARDS.map((s) => (
            <option key={s} value={s}>
              {s.replace('c++', 'C++')}
            </option>
          ))}
        </select>
        <select
          aria-label="Optimization"
          title="-O2 runs faster; -O0 compiles a little faster"
          value={options.opt}
          onChange={(e) => updateOptions({ ...options, opt: e.target.value as Options['opt'] })}
        >
          {OPTIMIZATIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <span className="status" aria-live="polite">
          {statusText(status, ready, runningIndex, tests.length)}
        </span>
        {busy && status.kind === 'running' ? (
          <button className="stop" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="run" onClick={runAll} disabled={busy} title="Run all tests (Ctrl/Cmd+Enter)">
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
            onRun={runAll}
          />
        </section>

        <section className="pane io-pane">
          <Tests
            tests={tests}
            selectedId={selected.id}
            outcomes={outcomes}
            onSelect={setSelectedId}
            onAdd={() => {
              const t = newTest()
              updateTests([...tests, t])
              setSelectedId(t.id)
            }}
            onRemove={(id) => {
              const i = tests.findIndex((t) => t.id === id)
              const next = tests.filter((t) => t.id !== id)
              updateTests(next)
              if (id === selected.id) setSelectedId(next[Math.min(i, next.length - 1)].id)
            }}
            onChange={(id, change) => updateTests(tests.map((t) => (t.id === id ? { ...t, ...change } : t)))}
            onRun={runAll}
          />
          <div className="pane-title result-title">
            Output
            {summary && (
              <span className={`summary ${summary.passed === summary.total ? 'good' : 'bad'}`}>
                {summary.passed} of {summary.total} passed
              </span>
            )}
            <label className="tolerance" title="How far decimal answers may be off (absolute or relative error)">
              Decimals
              <select
                value={options.tolerance}
                onChange={(e) => updateOptions({ ...options, tolerance: e.target.value as Options['tolerance'] })}
              >
                {TOLERANCES.map((t) => (
                  <option key={t} value={t}>
                    {t === 'exact' ? 'exact' : `±${t}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Result verdict={results[selected.id]} expected={selected.expected} tolerance={tolerance} />
        </section>
      </main>
    </div>
  )
}

function statusText(status: JudgeStatus, ready: boolean, runningIndex: number, total: number): string {
  const which = total > 1 && runningIndex >= 0 ? ` test ${runningIndex + 1} of ${total}` : ''
  switch (status.kind) {
    case 'downloading': {
      const pct = status.total ? Math.floor((status.done / status.total) * 100) : 0
      return `Loading compiler… ${pct}%`
    }
    case 'compiling':
      return 'Compiling…'
    case 'running':
      return status.slow ? `Running${which} in slow mode…` : `Running${which}…`
    case 'idle':
      return ready ? 'Ready' : 'Loading compiler…'
  }
}
