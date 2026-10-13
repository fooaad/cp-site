// Phase 0 checks in Node. The same checks run in the browser at /spike.html.
// Run with: node scripts/spike.ts
import { runAll } from '../src/spike/cases.ts'

await runAll((line) => console.log(line))
