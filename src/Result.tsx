import type { Verdict } from './cpp/judge.ts'
import { checkOutput, type Check } from './cpp/compare.ts'

type Props = { verdict: Verdict | undefined; expected: string; tolerance: number | null }

export function Result({ verdict, expected, tolerance }: Props) {
  if (!verdict) return <div className="output empty">Press Run to compile and run your code on every test.</div>

  if (verdict.kind === 'compile-error') {
    return (
      <div className="output">
        <div className="verdict bad">Compilation error</div>
        <pre>{verdict.log}</pre>
      </div>
    )
  }

  const check: Check = verdict.kind === 'ok' ? checkOutput(expected, verdict.stdout, tolerance) : { kind: 'none' }
  let head: { text: string; tone: 'good' | 'bad' | 'warn' | 'plain' }
  let detail: string | undefined
  switch (verdict.kind) {
    case 'ok':
      head =
        check.kind === 'pass'
          ? { text: check.approximate ? `Passed (decimals within ±${tolerance?.toExponential()})` : 'Passed', tone: 'good' }
          : check.kind === 'fail'
            ? { text: 'Wrong answer', tone: 'bad' }
            : { text: 'Finished', tone: 'plain' }
      if (check.kind === 'fail') {
        detail = `Line ${check.firstDiff}: expected ${show(check.expected)}, got ${show(check.actual)}.`
      }
      break
    case 'runtime-error':
      head = { text: 'Runtime error', tone: 'bad' }
      detail = verdict.message
      break
    case 'time-limit':
      head = {
        text: `Time limit exceeded (${verdict.timeLimitMs / 1000} s${verdict.slow ? ' in slow mode' : ''})`,
        tone: 'warn',
      }
      detail = 'Stopped the program. Output so far is shown below.'
      break
    case 'stopped':
      head = { text: 'Stopped', tone: 'warn' }
      break
  }

  const stats =
    verdict.kind === 'ok' || verdict.kind === 'runtime-error'
      ? [formatMs(verdict.timeMs), verdict.memoryBytes !== undefined ? formatBytes(verdict.memoryBytes) : null]
      : []

  return (
    <div className="output">
      <div className="verdict-line">
        <span className={`verdict ${head.tone}`}>{head.text}</span>
        {stats.filter(Boolean).map((s) => (
          <span key={s} className="stat">
            {s}
          </span>
        ))}
      </div>
      {verdict.slow && (
        <p className="slow-note">
          Slow mode: the recursion went deeper than the browser allows, so the program was run again in an
          interpreter. It is about 25× slower, so the time is not comparable to a judge.
        </p>
      )}
      {detail && <p className="detail">{detail}</p>}
      {check.kind === 'fail' ? <Diff check={check} /> : <StreamText text={verdict.stdout} empty="(no output)" />}
      {verdict.stderr && (
        <>
          <div className="stream-label">stderr</div>
          <StreamText text={verdict.stderr} className="stderr" />
        </>
      )}
    </div>
  )
}

function Diff({ check }: { check: Extract<Check, { kind: 'fail' }> }) {
  return (
    <div className="diff">
      <table>
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Expected</th>
            <th>Your output</th>
          </tr>
        </thead>
        <tbody>
          {check.rows.map((r) => (
            <tr key={r.line} className={r.same ? undefined : 'differs'}>
              <td className="num">{r.line}</td>
              <td>{r.expected ?? <span className="missing">(missing)</span>}</td>
              <td>{r.actual ?? <span className="missing">(missing)</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {check.more && <p className="truncated">More lines follow; only the first {check.rows.length} are shown.</p>}
    </div>
  )
}

function show(line: string | undefined) {
  if (line === undefined) return 'no more lines'
  return line.length > 60 ? `"${line.slice(0, 60)}…"` : `"${line}"`
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
          Showing the first 100 KB of {formatBytes(text.length)}.{' '}
          <button onClick={() => navigator.clipboard?.writeText(text)}>Copy all</button>
        </p>
      )}
    </>
  )
}

function formatMs(ms: number) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
