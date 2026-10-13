import { runAll } from './cases.ts'

self.onmessage = async () => {
  try {
    await runAll((line) => self.postMessage({ line }))
  } catch (e) {
    self.postMessage({ line: `Unexpected error: ${e instanceof Error ? e.stack : String(e)}` })
  }
  self.postMessage({ done: true })
}
