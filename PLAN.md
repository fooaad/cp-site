# cp-site plan

A browser-only competitive programming site: write C++, compile and run it in the
browser with Clang compiled to WebAssembly. Hosted free on GitHub Pages, no server.

Update this file as phases finish: tick boxes, record decisions, add what you learned.

## How it works

```
editor (C++) → clang.wasm in a Web Worker → program.wasm → WASI shim → Output
                (virtual filesystem with                      stdin ← Input box
                 libc++ headers, PCH)
```

## Phase 0: Prove the compiler works

Goal: a bare page compiles and runs a program that reads `cin`. No real UI.

- [x] Compare Clang-for-Wasm options → `@yowasp/clang` (see Decisions)
- [x] Compile A+B to `wasm32-wasi` in the browser
- [x] Run it with `@bjorn3/browser_wasi_shim`, stdin `3 4` → stdout `7`
- [x] Measure: download size, first compile time, repeat compile time
- [x] Record the choice and numbers under Decisions
- [ ] **Open: recursion depth.** Decide how to handle deep recursion before Phase 1 (see Findings)

Done when: A+B works in the browser and the numbers are written down. ✅ (2026-10-13)

How to re-run the checks: `node scripts/spike.ts`, or `npm run dev` and open `/spike.html`.

### Findings (Chrome 152, Web Worker, M-series Mac)

| Check | Result |
|---|---|
| Toolchain download | 105 MB raw; ~17 MB brotli / ~23 MB gzip for the compiler, ~3–4 MB for headers |
| First compile (toolchain cached by the browser) | ~0.9 s; with a cold download add network time |
| Later compiles, A+B with `<iostream>` | ~0.7–0.8 s |
| Compile with `<bits/stdc++.h>` | ~1.2–1.3 s (Phase 3 PCH should cut this) |
| 1e9 simple operations | 1.19 s in browser vs 0.95 s native clang -O2 (~1.25× slower) |
| Compile errors | clean Clang messages with line/column |
| Runtime error (`v.at(10)`) | caught as `unreachable` trap; needs a friendly "Runtime Error" message |
| **Max recursion depth (DFS)** | **1k–5k plain; 5k–10k with JSPI. CP needs 2e5–1e6.** |

Safari 26.4 (same Mac): compiles 0.9–1.6 s, 1e9 operations in 0.95 s (as fast as native),
DFS depth 1k–5k, JSPI not available.

- Recursion depth is limited by the browser engine's own native stack (~1 MB), not by the wasm
  linear-memory stack, so `-Wl,-z,stack-size` doesn't help. Same in Chrome and Safari; Firefox not measured.
- Decision (2026-10-13): Phase 1 shows a clear "stack overflow" message; then spike an interpreter
  fallback that keeps the call stack in memory (Phase 1b).
- Bundled libc++ has no exception support: compile with `-fno-exceptions`; `throw` won't compile,
  library errors abort (shown as runtime error).
- `<csetjmp>` and `<csignal>` don't build for wasm32-wasi; every other standard header does.
- Production build: Vite bundles the toolchain into `dist/assets` (largest file 75 MB, under
  GitHub's 100 MB limit). Not yet tested with `vite preview`.

## Phase 1: Minimum working site

- [x] Editor: CodeMirror 6 with C++ highlighting
- [x] Input box, Output box, Run button
- [x] Compile and run in a Web Worker; 2 s limit shows "Time Limit Exceeded"
- [x] Compile errors shown with line numbers (and marked in the editor)
- [x] Friendly runtime errors (stack overflow, abort, bad memory access, exit code)

Done when: you can solve a Codeforces Div 2 A entirely on the site. ✅ (2026-10-13)

How it fits together: `src/cpp/judge.ts` (main thread) → `compiler.worker.ts` (long-lived,
keeps Clang loaded) → `runner.worker.ts` (one program at a time; terminated on a time limit).
Output streams back in batches so partial output survives a time limit; at most 4 MB is kept
and 100 KB rendered. Re-running unchanged code skips the compile.

### Findings

- **Slow iostreams (fixed 2026-10-13):** YoWASP's `libc++.a` is built without optimization (their
  `build.sh` passes no `CMAKE_BUILD_TYPE` for the runtimes). Header code (`vector`, `sort`, `map`)
  was always fast; code inside the library was not. `libcxx/build.sh` rebuilds libc++/libc++abi
  from the same LLVM commit (Codeberg YoWASP/llvm-project 9560ae0f) with YoWASP's CMake options
  plus `-O2`, using wasi-sdk 29 like they do. All 1,679 installed headers, including
  `__config_site`, are byte-identical to the bundled ones. The result (`src/cpp/libcxx/`,
  1.7 MB, committed) is linked with `-nostdlib++` instead of the bundled copy.

  | 1e6 numbers | bundled libc++ | our build | native macOS libc++ |
  |---|---|---|---|
  | `cin >> x` | 2.7 s | 0.34 s | 0.94 s |
  | `cout << i << "\n"` | 0.47 s | 0.045 s | 0.08 s |
  | `to_string` | 0.27 s | 0.009 s | 0.01 s |
  | `scanf` / `printf` (libc, unchanged) | 27 / 46 ms | | |

  In the browser, `cin` of 2e5 numbers: 70 ms (`scanf` 7 ms). Programs also got smaller
  (A+B 577 KB → 300 KB). Rebuild with `libcxx/build.sh` (~20 s; downloads ~110 MB wasi-sdk and a
  sparse LLVM checkout into the git-ignored `libcxx/.work/`).
