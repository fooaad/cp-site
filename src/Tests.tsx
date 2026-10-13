import type { KeyboardEvent } from 'react'
import type { TestCase } from './tests.ts'
import type { Outcome } from './outcome.ts'

type Props = {
  tests: TestCase[]
  selectedId: string
  outcomes: Record<string, Outcome | 'running'>
  onSelect: (id: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onChange: (id: string, change: Partial<TestCase>) => void
  onRun: () => void
}

const MARKS: Record<Outcome | 'running', { mark: string; label: string }> = {
  pass: { mark: '✓', label: 'passed' },
  fail: { mark: '✗', label: 'wrong answer' },
  error: { mark: '!', label: 'error' },
  'time-limit': { mark: '⏱', label: 'time limit exceeded' },
  stopped: { mark: '■', label: 'stopped' },
  ran: { mark: '•', label: 'ran (no expected output)' },
  running: { mark: '…', label: 'running' },
}

export function Tests({ tests, selectedId, outcomes, onSelect, onAdd, onRemove, onChange, onRun }: Props) {
  const selected = tests.find((t) => t.id === selectedId) ?? tests[0]
  const runOnCtrlEnter = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      onRun()
    }
  }

  return (
    <>
      <div className="test-tabs" role="tablist" aria-label="Test cases">
        {tests.map((t, i) => {
          const outcome = outcomes[t.id]
          const mark = outcome && MARKS[outcome]
          return (
            <div key={t.id} className={`test-tab ${t.id === selected.id ? 'selected' : ''}`}>
              <button
                role="tab"
                aria-selected={t.id === selected.id}
                onClick={() => onSelect(t.id)}
                title={mark ? `Test ${i + 1}: ${mark.label}` : `Test ${i + 1}`}
              >
                Test {i + 1}
                {mark && <span className={`mark ${outcome}`}>{mark.mark}</span>}
              </button>
              {tests.length > 1 && (
                <button className="remove" onClick={() => onRemove(t.id)} aria-label={`Delete test ${i + 1}`}>
                  ×
                </button>
              )}
            </div>
          )
        })}
        <button className="add-test" onClick={onAdd} aria-label="Add a test">
          +
        </button>
      </div>

      <label className="pane-title" htmlFor="stdin">
        Input
      </label>
      <textarea
        id="stdin"
        className="input-box"
        spellCheck={false}
        value={selected.input}
        onChange={(e) => onChange(selected.id, { input: e.target.value })}
        onKeyDown={runOnCtrlEnter}
      />
      <label className="pane-title" htmlFor="expected">
        Expected output <span className="optional">optional</span>
      </label>
      <textarea
        id="expected"
        className="expected-box"
        spellCheck={false}
        placeholder="Paste the sample output to check your answer"
        value={selected.expected}
        onChange={(e) => onChange(selected.id, { expected: e.target.value })}
        onKeyDown={runOnCtrlEnter}
      />
    </>
  )
}
