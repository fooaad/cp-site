// Phase 0 checks, shared by the Node script (scripts/spike.ts) and the browser page (spike.html).
import { compile } from '../cpp/compile.ts'
import { run } from '../cpp/run.ts'

const aPlusB = `#include <iostream>
int main() {
  long long a, b;
  std::cin >> a >> b;
  std::cout << a + b << "\\n";
}
`

const stdcxx = `#include <bits/stdc++.h>
using namespace std;
int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  int n; cin >> n;
  vector<long long> v(n);
  for (auto &x : v) cin >> x;
  sort(v.begin(), v.end());
  map<long long, int> cnt;
  for (auto x : v) cnt[x]++;
  cout << v.back() << " " << cnt.size() << "\\n";
}
`

const broken = `int main() { return x; }`

const crash = `#include <bits/stdc++.h>
int main() { std::vector<int> v(3); return v.at(10); }
`

// About 1e9 simple operations: compare against native clang++/g++ -O2 on the same code.
const cpuHeavy = `#include <bits/stdc++.h>
using namespace std;
int main() {
  int n; cin >> n;
  unsigned long long h = 0;
  for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) h = h * 1000003 + (i ^ j);
  cout << h << "\\n";
}
`

// Typical tree DFS on a path graph, so recursion depth = n.
const dfs = `#include <bits/stdc++.h>
using namespace std;
vector<vector<int>> adj; vector<int> sz;
void dfs(int u, int p) { sz[u] = 1; for (int v : adj[u]) if (v != p) { dfs(v, u); sz[u] += sz[v]; } }
int main() {
  int n; cin >> n; adj.resize(n); sz.resize(n);
  for (int i = 1; i < n; i++) { adj[i-1].push_back(i); adj[i].push_back(i-1); }
  dfs(0, -1); cout << sz[0] << "\\n";
}
`

type Log = (line: string) => void

async function check(log: Log, name: string, source: string, stdin: string, expected?: string) {
  let t = performance.now()
  const c = await compile(source)
  const compileMs = performance.now() - t
  if (!c.ok) {
    log(`${name}: compile error after ${compileMs.toFixed(0)} ms\n${c.log}`)
    return
  }
  t = performance.now()
  const r = await run(c.wasm as Uint8Array<ArrayBuffer>, stdin)
  const verdict =
    expected === undefined ? '' : r.stdout === expected ? ' ✅' : ` ❌ expected ${JSON.stringify(expected)}`
  log(
    `${name}: compile ${compileMs.toFixed(0)} ms, run ${r.timeMs.toFixed(1)} ms, ` +
      `exit ${r.exitCode}, stdout ${JSON.stringify(r.stdout)}${verdict}` +
      (r.error ? `, error "${r.error}"` : '') +
      `, wasm ${(c.wasm.length / 1024).toFixed(0)} KB`,
  )
}

async function recursionDepth(log: Log, jspi: boolean) {
  const c = await compile(dfs)
  if (!c.ok) return log(`DFS: compile error\n${c.log}`)
  let deepest = 0
  for (const n of [1_000, 5_000, 10_000, 30_000, 100_000, 200_000, 1_000_000]) {
    const r = await run(c.wasm as Uint8Array<ArrayBuffer>, `${n}\n`, { jspi })
    if (r.stdout.trim() !== String(n)) {
      log(`DFS${jspi ? ' (JSPI)' : ''} depth ${n}: failed (${r.error ?? r.stdout})`)
      break
    }
    deepest = n
  }
  log(`DFS${jspi ? ' (JSPI)' : ''}: deepest recursion that worked: ${deepest}`)
}

export async function runAll(log: Log) {
  await check(log, 'A+B (first, cold)', aPlusB, '3 4\n', '7\n')
  await check(log, 'A+B (second, warm)', aPlusB, '1000000000000 1\n', '1000000000001\n')
  await check(log, 'bits/stdc++.h', stdcxx, '5\n3 1 3 9 2\n', '9 4\n')
  await check(log, 'compile error', broken, '')
  await check(log, 'runtime error', crash, '')
  await check(log, '1e9 operations', cpuHeavy, '31623\n')
  await recursionDepth(log, false)
  if ('promising' in WebAssembly) await recursionDepth(log, true)
  else log('JSPI: not available in this engine')
}
