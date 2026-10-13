import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { indentWithTab } from '@codemirror/commands'
import { cpp } from '@codemirror/lang-cpp'
import { oneDark } from '@codemirror/theme-one-dark'
import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import type { Diagnostic } from './cpp/diagnostics.ts'

type Props = {
  initialCode: string
  diagnostics: Diagnostic[]
  onChange: (code: string) => void
  onRun: () => void
}

export function Editor({ initialCode, diagnostics, onChange, onRun }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Keep the latest callbacks without recreating the editor.
  const callbacks = useRef({ onChange, onRun })
  // The editor owns its document after creation; initialCode is only the starting text.
  const startingCode = useRef(initialCode)
  useEffect(() => {
    callbacks.current = { onChange, onRun }
  })

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      doc: startingCode.current,
      extensions: [
        Prec.highest(
          keymap.of([
            // Cmd+Enter on Mac, Ctrl+Enter everywhere
            { key: 'Mod-Enter', run: () => (callbacks.current.onRun(), true) },
            { key: 'Ctrl-Enter', run: () => (callbacks.current.onRun(), true) },
          ]),
        ),
        basicSetup,
        keymap.of([indentWithTab]),
        cpp(),
        oneDark,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) callbacks.current.onChange(u.state.doc.toString())
        }),
      ],
    })
    view.current = v
    return () => v.destroy()
  }, [])

  useEffect(() => {
    const v = view.current
    if (!v) return
    const doc = v.state.doc
    const marks: CmDiagnostic[] = diagnostics
      .filter((d) => d.line <= doc.lines)
      .map((d) => {
        const line = doc.line(d.line)
        const from = Math.min(line.from + d.column - 1, line.to)
        return { from, to: Math.max(from, line.to), severity: d.severity, message: d.message }
      })
    v.dispatch(setDiagnostics(v.state, marks))
  }, [diagnostics])

  return <div className="editor" ref={host} />
}
