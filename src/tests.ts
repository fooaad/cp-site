import { load, loadJSON, saveJSON } from './storage.ts'

export type TestCase = { id: string; input: string; expected: string }

export function newTest(input = '', expected = ''): TestCase {
  return { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, input, expected }
}

function parseTests(value: unknown): TestCase[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const ok = value.every(
    (t) => t && typeof t.id === 'string' && typeof t.input === 'string' && typeof t.expected === 'string',
  )
  return ok ? (value as TestCase[]) : null
}

export function loadTests(): TestCase[] {
  const saved = loadJSON('tests', parseTests)
  if (saved) return saved
  // Before test cases existed there was a single saved input.
  const oldInput = load('input')
  return [oldInput === null ? newTest('3 4\n', '7\n') : newTest(oldInput)]
}

export function saveTests(tests: TestCase[]) {
  saveJSON('tests', tests)
}
