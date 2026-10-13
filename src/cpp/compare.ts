export type DiffRow = { line: number; expected?: string; actual?: string; same: boolean }

export type Check =
  | { kind: 'none' } // no expected output given
  // `approximate`: some decimal numbers differed but were within the tolerance.
  | { kind: 'pass'; approximate: boolean }
  // `rows` covers the lines around the first difference; `firstDiff` is a 1-based line number.
  | { kind: 'fail'; firstDiff: number; expected?: string; actual?: string; rows: DiffRow[]; more: boolean }

// How many lines of diff to show, starting a little before the first difference.
const DIFF_ROWS = 200
const CONTEXT_BEFORE = 20

// Compares line by line, ignoring trailing spaces on each line and blank lines at the end:
// what most judges accept. With a `tolerance`, decimal numbers also match if their absolute or
// relative error is within it (the usual "error does not exceed 1e-6" rule); whole numbers and
// words still have to match exactly.
export function checkOutput(expected: string, actual: string, tolerance: number | null = null): Check {
  const want = lines(expected)
  if (want.length === 0) return { kind: 'none' }
  const got = lines(actual)

  const total = Math.max(want.length, got.length)
  const same: boolean[] = []
  let first = -1
  let approximate = false
  for (let i = 0; i < total; i++) {
    const match = compareLines(want[i], got[i], tolerance)
    same.push(match !== 'differs')
    if (match === 'close') approximate = true
    if (match === 'differs' && first === -1) first = i
  }
  if (first === -1) return { kind: 'pass', approximate }

  const start = Math.max(0, first - CONTEXT_BEFORE)
  const end = Math.min(total, start + DIFF_ROWS)
  const rows: DiffRow[] = []
  for (let i = start; i < end; i++) {
    rows.push({ line: i + 1, expected: want[i], actual: got[i], same: same[i] })
  }
  return { kind: 'fail', firstDiff: first + 1, expected: want[first], actual: got[first], rows, more: end < total }
}

function compareLines(want: string | undefined, got: string | undefined, tolerance: number | null) {
  if (want === got) return 'equal'
  if (want === undefined || got === undefined || tolerance === null) return 'differs'
  const a = want.split(/\s+/).filter(Boolean)
  const b = got.split(/\s+/).filter(Boolean)
  if (a.length !== b.length) return 'differs'
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && !closeNumbers(a[i], b[i], tolerance)) return 'differs'
  }
  return 'close'
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const WHOLE = /^[+-]?\d+$/

function closeNumbers(expected: string, actual: string, tolerance: number): boolean {
  if (!NUMBER.test(expected) || !NUMBER.test(actual)) return false
  // Whole numbers are compared exactly: 7 vs 8 is wrong no matter the tolerance.
  if (WHOLE.test(expected) && WHOLE.test(actual)) return false
  const e = Number(expected)
  const a = Number(actual)
  if (!Number.isFinite(e) || !Number.isFinite(a)) return false
  // A tiny slack absorbs the rounding in parsing both strings.
  return Math.abs(a - e) <= tolerance * Math.max(1, Math.abs(e)) + 1e-15
}

function lines(text: string): string[] {
  const result = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''))
  while (result.length > 0 && result[result.length - 1] === '') result.pop()
  return result
}
