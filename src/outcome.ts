import type { Verdict } from './cpp/judge.ts'
import { checkOutput } from './cpp/compare.ts'

export type Outcome = 'pass' | 'fail' | 'ran' | 'error' | 'time-limit' | 'stopped'

// One word per test for the tabs and the summary.
export function outcomeOf(verdict: Verdict, expected: string): Outcome {
  switch (verdict.kind) {
    case 'compile-error':
    case 'runtime-error':
      return 'error'
    case 'time-limit':
      return 'time-limit'
    case 'stopped':
      return 'stopped'
    case 'ok': {
      const check = checkOutput(expected, verdict.stdout).kind
      return check === 'none' ? 'ran' : check
    }
  }
}