- stdout is reported to wasi-libc as a file, not a terminal, so it's block-buffered (one
  terminal-style write per line made 1e6 lines take 0.86 s instead of 0.49 s).

## Phase 1b: Deep recursion (slow mode)

- [x] Spike: run programs in an interpreter whose call stack lives in memory
- [x] Automatic fallback: on "stack overflow" the runner re-runs the program in slow mode,
      with a 15× longer time limit and a "Slow mode" note in the output

How: `interp/` is a small Rust crate around the wasmi 2.0 interpreter with the ~15 WASI calls
compiled programs use, built to `src/cpp/interp.wasm` (1.8 MB, committed) by `npm run build:interp`.
`src/cpp/interp.ts` loads it; `runner.worker.ts` retries there when the fast run overflows.

| | Fast (browser engine) | Slow mode (wasmi) |
|---|---|---|
| DFS 2e5 deep | ❌ stack overflow | ✅ 0.75–1.05 s |
| DFS 1e6 deep | ❌ | ✅ ~4 s |
| 1e8 simple operations | 0.10 s | 2.5 s (~25× slower) |
| Startup | – | ~60 ms (lazy translation) |
| Infinite recursion | – | stops in ~0.6 s when the 256 MB stack runs out |

- Tried Wasm tail calls (`+tail-call`) for wasmi's faster dispatch: the interpreter then overflowed
  its own stack (stable Rust can't guarantee every handler call becomes a tail call). Reverted.

## Phase 2: CP comfort

- [x] Default template + `bits/stdc++.h` stand-in
- [x] Multiple test cases with expected output, pass/fail, diff
- [x] Ctrl+Enter / Cmd+Enter to run
- [x] `-O0` / `-O2` toggle, plus C++17 / C++20 / C++23
- [x] Time and memory per run
- [x] Autosave code and input in the browser
- [x] Autosave test cases and compiler options

Done 2026-10-13. Notes:
- Run compiles once and runs every test in order; the tabs show ✓ ✗ ! ⏱ per test and the
  first failing test is selected. Stop cancels the remaining tests.
- Answers are compared line by line, ignoring trailing spaces and trailing blank lines (what
  most judges accept). Decimal numbers also match within a tolerance (Output → "Decimals":
  ±1e-6 by default, ±1e-9, ±1e-4 or exact), using absolute or relative error like Codeforces:
  |yours − expected| ≤ ε·max(1, |expected|). Whole numbers and words must match exactly. A pass
  that needed the tolerance says so.
- Memory is the program's final memory size minus the 256 MB stack reservation, so it counts
  globals, heap and the program itself but not stack actually used. Unknown on a time limit.

## Phase 3: Speed

- [ ] Precompiled header for `bits/stdc++.h`
- [x] Keep the compiler loaded in the worker between runs
- [ ] Cache compiler files after first visit (works offline)

Done when: a typical compile takes about 1 s after the first visit.

## Phase 4: Online

- [x] GitHub repo: github.com/fooaad/cp-site (public since 2026-10-14)
- [x] GitHub Actions workflow → GitHub Pages on every push; Vite `base` is `/cp-site/`
- [x] Check file size limits for the compiler files: largest is 75 MB, under the 100 MB limit

Live at **https://fooaad.github.io/cp-site/** (2026-10-14). GitHub Pages gzips everything,
`.wasm` included: a first visit downloads ~28.5 MB (compiler 23 MB, headers 4.4 MB, the rest ~1 MB).

## Later

- "Run with GCC" via a compile API behind a Cloudflare Worker
- Multiple files/tabs, themes, snippet library
- Fetching Codeforces samples (needs a proxy because of CORS)

## Decisions

- Compile in the browser (not a compile API): free, unlimited, offline, no key to leak on a static site.
- Vite + React + TypeScript (from `new web --vite`).
- Lives in `~/Developer/cp-site`.
- Compiler: `@yowasp/clang` (LLVM 22, updated Aug 2026, ships libc++ for wasm32-wasip1, plain npm
  package, no special headers or SharedArrayBuffer needed). Wasmer's SDK was ruled out: it needs
  cross-origin isolation headers that GitHub Pages can't set, and downloads packages from Wasmer's registry.
- Fixed flags: `-fno-exceptions -isystem include -Wl,-z,stack-size=268435456` plus WASI clock
  emulation so `clock()` links; user flags default `-std=c++20 -O2`.
- Deep recursion: automatic slow mode in the wasmi interpreter (Phase 1b), not iterative-only.

## Open questions

- Report the unoptimized runtimes upstream to YoWASP/clang? (one-line fix: add
  `-DCMAKE_BUILD_TYPE=...` to the libcxx and compiler-rt CMake calls in their build.sh)
- `cin` is still ~10x slower than `scanf` (libc++ design, also native). Add a fast-input path if
  it ever matters; 2e5 numbers take 70 ms.
