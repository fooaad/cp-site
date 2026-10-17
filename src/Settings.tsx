import { useEffect, useRef, useState } from 'react'
import { OPTIMIZATIONS, STANDARDS, TOLERANCES, stdLabel, type Options } from './options.ts'

type Props = { options: Options; onChange: (next: Options) => void }

// One button that says what is active in plain words ("C++20 · Optimized"), opening a panel
// where each choice is explained, instead of bare "-O2" and "±1e-6" dropdowns.
export function Settings({ options, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const summary = `${stdLabel(options.std)} · ${options.opt === '-O2' ? 'Optimized' : 'Not optimized'}`

  return (
    <div className="settings" ref={root}>
      <button
        className="settings-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        title="Compiler and checking settings"
      >
        <span aria-hidden="true">⚙</span> {summary} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="settings-panel" role="dialog" aria-label="Settings">
          <Choice
            legend="C++ version"
            help="Newer versions add features like ranges and std::format. Codeforces offers all three."
            value={options.std}
            choices={STANDARDS.map((s) => ({ value: s, label: stdLabel(s) }))}
            onChange={(std) => onChange({ ...options, std })}
          />
          <Choice
            legend="Optimization"
            help="On makes your program 2–10× faster, the same way judges compile it. Turn it off only to debug strange behavior."
            value={options.opt}
            choices={OPTIMIZATIONS.map((o) =>
              o === '-O2' ? { value: o, label: 'On', detail: '-O2 · like judges' } : { value: o, label: 'Off', detail: '-O0 · for debugging' },
            )}
            onChange={(opt) => onChange({ ...options, opt })}
          />
          <Choice
            legend="Decimal answers"
            help="How close a decimal answer must be to the expected one to pass. Problems usually say “error at most 10⁻⁶”. Whole numbers and words always have to match exactly."
            value={options.tolerance}
            choices={TOLERANCES.map((t) => ({ value: t, label: t === 'exact' ? 'Exact' : `±${t}` }))}
            onChange={(tolerance) => onChange({ ...options, tolerance })}
          />
        </div>
      )}
    </div>
  )
}

type ChoiceProps<T extends string> = {
  legend: string
  help: string
  value: T
  choices: { value: T; label: string; detail?: string }[]
  onChange: (value: T) => void
}

function Choice<T extends string>({ legend, help, value, choices, onChange }: ChoiceProps<T>) {
  return (
    <fieldset className="choice">
      <legend>{legend}</legend>
      <div className="segmented">
        {choices.map((c) => (
          <label key={c.value} className={c.value === value ? 'selected' : undefined}>
            <input
              type="radio"
              name={legend}
              value={c.value}
              checked={c.value === value}
              onChange={() => onChange(c.value)}
            />
            <span className="segment-label">{c.label}</span>
            {c.detail && <span className="segment-detail">{c.detail}</span>}
          </label>
        ))}
      </div>
      <p className="choice-help">{help}</p>
    </fieldset>
  )
}
