export type Diagnostic = {
  line: number // 1-based
  column: number // 1-based
  severity: 'error' | 'warning'
  message: string
}

// Picks `main.cpp:LINE:COL: error|warning: message` lines out of Clang's output.
export function parseDiagnostics(log: string): Diagnostic[] {
  const result: Diagnostic[] = []
  for (const m of log.matchAll(/^main\.cpp:(\d+):(\d+): (error|fatal error|warning): (.*)$/gm)) {
    result.push({
      line: Number(m[1]),
      column: Number(m[2]),
      severity: m[3] === 'warning' ? 'warning' : 'error',
      message: m[4],
    })
  }
  return result
}
