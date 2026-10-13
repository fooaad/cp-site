export type DiffRow = { line: number; expected?: string; actual?: string; same: boolean }

export type Check =
  | { kind: 'none' } // no expected output given
  | { kind: 'pass' }
  // `rows` covers the lines around the first difference; `firstDiff` is a 1-based line number.
  | { kind: 'fail'; firstDiff: number; expected?: string; actual?: string; rows: DiffRow[]; more: boolean }

// How many lines of diff to show, starting a little before the first difference.
const DIFF_ROWS = 200
const CONTEXT_BEFORE = 20

// Compares line by line, ignoring trailing spaces on each line and blank lines at the end:
// what most judges accept.
export function checkOutput(expected: string, actual: string): Check {
  const want = lines(expected)
  if (want.length === 0) return { kind: 'none' }
  const got = lines(actual)

  const total = Math.max(want.length, got.length)
  let first = -1
  for (let i = 0; i < total; i++) {
    if (want[i] !== got[i]) {
      first = i
      break
    }
  }
  if (first === -1) return { kind: 'pass' }

  const start = Math.max(0, first - CONTEXT_BEFORE)
  const end = Math.min(total, start + DIFF_ROWS)
  const rows: DiffRow[] = []
  for (let i = start; i < end; i++) {
    rows.push({ line: i + 1, expected: want[i], actual: got[i], same: want[i] === got[i] })
  }
  return { kind: 'fail', firstDiff: first + 1, expected: want[first], actual: got[first], rows, more: end < total }
}

function lines(text: string): string[] {
  const result = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''))
  while (result.length > 0 && result[result.length - 1] === '') result.pop()
  return result
}
